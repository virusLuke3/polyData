import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { WorldFlatMap } from '@/components/WorldFlatMap';
import { WorldGlobe } from '@/components/WorldGlobe';
import { PANEL_LIBRARY, PANEL_REGISTRY } from '@/panels/registry';
import {
  fetchAllActiveMarkets,
  fetchBootstrap,
  fetchLatestContent,
  fetchRecentOracle,
  fetchRecentTrades,
  fetchRuntimeAlpha,
  fetchRuntimeCommodities,
  fetchRuntimeCrypto,
  fetchRuntimeNba,
  fetchRuntimeNbaIntel,
  fetchRuntimeInflationNowcast,
  fetchRuntimeSuspicious,
  fetchRuntimeWhales,
  fetchSystemHealth,
  fetchWorkspaceBundle,
} from '@/services/api';
import type {
  BootstrapPayload,
  ContentItem,
  MarketListItem,
  MarketsPayload,
  MarketSummary,
  OracleEvent,
  PanelRenderContext,
  RuntimeMarketGroup,
  RuntimeInflationNowcastPayload,
  RuntimeNbaPayload,
  RuntimeNbaIntelPayload,
  RuntimeSignalPayload,
  SystemHealth,
  TradeRow,
  WorkspaceBundle,
} from '@/types';

type LayerToggle = {
  id: string;
  label: string;
  icon: string;
  enabled: boolean;
  hint?: string;
};

type RegionKey = 'global' | 'america' | 'mena' | 'eu' | 'asia' | 'latam' | 'africa' | 'oceania';

const PANEL_STORAGE_KEY = 'polydata:workspace-panels:v3';
const VIEW_STORAGE_KEY = 'polydata:map-view:v2';
const REGION_STORAGE_KEY = 'polydata:region:v1';
const LIBRARY_STORAGE_KEY = 'polydata:panel-library-open:v1';
const ZOOM_STORAGE_KEY = 'polydata:map-zoom:v2';

const INITIAL_LAYERS: LayerToggle[] = [
  { id: 'markets', label: 'Polymarket Markets', icon: '◎', enabled: true, hint: 'ACTIVE' },
  { id: 'oracle', label: 'Oracle Events', icon: '◌', enabled: true, hint: 'LIVE' },
  { id: 'trade', label: 'OrderFilled Tape', icon: '↗', enabled: true, hint: 'CHAIN' },
  { id: 'lob', label: 'Runtime LOB', icon: '▦', enabled: true, hint: 'BOOK' },
  { id: 'intel', label: 'Linked Intel', icon: '✦', enabled: true, hint: 'NEWS' },
];

const REGION_OPTIONS: Array<{ value: RegionKey; label: string }> = [
  { value: 'global', label: 'Global' },
  { value: 'america', label: 'Americas' },
  { value: 'mena', label: 'MENA' },
  { value: 'eu', label: 'Europe' },
  { value: 'asia', label: 'Asia' },
  { value: 'latam', label: 'LATAM' },
  { value: 'africa', label: 'Africa' },
  { value: 'oceania', label: 'Oceania' },
];

const MAP_BOTTOM_PANEL_IDS: string[] = [];

function clampMapZoom(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(4, Math.round(numeric)));
}

function isLiveStatus(status?: string | null) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'active' || normalized === 'proposed';
}

function currentUtcClock(now: Date) {
  return now.toLocaleString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
    hour12: false,
  }).replace(',', '').toUpperCase() + ' UTC';
}

function sanitizePanelIds(panelIds: string[]) {
  const valid = new Set(PANEL_LIBRARY.map((panel) => panel.id));
  const unique: string[] = [];
  for (const panelId of panelIds) {
    if (!valid.has(panelId) || unique.includes(panelId)) continue;
    unique.push(panelId);
  }
  return unique;
}

function readJsonStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function readStringStorage<T extends string>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  return (raw as T) || fallback;
}

function readSearchParam(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(key);
}

type RuntimePanelRefreshOptions = {
  bootstrapPayload?: BootstrapPayload | null;
};

type IdleSchedulerWindow = Window & typeof globalThis & {
  requestIdleCallback?: (callback: () => void) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function scheduleIdleTask(task: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  const idleWindow = window as IdleSchedulerWindow;
  if (typeof idleWindow.requestIdleCallback === 'function') {
    const handle = idleWindow.requestIdleCallback(() => task());
    return () => {
      if (typeof idleWindow.cancelIdleCallback === 'function') {
        idleWindow.cancelIdleCallback(handle);
      }
    };
  }
  const handle = window.setTimeout(task, 0);
  return () => window.clearTimeout(handle);
}

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [markets, setMarkets] = useState<MarketListItem[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [bundle, setBundle] = useState<WorkspaceBundle | null>(null);
  const [selectedMarketId, setSelectedMarketId] = useState<number | null>(null);
  const [globalTrades, setGlobalTrades] = useState<TradeRow[]>([]);
  const [globalOracle, setGlobalOracle] = useState<OracleEvent[]>([]);
  const [latestContent, setLatestContent] = useState<ContentItem[]>([]);
  const [commodities, setCommodities] = useState<RuntimeMarketGroup | null>(null);
  const [crypto, setCrypto] = useState<RuntimeMarketGroup | null>(null);
  const [nba, setNba] = useState<RuntimeNbaPayload | null>(null);
  const [nbaIntel, setNbaIntel] = useState<RuntimeNbaIntelPayload | null>(null);
  const [inflationNowcast, setInflationNowcast] = useState<RuntimeInflationNowcastPayload | null>(null);
  const [alphaSignals, setAlphaSignals] = useState<RuntimeSignalPayload | null>(null);
  const [whaleTrades, setWhaleTrades] = useState<RuntimeSignalPayload | null>(null);
  const [suspiciousTrades, setSuspiciousTrades] = useState<RuntimeSignalPayload | null>(null);
  const [marketQuery, setMarketQuery] = useState('');
  const [commandQuery, setCommandQuery] = useState('');
  const [layers, setLayers] = useState<LayerToggle[]>(INITIAL_LAYERS);
  const [activePanelIds, setActivePanelIds] = useState<string[]>([]);
  const [panelPrefsLoaded, setPanelPrefsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<'2d' | '3d'>(() => {
    const override = readSearchParam('view');
    return override === '2d' || override === '3d' ? override : '3d';
  });
  const [region, setRegion] = useState<RegionKey>(() => {
    const override = readSearchParam('region');
    return REGION_OPTIONS.some((option) => option.value === override) ? (override as RegionKey) : readStringStorage(REGION_STORAGE_KEY, 'global');
  });
  const [mapZoom, setMapZoom] = useState<number>(() => clampMapZoom(readJsonStorage(ZOOM_STORAGE_KEY, 1)));
  const [showPanelLibrary, setShowPanelLibrary] = useState<boolean>(() => Boolean(readJsonStorage(LIBRARY_STORAGE_KEY, true)));
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const bootstrapRef = useRef<BootstrapPayload | null>(null);
  const slowRefreshCancelRef = useRef<(() => void) | null>(null);
  const slowRefreshInFlightRef = useRef(false);

  async function refreshFastRuntimePanels(options: RuntimePanelRefreshOptions = {}): Promise<{ marketsPayload: MarketsPayload | null }> {
    const bootstrapPayload = options.bootstrapPayload || bootstrapRef.current;
    const settled = await Promise.allSettled([
      fetchSystemHealth(),
      fetchRecentTrades(24),
      fetchRecentOracle(16),
      fetchLatestContent(12),
      fetchAllActiveMarkets('', 160),
    ]);

    const fallbackMarkets = bootstrapPayload?.activeMarketsPreview || [];
    if (settled[0].status === 'fulfilled') setHealth(settled[0].value);
    else if (bootstrapPayload?.systemHealth) setHealth(bootstrapPayload.systemHealth);

    if (settled[1].status === 'fulfilled') setGlobalTrades(settled[1].value);
    else if (bootstrapPayload?.globalTradesPreview) setGlobalTrades(bootstrapPayload.globalTradesPreview);

    if (settled[2].status === 'fulfilled') setGlobalOracle(settled[2].value);
    else if (bootstrapPayload?.globalOraclePreview) setGlobalOracle(bootstrapPayload.globalOraclePreview);

    if (settled[3].status === 'fulfilled') setLatestContent(settled[3].value.items || []);
    else if (bootstrapPayload?.latestContentPreview) setLatestContent(bootstrapPayload.latestContentPreview);

    if (settled[4].status === 'fulfilled') setMarkets(settled[4].value.items || []);
    else if (fallbackMarkets.length) setMarkets(fallbackMarkets);

    return {
      marketsPayload: settled[4].status === 'fulfilled' ? settled[4].value : null,
    };
  }

  async function refreshSlowRuntimePanels() {
    const settled = await Promise.allSettled([
      fetchRuntimeCommodities(),
      fetchRuntimeCrypto(),
      fetchRuntimeNba(10),
      fetchRuntimeNbaIntel(12),
      fetchRuntimeInflationNowcast(),
      fetchRuntimeAlpha(8),
      fetchRuntimeWhales(14),
      fetchRuntimeSuspicious(12),
    ]);

    if (settled[0].status === 'fulfilled') setCommodities(settled[0].value);
    if (settled[1].status === 'fulfilled') setCrypto(settled[1].value);
    if (settled[2].status === 'fulfilled') setNba(settled[2].value);
    if (settled[3].status === 'fulfilled') setNbaIntel(settled[3].value);
    if (settled[4].status === 'fulfilled') setInflationNowcast(settled[4].value);
    if (settled[5].status === 'fulfilled') setAlphaSignals(settled[5].value);
    if (settled[6].status === 'fulfilled') setWhaleTrades(settled[6].value);
    if (settled[7].status === 'fulfilled') setSuspiciousTrades(settled[7].value);
  }

  function scheduleSlowRuntimePanels() {
    if (slowRefreshCancelRef.current || slowRefreshInFlightRef.current) return;
    slowRefreshCancelRef.current = scheduleIdleTask(() => {
      slowRefreshCancelRef.current = null;
      if (slowRefreshInFlightRef.current) return;
      slowRefreshInFlightRef.current = true;
      void refreshSlowRuntimePanels()
        .catch((loadError) => {
          setError((previous) => previous || (loadError instanceof Error ? loadError.message : 'Failed to refresh slow runtime panels.'));
        })
        .finally(() => {
          slowRefreshInFlightRef.current = false;
        });
    });
  }

  async function refreshRuntimePanels(options: RuntimePanelRefreshOptions = {}) {
    const fastResult = await refreshFastRuntimePanels(options);
    scheduleSlowRuntimePanels();
    return fastResult;
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setActivePanelIds(sanitizePanelIds(readJsonStorage<string[]>(PANEL_STORAGE_KEY, [])));
    setPanelPrefsLoaded(true);
  }, []);

  useEffect(() => {
    if (!panelPrefsLoaded || typeof window === 'undefined') return;
    window.localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(activePanelIds));
  }, [activePanelIds, panelPrefsLoaded]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VIEW_STORAGE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(REGION_STORAGE_KEY, region);
  }, [region]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(showPanelLibrary));
  }, [showPanelLibrary]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ZOOM_STORAGE_KEY, JSON.stringify(mapZoom));
  }, [mapZoom]);

  useEffect(() => {
    bootstrapRef.current = bootstrap;
  }, [bootstrap]);

  useEffect(() => () => {
    slowRefreshCancelRef.current?.();
    slowRefreshCancelRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const bootstrapPayload = await fetchBootstrap();
        if (cancelled) return;

        const defaultPanelIds = sanitizePanelIds(bootstrapPayload.defaultWorkspace?.panels || []);
        const liveFeatured = bootstrapPayload.featuredMarket && isLiveStatus(bootstrapPayload.featuredMarket.status)
          ? bootstrapPayload.featuredMarket.id
          : null;

        setBootstrap(bootstrapPayload);
        setMarkets(bootstrapPayload.activeMarketsPreview || []);
        setHealth(bootstrapPayload.systemHealth || null);
        setGlobalTrades(bootstrapPayload.globalTradesPreview || []);
        setGlobalOracle(bootstrapPayload.globalOraclePreview || []);
        setLatestContent(bootstrapPayload.latestContentPreview || []);
        setSelectedMarketId(liveFeatured || bootstrapPayload.featuredMarket?.id || null);
        setActivePanelIds((current) => (
          current.length
            ? sanitizePanelIds([...current, ...defaultPanelIds])
            : defaultPanelIds
        ));
        setLoading(false);

        void refreshRuntimePanels({ bootstrapPayload })
          .then(({ marketsPayload }) => {
            if (cancelled) return;
            if (!liveFeatured && !bootstrapPayload.featuredMarket?.id) {
              const marketItems = marketsPayload?.items || bootstrapPayload.activeMarketsPreview || [];
              const firstLiveMarket = marketItems.find((market) => isLiveStatus(market.status));
              setSelectedMarketId(firstLiveMarket?.id || marketItems?.[0]?.id || null);
            }
          })
          .catch((loadError) => {
            if (!cancelled) {
              setError((previous) => previous || (loadError instanceof Error ? loadError.message : 'Failed to refresh global workspace data.'));
            }
          });
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load dashboard.');
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [panelPrefsLoaded]);

  useEffect(() => {
    let cancelled = false;

    async function refreshGlobalPanels() {
      try {
        await refreshRuntimePanels();
        if (cancelled) return;
      } catch (loadError) {
        if (!cancelled) {
          setError((previous) => previous || (loadError instanceof Error ? loadError.message : 'Failed to refresh snapshots.'));
        }
      }
    }

    const timer = window.setInterval(() => {
      void refreshGlobalPanels();
    }, 20000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const payload = await fetchAllActiveMarkets(marketQuery.trim(), marketQuery.trim() ? 120 : 160);
        if (!cancelled) setMarkets(payload.items || []);
      } catch (loadError) {
        if (!cancelled) {
          setError((previous) => previous || (loadError instanceof Error ? loadError.message : 'Failed to refresh market search.'));
        }
      }
    }, marketQuery.trim() ? 220 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [marketQuery]);

  useEffect(() => {
    if (!selectedMarketId) return;
    const currentMarketId = selectedMarketId;
    let cancelled = false;

    async function loadBundle() {
      setBundleLoading(true);
      try {
        const payload = await fetchWorkspaceBundle(currentMarketId);
        if (!cancelled) setBundle(payload);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load market bundle.');
        }
      } finally {
        if (!cancelled) setBundleLoading(false);
      }
    }

    void loadBundle();
    const timer = window.setInterval(() => {
      void loadBundle();
    }, 20000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedMarketId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setShowCommandPalette(true);
      }
      if (event.key === 'Escape') {
        setShowCommandPalette(false);
        setShowSettings(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const toggleLayer = (layerId: string) => {
    setLayers((current) => current.map((layer) => (layer.id === layerId ? { ...layer, enabled: !layer.enabled } : layer)));
  };

  const togglePanel = (panelId: string) => {
    setActivePanelIds((current) => {
      if (current.includes(panelId)) return current.filter((candidate) => candidate !== panelId);
      return [...current, panelId];
    });
  };

  const availableMarkets = useMemo(
    () => (markets.length ? markets : (bootstrap?.activeMarketsPreview || [])),
    [bootstrap?.activeMarketsPreview, markets],
  );

  const filteredMarkets = useMemo(() => {
    const query = marketQuery.trim().toLowerCase();
    if (!query) return availableMarkets;
    return availableMarkets.filter((market) => {
      const text = `${market.title} ${market.slug} ${market.category || ''} ${(market.tags || []).join(' ')}`.toLowerCase();
      return text.includes(query);
    });
  }, [availableMarkets, marketQuery]);

  const selectedMarket = useMemo<MarketSummary | null>(() => {
    if (bundle?.market && bundle.market.id === selectedMarketId) return bundle.market;
    if (bootstrap?.featuredMarket?.id === selectedMarketId) return bootstrap.featuredMarket;
    return bundle?.market || bootstrap?.featuredMarket || null;
  }, [bootstrap?.featuredMarket, bundle?.market, selectedMarketId]);

  const currentGlobalTrades = globalTrades.length ? globalTrades : (bootstrap?.globalTradesPreview || []);
  const currentGlobalOracle = globalOracle.length ? globalOracle : (bootstrap?.globalOraclePreview || []);
  const currentLatestContent = latestContent.length ? latestContent : (bootstrap?.latestContentPreview || []);
  const displayMarkets = filteredMarkets.length ? filteredMarkets : availableMarkets;
  const displayPanelIds = activePanelIds.length
    ? activePanelIds
    : sanitizePanelIds(bootstrap?.defaultWorkspace?.panels || []);
  const mapBottomPanelIds = displayPanelIds.filter((panelId) => MAP_BOTTOM_PANEL_IDS.includes(panelId));
  const sidePanelIds = displayPanelIds.filter((panelId) => !MAP_BOTTOM_PANEL_IDS.includes(panelId));

  const liveMetrics = [
    { label: 'ACTIVE MARKETS', value: displayMarkets.length || availableMarkets.length || 0 },
    { label: 'ORDERFILLED', value: currentGlobalTrades.length || 0 },
    { label: 'ORACLE', value: currentGlobalOracle.length || 0 },
    { label: 'INTEL', value: currentLatestContent.length || 0 },
  ];

  const panelContext: PanelRenderContext = {
    bootstrap,
    markets: displayMarkets,
    selectedMarketId,
    setSelectedMarketId,
    selectedMarket,
    bundle,
    health,
    globalTrades: currentGlobalTrades,
    globalOracle: currentGlobalOracle,
    latestContent: currentLatestContent,
    commodities,
    crypto,
    nba,
    nbaIntel,
    inflationNowcast,
    alphaSignals,
    whaleTrades,
    suspiciousTrades,
  };

  const commandResults = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    const panelHits = PANEL_LIBRARY.filter((panel) => {
      const text = `${panel.title} ${panel.description} ${panel.eyebrow}`.toLowerCase();
      return !query || text.includes(query);
    }).slice(0, 8);
    const marketHits = availableMarkets.filter((market) => {
      const text = `${market.title} ${market.category || ''} ${market.slug}`.toLowerCase();
      return !query || text.includes(query);
    }).slice(0, 8);
    return { panelHits, marketHits };
  }, [availableMarkets, commandQuery]);

  const resetWorkspace = () => {
    setRegion('global');
    setMapZoom(1);
    setViewMode('3d');
    setSelectedMarketId(bootstrap?.featuredMarket?.id || availableMarkets[0]?.id || null);
    setNotice('Workspace reset');
  };

  const cycleRegion = () => {
    const currentIndex = REGION_OPTIONS.findIndex((item) => item.value === region);
    const next = REGION_OPTIONS[(currentIndex + 1) % REGION_OPTIONS.length];
    if (next) setRegion(next.value);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setNotice('Link copied');
    } catch {
      setNotice('Copy failed');
    }
  };

  const changeViewMode = (nextMode: '2d' | '3d') => {
    setViewMode(nextMode);
    setMapZoom((current) => clampMapZoom(nextMode === '2d' ? Math.min(2, current) : current));
    setNotice(nextMode === '2d' ? '2D map enabled' : '3D globe enabled');
  };

  const zoomIn = () => setMapZoom((current) => clampMapZoom(current + 1));
  const zoomOut = () => setMapZoom((current) => clampMapZoom(current - 1));

  return (
    <div className="wm-shell">
      <div className="wm-promo">
        <span className="wm-pro-badge">PRO</span>
        <span className="wm-promo-copy">Pro is coming - More Signal, Less Noise. More AI Briefings. A Geopolitical & Equity Researcher just for you.</span>
        <button className="wm-promo-cta" type="button">Reserve your spot</button>
      </div>

      <header className="wm-toolbar">
        <div className="wm-toolbar-left">
          <div className="wm-nav-cluster">
            <button className="wm-nav-pill active" type="button" onClick={resetWorkspace}>World</button>
            <button className="wm-nav-icon" type="button" onClick={() => setShowCommandPalette(true)} title="Command palette">⌨</button>
            <button className="wm-nav-icon" type="button" onClick={() => setShowPanelLibrary((current) => !current)} title="Toggle panel library">◫</button>
            <button className="wm-nav-icon" type="button" onClick={() => setShowSettings(true)} title="Open settings">⚒</button>
            <button className="wm-nav-icon" type="button" onClick={cycleRegion} title="Cycle region">◌</button>
          </div>
          <div className="wm-brand">MONITOR <span>v0.2.0</span></div>
          <div className="wm-live-dot">Live</div>
          <button className="wm-select-pill" type="button" onClick={cycleRegion}>
            {REGION_OPTIONS.find((item) => item.value === region)?.label || 'Global'} ▾
          </button>
          <div className="wm-defcon-pill">POLYMARKET <span>LIVE</span></div>
        </div>
        <div className="wm-toolbar-right">
          <button className="wm-counter-pill" type="button">{liveMetrics[1]?.value || 0}</button>
          <button className="wm-tool-button" type="button" onClick={() => setShowCommandPalette(true)}>⌘K Search</button>
          <button className="wm-tool-button" type="button" onClick={() => void copyLink()}>Copy Link</button>
          <button className="wm-tool-icon" type="button" onClick={resetWorkspace}>⌂</button>
          <button className="wm-tool-icon" type="button" onClick={() => setShowSettings(true)}>⚙</button>
        </div>
      </header>

      <main className="wm-dashboard">
        <div className="wm-main-content">
        <section className="wm-map-section">
          <div className="wm-map-header">
            <div className="wm-map-title">Global Situation</div>
            <div className="wm-map-clock">{currentUtcClock(now)}</div>
            <div className="wm-map-view-toggle">
              <button type="button" className={viewMode === '2d' ? 'active' : ''} onClick={() => changeViewMode('2d')}>2D</button>
              <button type="button" className={viewMode === '3d' ? 'active' : ''} onClick={() => changeViewMode('3d')}>3D</button>
            </div>
          </div>

          <div className="wm-map-stage">
            <div className={`wm-globe-area ${viewMode === '2d' ? 'wm-globe-area-flat' : ''}`}>
              <aside className={`wm-layer-sidebar ${showPanelLibrary ? '' : 'collapsed'}`}>
                <div className="wm-toggle-header">
                  <span>Layers</span>
                  <button type="button" className="wm-toggle-collapse" onClick={() => setShowPanelLibrary(false)}>▼</button>
                </div>
                <input
                  className="wm-layer-search"
                  value={marketQuery}
                  onInput={(event) => setMarketQuery((event.currentTarget as HTMLInputElement).value)}
                  placeholder="Search layers..."
                />

                <div className="wm-layer-list">
                  {layers.map((layer) => (
                    <label
                      key={layer.id}
                      className={`wm-layer-row ${layer.enabled ? 'enabled' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={layer.enabled}
                        onChange={() => toggleLayer(layer.id)}
                      />
                      <span className="wm-layer-icon">{layer.icon}</span>
                      <span>{layer.label}</span>
                      {layer.hint ? <em className="wm-layer-hint">{layer.hint}</em> : null}
                    </label>
                  ))}
                </div>

                <div className="wm-sidebar-footer">polyData • world terminal</div>
              </aside>

              <div className="wm-globe-hero">
                {viewMode === '3d' ? (
                  <WorldGlobe
                    key={`globe:${region}`}
                    markets={displayMarkets}
                    selectedMarket={selectedMarket}
                    recentTrades={currentGlobalTrades}
                    recentOracle={currentGlobalOracle}
                    contentItems={currentLatestContent}
                    region={region}
                    zoomLevel={mapZoom}
                  />
                ) : (
                  <WorldFlatMap
                    key={`flat:${region}`}
                    markets={displayMarkets}
                    selectedMarket={selectedMarket}
                    recentTrades={currentGlobalTrades}
                    recentOracle={currentGlobalOracle}
                    contentItems={currentLatestContent}
                    region={region}
                    zoomLevel={mapZoom}
                  />
                )}

              </div>

              <div className="wm-map-controls">
                <button type="button" className="wm-side-beta" onClick={() => setShowSettings(true)}>BETA</button>
                <button type="button" onClick={zoomIn}>＋</button>
                <button type="button" onClick={zoomOut}>－</button>
                <button type="button" onClick={resetWorkspace}>⌂</button>
              </div>

              {loading ? <div className="wm-banner">Bootstrapping monitor...</div> : null}
              {bundleLoading ? <div className="wm-banner secondary">Switching market workspace...</div> : null}
              {error ? <div className="wm-banner error">{error}</div> : null}
              {notice ? <div className="wm-banner notice">{notice}</div> : null}
            </div>
          </div>

          <div className="wm-map-bottom-grid">
            {mapBottomPanelIds.map((panelId) => {
              const entry = PANEL_REGISTRY[panelId];
              if (!entry) return null;
              const sizeClass = entry.size ? `size-${entry.size}` : '';
              return (
                <div className={`wm-panel-slot ${sizeClass}`.trim()} key={`bottom-${panelId}`}>
                  {entry.render(panelContext)}
                </div>
              );
            })}
          </div>
        </section>

        <section className="wm-panels-grid">
          {sidePanelIds.map((panelId) => {
            const entry = PANEL_REGISTRY[panelId];
            if (!entry) return null;
            const sizeClass = entry.size ? `size-${entry.size}` : '';
            return (
              <div className={`wm-panel-slot ${sizeClass}`.trim()} key={panelId}>
                {entry.render(panelContext)}
              </div>
            );
          })}
        </section>
        </div>
      </main>

      {showCommandPalette ? (
        <div className="wm-modal-backdrop" onClick={() => setShowCommandPalette(false)}>
          <div className="wm-modal wm-command-modal" onClick={(event) => event.stopPropagation()}>
            <div className="wm-modal-title">Command Palette</div>
            <input
              autoFocus
              className="wm-command-input"
              value={commandQuery}
              onInput={(event) => setCommandQuery((event.currentTarget as HTMLInputElement).value)}
              placeholder="Search markets or panels..."
            />
            <div className="wm-command-columns">
              <div className="wm-command-group">
                <div className="wm-command-heading">Markets</div>
                {commandResults.marketHits.map((market) => (
                  <button
                    key={market.id}
                    type="button"
                    className="wm-command-result"
                    onClick={() => {
                      setSelectedMarketId(market.id);
                      setShowCommandPalette(false);
                    }}
                  >
                    <strong>{market.title}</strong>
                    <span>{market.category || market.status || 'market'}</span>
                  </button>
                ))}
              </div>
              <div className="wm-command-group">
                <div className="wm-command-heading">Panels</div>
                {commandResults.panelHits.map((panel) => (
                  <button
                    key={panel.id}
                    type="button"
                    className="wm-command-result"
                    onClick={() => {
                      if (!displayPanelIds.includes(panel.id)) togglePanel(panel.id);
                      setShowCommandPalette(false);
                    }}
                  >
                    <strong>{panel.title}</strong>
                    <span>{panel.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showSettings ? (
        <div className="wm-modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="wm-modal wm-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="wm-modal-title">Workspace Settings</div>
            <label className="wm-settings-row">
              <span>Region</span>
              <select value={region} onChange={(event) => setRegion((event.currentTarget as HTMLSelectElement).value as RegionKey)}>
                {REGION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="wm-settings-row">
              <span>Map Mode</span>
              <select value={viewMode} onChange={(event) => setViewMode((event.currentTarget as HTMLSelectElement).value as '2d' | '3d')}>
                <option value="2d">2D</option>
                <option value="3d">3D</option>
              </select>
            </label>
            <label className="wm-settings-row">
              <span>Map Zoom</span>
              <input type="range" min="1" max="4" step="1" value={String(mapZoom)} onInput={(event) => setMapZoom(clampMapZoom((event.currentTarget as HTMLInputElement).value))} />
            </label>
            <div className="wm-settings-actions">
              <button type="button" className="wm-settings-btn" onClick={() => setActivePanelIds(sanitizePanelIds(PANEL_LIBRARY.map((panel) => panel.id)))}>Enable All Panels</button>
              <button type="button" className="wm-settings-btn" onClick={() => setActivePanelIds(sanitizePanelIds(bootstrap?.defaultWorkspace?.panels || []))}>Restore Default Panels</button>
              <button type="button" className="wm-settings-btn primary" onClick={() => { resetWorkspace(); setShowSettings(false); }}>Reset Workspace</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
