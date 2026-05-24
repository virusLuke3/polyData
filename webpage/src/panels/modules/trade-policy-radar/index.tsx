import { useMemo, useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import type { PanelRenderMap } from '../../types';
import { panelFromRenderer } from '../helpers';
import './styles.css';

type TabId = 'overview' | 'tariffs' | 'flows' | 'barriers' | 'revenue' | 'strategic';
type Tone = 'risk' | 'watch' | 'positive' | 'neutral';

type TradeSignal = {
  id: string;
  tab: TabId;
  source: string;
  badge: string;
  tone: Tone;
  title: string;
  jurisdiction: string;
  products: string;
  signal: string;
  marketRead: string;
  nextCheck: string;
};

type MetricCard = {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
};

type TableRow = {
  id: string;
  col1: string;
  col2: string;
  col3: string;
  col4: string;
  tone: Tone;
};

const TABS: Array<{ id: TabId; label: string; hint: string }> = [
  { id: 'overview', label: 'Overview', hint: 'Policy shocks that can move markets' },
  { id: 'tariffs', label: 'Tariffs', hint: 'MFN baseline vs effective burden' },
  { id: 'flows', label: 'Flows', hint: 'Who exports, imports, and depends on whom' },
  { id: 'barriers', label: 'Barriers', hint: 'TBT, SPS, licensing, quotas' },
  { id: 'revenue', label: 'Revenue', hint: 'Customs duties as tariff-pressure proxy' },
  { id: 'strategic', label: 'Strategic', hint: 'Critical minerals and supply-chain controls' },
];

const DEFAULT_TAB_META = TABS[0] as { id: TabId; label: string; hint: string };

const OVERVIEW_METRICS: MetricCard[] = [
  {
    label: 'Policy Layer',
    value: '6 feeds',
    detail: 'GTA, WTO, WITS, Remedies, I-TIP, OECD',
    tone: 'neutral',
  },
  {
    label: 'Market Lens',
    value: '4 paths',
    detail: 'Input cost, margin, substitution, headline odds',
    tone: 'watch',
  },
  {
    label: 'Data Gap',
    value: 'API next',
    detail: 'Static watchlist now; live feeds need wiring',
    tone: 'risk',
  },
];

const TRADE_SIGNALS: TradeSignal[] = [
  {
    id: 'overview-clean-energy',
    tab: 'overview',
    source: 'Global Trade Alert / WTO Remedies',
    badge: 'Tariff',
    tone: 'risk',
    title: 'Clean-energy trade restrictions remain the clearest policy-to-margin channel',
    jurisdiction: 'US, EU, China, Southeast Asia',
    products: 'EVs, batteries, solar cells/modules, steel and aluminum inputs',
    signal: 'Track new tariff actions, anti-subsidy cases, origin-rule tightening, and retaliation headlines.',
    marketRead: 'Domestic substitutes and upstream metals can benefit; import-heavy automakers, installers, and module buyers face margin pressure.',
    nextCheck: 'Watch: solar tariffs, EV import duties, battery input costs, clean-energy subsidy markets.',
  },
  {
    id: 'overview-semiconductors',
    tab: 'overview',
    source: 'Government notices / Global Trade Alert',
    badge: 'Export Control',
    tone: 'watch',
    title: 'Advanced-chip export controls link directly to AI capex and semiconductor equipment revenue',
    jurisdiction: 'US, China, Japan, Netherlands, Korea, Taiwan',
    products: 'AI accelerators, lithography tools, EDA access, advanced packaging equipment',
    signal: 'Monitor licensing changes, entity-list additions, cloud-compute restrictions, and ally alignment.',
    marketRead: 'Equipment makers and foundry capex react first; domestic substitution and AI compute scarcity themes follow.',
    nextCheck: 'Watch: AI chip export markets, semiconductor equipment sales, China tech-policy odds.',
  },
  {
    id: 'overview-critical-minerals',
    tab: 'overview',
    source: 'OECD Export Restrictions / UN Comtrade',
    badge: 'Raw Materials',
    tone: 'risk',
    title: 'Critical-mineral export controls are the upstream cost shock for batteries and electronics',
    jurisdiction: 'Indonesia, Chile, DRC, China, Australia',
    products: 'Nickel, cobalt, lithium, copper, graphite, rare earths',
    signal: 'Export taxes, quotas, licensing rules, and beneficiation mandates can reprice inputs before official trade data updates.',
    marketRead: 'Miners and refiners gain pricing power; battery, EV, storage, and electronics supply chains absorb cost pressure.',
    nextCheck: 'Watch: nickel/lithium prices, battery-cost markets, resource-nationalism headlines.',
  },
  {
    id: 'tariffs-mfn-effective',
    tab: 'tariffs',
    source: 'WTO Tariff Data / Effective-rate estimate',
    badge: 'Gap',
    tone: 'risk',
    title: 'Useful tariff view is not the MFN rate alone; it is MFN plus policy overlays',
    jurisdiction: 'US import stack vs China and sector partners',
    products: 'HS84 machinery, HS85 electronics, HS87 vehicles, HS72 steel, HS76 aluminum',
    signal: 'Compare WTO MFN applied rates with unilateral tariff layers, AD/CVD duties, safeguard measures, and exclusions.',
    marketRead: 'The gap between baseline and effective burden is the number that matters for corporate margins.',
    nextCheck: 'Next data wire: WTO MFN baseline + US effective tariff estimate + sector-level gap.',
  },
  {
    id: 'tariffs-sector-stack',
    tab: 'tariffs',
    source: 'WTO IDB / CTS / national customs notices',
    badge: 'HS Codes',
    tone: 'watch',
    title: 'Sector tariff stack should be shown by HS code, not broad news labels',
    jurisdiction: 'US, EU, China, India, ASEAN',
    products: 'Solar modules, steel pipe, tires, chemicals, auto parts',
    signal: 'A usable panel needs HS code, reporter, partner, baseline rate, extra duty, effective rate, and last update.',
    marketRead: 'Without HS-level mapping, the panel cannot tell which commodity, company, or market is exposed.',
    nextCheck: 'Next data wire: HS6 watchlist for clean energy, metals, chemicals, auto parts.',
  },
  {
    id: 'flows-battery',
    tab: 'flows',
    source: 'World Bank WITS / UN Comtrade',
    badge: 'Exposure',
    tone: 'risk',
    title: 'Battery-chain exposure needs reporter, partner, commodity, value, and YoY change',
    jurisdiction: 'Indonesia -> China/Korea; Chile -> China/US/EU; DRC -> refiners',
    products: 'Nickel ores, cobalt intermediates, lithium carbonate, graphite anodes',
    signal: 'Flag high concentration, sudden YoY flow drops, and rerouting to substitute suppliers.',
    marketRead: 'Trade-flow contraction is an early warning for battery input inflation and delayed downstream production.',
    nextCheck: 'Watch: trade value anomalies, partner concentration, battery input price markets.',
  },
  {
    id: 'flows-steel-aluminum',
    tab: 'flows',
    source: 'UN Comtrade / WITS',
    badge: 'Substitution',
    tone: 'watch',
    title: 'Steel and aluminum policy should separate protected upstream producers from cost-exposed buyers',
    jurisdiction: 'US, EU, China, Turkey, India, Vietnam',
    products: 'Flat steel, steel pipe, aluminum sheet, machinery components',
    signal: 'Track import dependence, top alternative suppliers, and volume displacement after tariff or remedy actions.',
    marketRead: 'Domestic producers may gain pricing power while autos, machinery, packaging, and construction absorb higher costs.',
    nextCheck: 'Watch: steel import restriction markets, manufacturing-margin pressure, auto input costs.',
  },
  {
    id: 'barriers-tbt-sps',
    tab: 'barriers',
    source: 'WTO I-TIP / TBT / SPS notifications',
    badge: 'Non-tariff',
    tone: 'watch',
    title: 'Non-tariff measures often matter more than headline tariffs for food, pharma, and chemicals',
    jurisdiction: 'EU, US, China, Japan, ASEAN',
    products: 'Food, agriculture, APIs, chemicals, autos parts, medical devices',
    signal: 'Track TBT/SPS notifications, import licensing, testing standards, quantity limits, and conformity rules.',
    marketRead: 'The impact shows up as customs delays, inventory rebuilds, compliance costs, and supplier switching.',
    nextCheck: 'Watch: food inflation, drug-shortage, chemical supply-chain, auto parts markets.',
  },
  {
    id: 'barriers-procurement',
    tab: 'barriers',
    source: 'Global Trade Alert',
    badge: 'Preference',
    tone: 'neutral',
    title: 'Government procurement preferences are a policy signal for industrial winners and losers',
    jurisdiction: 'US, EU, China, India',
    products: 'Defense, infrastructure, grid equipment, clean energy, telecom hardware',
    signal: 'Preferential procurement and local-content rules can move demand before formal tariff data changes.',
    marketRead: 'Local suppliers gain visibility; foreign vendors lose addressable demand even without a tariff headline.',
    nextCheck: 'Watch: Buy-local policies, defense procurement, grid investment, telecom restrictions.',
  },
  {
    id: 'revenue-customs',
    tab: 'revenue',
    source: 'US Treasury Monthly Treasury Statement',
    badge: 'Duties',
    tone: 'watch',
    title: 'Customs-duty revenue is the fastest public proxy for effective tariff burden',
    jurisdiction: 'United States',
    products: 'All dutiable imports; sector split requires customs or tariff-line mapping',
    signal: 'Track monthly customs duties, fiscal-year-to-date totals, and spikes vs prior-year run rate.',
    marketRead: 'A revenue spike suggests tariff burden is showing up in paid duties, not just announcements.',
    nextCheck: 'Next data wire: MTS customs duties chart + YoY spike detection + effective-rate note.',
  },
  {
    id: 'revenue-company-pass-through',
    tab: 'revenue',
    source: 'US Treasury / company filings',
    badge: 'Pass-through',
    tone: 'neutral',
    title: 'Revenue data becomes actionable only when paired with import-heavy sectors',
    jurisdiction: 'US-listed importers and global suppliers',
    products: 'Retail, autos, industrial machinery, electronics, clean energy equipment',
    signal: 'Map tariff revenue spikes to sectors with high imported input share and weak pricing power.',
    marketRead: 'The key question is who absorbs the duty: supplier, importer, consumer, or government through exemptions.',
    nextCheck: 'Watch: margin guidance, CPI pass-through, retailer earnings, industrial input costs.',
  },
  {
    id: 'strategic-rare-earths',
    tab: 'strategic',
    source: 'OECD Export Restrictions / USGS / UN Comtrade',
    badge: 'Rare Earths',
    tone: 'risk',
    title: 'Rare-earth and graphite restrictions should be treated as strategic supply-chain alerts',
    jurisdiction: 'China, US, EU, Japan, Korea',
    products: 'Rare earth magnets, graphite, gallium, germanium, battery anodes',
    signal: 'Track export licensing, end-use checks, domestic-processing mandates, and stockpiling signals.',
    marketRead: 'Defense, EV, wind, electronics, and semiconductor supply chains can reprice on policy news alone.',
    nextCheck: 'Watch: critical-mineral export controls, defense supply-chain, battery-material markets.',
  },
  {
    id: 'strategic-sanctions',
    tab: 'strategic',
    source: 'Official sanctions lists / Global Trade Alert',
    badge: 'Sanctions',
    tone: 'risk',
    title: 'Sanctions and investment controls belong in trade policy because they block flows without a tariff',
    jurisdiction: 'US, EU, UK, China, Russia, Middle East',
    products: 'Energy, shipping, banking, chips, dual-use goods, aircraft parts',
    signal: 'Track entity listings, sectoral sanctions, shipping restrictions, investment screening, and export bans.',
    marketRead: 'The market impact is often binary: legal flow vs blocked flow, insured cargo vs stranded cargo.',
    nextCheck: 'Watch: sanctions markets, oil flows, shipping insurance, dual-use export controls.',
  },
];

const TARIFF_TABLE: TableRow[] = [
  {
    id: 'tariff-solar',
    col1: 'Solar cells / modules',
    col2: 'HS 8541 / 8501 watch',
    col3: 'MFN + AD/CVD + origin rule',
    col4: 'Installer margins down; domestic module makers up',
    tone: 'risk',
  },
  {
    id: 'tariff-steel',
    col1: 'Steel / aluminum',
    col2: 'HS 72 / HS 76',
    col3: 'Safeguard + AD/CVD risk',
    col4: 'Upstream pricing power; autos and machinery cost pressure',
    tone: 'watch',
  },
  {
    id: 'tariff-autos',
    col1: 'EVs / auto parts',
    col2: 'HS 8703 / 8708',
    col3: 'Tariff + local-content policy',
    col4: 'Regional substitution and consumer-price pass-through',
    tone: 'risk',
  },
];

const FLOW_TABLE: TableRow[] = [
  {
    id: 'flow-nickel',
    col1: 'Indonesia nickel chain',
    col2: 'Ore -> matte -> battery materials',
    col3: 'Export restrictions + processing mandate',
    col4: 'Battery input-cost shock and refiner margin expansion',
    tone: 'risk',
  },
  {
    id: 'flow-lithium',
    col1: 'Chile / Australia lithium',
    col2: 'Carbonate and spodumene flows',
    col3: 'Trade-value anomaly and partner concentration',
    col4: 'EV battery-cost and storage economics signal',
    tone: 'watch',
  },
  {
    id: 'flow-rare-earths',
    col1: 'China rare-earth magnets',
    col2: 'Magnets, oxides, gallium, germanium',
    col3: 'Licensing and end-use checks',
    col4: 'Defense, wind, EV, and chip-supply risk',
    tone: 'risk',
  },
];

function toneClass(tone: Tone) {
  return `tone-${tone}`;
}

function TradePolicyRadarPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [showHelp, setShowHelp] = useState(false);
  const activeTabMeta = TABS.find((tab) => tab.id === activeTab) || DEFAULT_TAB_META;
  const activeItems = useMemo(
    () => TRADE_SIGNALS.filter((item) => item.tab === activeTab),
    [activeTab],
  );

  return (
    <Panel
      title="Trade Policy"
      badge="LIVE"
      status="live"
      count={activeItems.length}
      titleControls={(
        <button
          type="button"
          className="wm-panel-help-button"
          aria-label="Explain trade policy panel"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((current) => !current)}
        >
          ?
        </button>
      )}
      headerOverlay={showHelp ? (
        <div className="wm-panel-help-popover">
          <strong>Trade Policy</strong>
          <p>WorldMonitor-style trade intelligence: WTO baseline rates, effective tariff burden, flows, barriers, revenue, and strategic supply-chain controls.</p>
        </div>
      ) : null}
      className="wm-market-panel wm-trade-policy-radar-panel"
      dataPanelId="trade-policy-radar"
    >
      <div className="wm-trade-terminal">
        <div className="wm-trade-tabs" role="tablist" aria-label="Trade policy views">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? 'active' : ''}
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="wm-trade-section-head">
          <span>{activeTabMeta.label}</span>
          <em>{activeTabMeta.hint}</em>
        </div>

        {activeTab === 'overview' ? <MetricStrip /> : null}
        {activeTab === 'tariffs' ? <SignalTable rows={TARIFF_TABLE} headers={['Product', 'Code / Scope', 'Policy Stack', 'Market Read']} /> : null}
        {activeTab === 'flows' || activeTab === 'strategic' ? <SignalTable rows={FLOW_TABLE} headers={['Flow', 'Commodity', 'Trigger', 'Market Read']} /> : null}

        <div className="wm-trade-news-list">
          {activeItems.map((item) => (
            <PolicyRow item={item} key={item.id} />
          ))}
        </div>
      </div>
    </Panel>
  );
}

function MetricStrip() {
  return (
    <div className="wm-trade-metric-strip">
      {OVERVIEW_METRICS.map((item) => (
        <div className={`wm-trade-metric ${toneClass(item.tone)}`} key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <em>{item.detail}</em>
        </div>
      ))}
    </div>
  );
}

function SignalTable({ rows, headers }: { rows: TableRow[]; headers: [string, string, string, string] }) {
  return (
    <div className="wm-trade-table">
      <div className="wm-trade-table-head">
        {headers.map((header) => <span key={header}>{header}</span>)}
      </div>
      {rows.map((row) => (
        <div className={`wm-trade-table-row ${toneClass(row.tone)}`} key={row.id}>
          <b>{row.col1}</b>
          <span>{row.col2}</span>
          <span>{row.col3}</span>
          <em>{row.col4}</em>
        </div>
      ))}
    </div>
  );
}

function PolicyRow({ item }: { item: TradeSignal }) {
  return (
    <article className="wm-trade-news-row">
      <div className="wm-trade-news-meta">
        <span className="wm-trade-dot" />
        <b>{item.source}</b>
        <i className={`wm-trade-tag ${toneClass(item.tone)}`}>{item.badge}</i>
      </div>

      <strong>{item.title}</strong>

      <div className="wm-trade-facts">
        <Fact label="Jurisdiction" value={item.jurisdiction} />
        <Fact label="Products" value={item.products} />
        <Fact label="Signal" value={item.signal} />
      </div>

      <div className="wm-trade-readout">
        <span>Market Read</span>
        <b>{item.marketRead}</b>
      </div>

      <div className="wm-trade-news-foot">
        <span>{item.nextCheck}</span>
        <b>Source: {item.source}</b>
      </div>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

const renderers: PanelRenderMap = {
  'trade-policy-radar': {
    render: () => <TradePolicyRadarPanel />,
  },
};

export const panel = panelFromRenderer(renderers, {
  id: 'trade-policy-radar',
  title: 'Trade Policy',
  eyebrow: 'global',
  description: 'Trade policy intelligence mapped to tariff burden, trade flows, barriers, revenue, and market implications.',
  defaultEnabled: true,
});
