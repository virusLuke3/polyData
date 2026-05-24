import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import type { PanelRenderMap } from '../../types';
import { panelFromRenderer } from '../helpers';
import { PanelGlyph, SourceStack, signalToneClass } from '../macro-intel';
import './styles.css';

type TabId = 'events' | 'tariffs' | 'flows' | 'remedies' | 'ntm' | 'materials';
type Tone = 'hot' | 'watch' | 'cool' | 'neutral';

type PolicyKpi = {
  label: string;
  value: string;
  meta: string;
  tone: Tone;
};

type PolicyEvent = {
  id: string;
  region: string;
  measure: string;
  products: string;
  source: string;
  severity: 'high' | 'watch' | 'structural';
  implication: string;
};

type PolicySource = {
  id: string;
  name: string;
  role: string;
  status: 'live' | 'partial' | 'target';
  coverage: string;
  bestFor: string;
};

type ChainNode = {
  commodity: string;
  policy: string;
  upstream: string;
  downstream: string;
  marketRead: string;
  tone: Tone;
};

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'events', label: '事件' },
  { id: 'tariffs', label: '关税' },
  { id: 'flows', label: '贸易流' },
  { id: 'remedies', label: '救济' },
  { id: 'ntm', label: '非关税' },
  { id: 'materials', label: '原料' },
];

const KPI_CARDS: PolicyKpi[] = [
  { label: '政策事件层', value: 'GTA', meta: '先发现冲击', tone: 'hot' },
  { label: '官方税率层', value: 'WTO', meta: '法律基准', tone: 'neutral' },
  { label: '产业链敞口', value: 'HS6', meta: '商品到公司', tone: 'watch' },
  { label: '市场传导', value: 'PMKT', meta: '事件到概率', tone: 'cool' },
];

const SOURCE_STATES = {
  gta: 'target',
  wto: 'live',
  wits: 'partial',
  remedies: 'target',
  itip: 'live',
  oecd: 'target',
};

const SOURCE_LABELS = {
  gta: 'GTA',
  wto: 'WTO',
  wits: 'WITS',
  remedies: 'REMEDY',
  itip: 'I-TIP',
  oecd: 'OECD',
};

const POLICY_EVENTS: PolicyEvent[] = [
  {
    id: 'clean-energy-tariffs',
    region: 'US / EU / China',
    measure: 'Tariff + anti-subsidy watch',
    products: 'EVs, solar, batteries, steel',
    source: 'GTA + WTO Remedies',
    severity: 'high',
    implication: '上游金属与本土替代链偏受益，下游整车和组件利润率承压。',
  },
  {
    id: 'critical-minerals-export',
    region: 'Indonesia / LATAM / Africa',
    measure: 'Export tax / license / quota',
    products: 'Nickel, cobalt, lithium, copper',
    source: 'OECD Export Restrictions',
    severity: 'structural',
    implication: '原料价格和库存周期先动，再传导到电池、储能、电子制造。',
  },
  {
    id: 'food-pharma-ntm',
    region: 'EU / Asia-Pacific',
    measure: 'TBT / SPS / import licensing',
    products: 'Food, pharma, chemicals, auto parts',
    source: 'WTO I-TIP',
    severity: 'watch',
    implication: '不是显性加税，但会改变通关时间、合规成本和区域供应商选择。',
  },
  {
    id: 'semiconductor-controls',
    region: 'US / China / Allies',
    measure: 'Export control + investment limit',
    products: 'AI chips, lithography, cloud access',
    source: 'GTA + official notices',
    severity: 'high',
    implication: '对半导体设备、云资本开支、国产替代和地缘市场概率都有直接映射。',
  },
];

const SOURCES: PolicySource[] = [
  {
    id: 'gta',
    name: 'Global Trade Alert',
    role: '政策事件库',
    status: 'target',
    coverage: '关税、出口限制、补贴、制裁、产业政策',
    bestFor: '发现最近哪些国家正在加限制、补贴或做产业保护。',
  },
  {
    id: 'wto-tariff',
    name: 'WTO Tariff & Trade Data',
    role: '官方关税基准',
    status: 'live',
    coverage: 'MFN applied / bound / RTA',
    bestFor: '查国家与 HS code 的法定税率，不把它误当实时政策新闻。',
  },
  {
    id: 'wits',
    name: 'World Bank WITS / UN Comtrade',
    role: '商品级贸易流',
    status: 'partial',
    coverage: 'HS6 商品、进出口、NTM、WTO/TRAINS',
    bestFor: '把政策事件映射到谁出口、谁进口、谁依赖谁。',
  },
  {
    id: 'remedies',
    name: 'WTO Trade Remedies',
    role: '反倾销/反补贴',
    status: 'target',
    coverage: 'AD / CVD / safeguards',
    bestFor: '钢铁、光伏、化工、轮胎、铝材等利润率敏感行业。',
  },
  {
    id: 'itip',
    name: 'WTO I-TIP',
    role: '非关税壁垒',
    status: 'live',
    coverage: 'TBT / SPS / licensing / quantity limits',
    bestFor: '食品、医药、化工、汽车零部件和农产品通关成本。',
  },
  {
    id: 'oecd',
    name: 'OECD Export Restrictions',
    role: '原材料出口限制',
    status: 'target',
    coverage: '出口税、禁令、许可证、配额',
    bestFor: '镍、钴、锂、稀土、铜、铝、铁矿石的下游成本传导。',
  },
];

const CHAIN_NODES: ChainNode[] = [
  {
    commodity: 'Nickel / Cobalt / Lithium',
    policy: '出口税、禁令、许可证',
    upstream: '矿业、精炼、资源国财政',
    downstream: '电池、储能、电动车',
    marketRead: '上游资源股弹性更高，下游毛利率先承压。',
    tone: 'hot',
  },
  {
    commodity: 'Steel / Aluminum',
    policy: '反倾销、保障措施、配额',
    upstream: '本土钢铝、冶炼、电力成本',
    downstream: '建筑、汽车、机械、包装',
    marketRead: '本地生产商受保护，进口依赖制造商成本上升。',
    tone: 'watch',
  },
  {
    commodity: 'Solar / Batteries',
    policy: '反补贴、关税、原产地规则',
    upstream: '多晶硅、电池片、组件',
    downstream: '公用事业、安装商、清洁能源 ETF',
    marketRead: '区域替代链受益，终端装机节奏可能被推迟。',
    tone: 'hot',
  },
  {
    commodity: 'Food / Pharma / Chemicals',
    policy: 'SPS、TBT、进口许可',
    upstream: '农产品、原料药、基础化工',
    downstream: '食品零售、医疗、消费品',
    marketRead: '影响常常体现为交付延迟、合规成本和库存重建。',
    tone: 'neutral',
  },
];

function statusLabel(status: PolicySource['status']) {
  if (status === 'live') return 'LIVE';
  if (status === 'partial') return 'PARTIAL';
  return 'NEXT';
}

function statusTone(status: PolicySource['status']) {
  if (status === 'live') return 'cool';
  if (status === 'partial') return 'watch';
  return 'neutral';
}

function eventTone(event: PolicyEvent) {
  if (event.severity === 'high') return 'hot';
  if (event.severity === 'structural') return 'watch';
  return 'neutral';
}

function TradePolicyRadarPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('events');
  const [showHelp, setShowHelp] = useState(false);
  const activeSources = SOURCES.filter((source) => {
    if (activeTab === 'events') return source.id === 'gta' || source.id === 'wto-tariff';
    if (activeTab === 'tariffs') return source.id === 'wto-tariff';
    if (activeTab === 'flows') return source.id === 'wits';
    if (activeTab === 'remedies') return source.id === 'remedies';
    if (activeTab === 'ntm') return source.id === 'itip';
    return source.id === 'oecd';
  });

  return (
    <Panel
      title="贸易政策雷达"
      badge="BLUEPRINT"
      status="live"
      count={SOURCES.length}
      titleControls={(
        <button
          type="button"
          className="wm-panel-help-button"
          aria-label="Explain trade policy radar"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((current) => !current)}
        >
          ?
        </button>
      )}
      headerOverlay={showHelp ? (
        <div className="wm-panel-help-popover">
          <strong>贸易政策雷达</strong>
          <p>把政策事件、官方税率、商品贸易流、贸易救济、非关税壁垒和原材料出口限制连接成“政策到市场”的监控面板。</p>
        </div>
      ) : null}
      className="wm-market-panel wm-trade-policy-radar-panel"
      dataPanelId="trade-policy-radar"
    >
      <div className="wm-trade-policy-layout">
        <div className={`wm-intel-signal-band ${signalToneClass('watch')}`}>
          <div className="wm-intel-signal-main">
            <PanelGlyph icon="policy" tone="watch" />
            <div className="wm-intel-signal-copy">
              <span>Policy → commodity → chain → PMKT</span>
              <strong>贸易政策冲击工作台</strong>
            </div>
          </div>
          <em>GTA / WTO / WITS / OECD</em>
        </div>

        <div className="wm-trade-policy-kpis">
          {KPI_CARDS.map((item) => (
            <div className={`wm-trade-policy-kpi ${item.tone}`} key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <em>{item.meta}</em>
            </div>
          ))}
        </div>

        <SourceStack sources={SOURCE_STATES} labels={SOURCE_LABELS} />

        <div className="wm-trade-policy-tabs" role="tablist" aria-label="Trade policy views">
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

        {activeTab === 'events' ? <PolicyEventFeed /> : null}
        {activeTab === 'tariffs' ? <SourceDetail sources={activeSources} /> : null}
        {activeTab === 'flows' ? <ChainExposureTable /> : null}
        {activeTab === 'remedies' ? <SourceDetail sources={activeSources} /> : null}
        {activeTab === 'ntm' ? <SourceDetail sources={activeSources} /> : null}
        {activeTab === 'materials' ? <ChainExposureTable filter="materials" /> : null}
      </div>
    </Panel>
  );
}

function PolicyEventFeed() {
  return (
    <div className="wm-trade-policy-feed">
      {POLICY_EVENTS.map((event) => {
        const tone = eventTone(event);
        return (
          <article className={`wm-trade-policy-event ${tone}`} key={event.id}>
            <div className="wm-trade-policy-event-head">
              <span>{event.region}</span>
              <em>{event.source}</em>
            </div>
            <strong>{event.measure}</strong>
            <p>{event.products}</p>
            <div className="wm-trade-policy-impact">{event.implication}</div>
          </article>
        );
      })}
    </div>
  );
}

function SourceDetail({ sources }: { sources: PolicySource[] }) {
  return (
    <div className="wm-trade-policy-source-grid">
      {sources.map((source) => (
        <article className={`wm-trade-policy-source-card ${statusTone(source.status)}`} key={source.id}>
          <div className="wm-trade-policy-source-head">
            <span>{source.role}</span>
            <em>{statusLabel(source.status)}</em>
          </div>
          <strong>{source.name}</strong>
          <p>{source.coverage}</p>
          <div>{source.bestFor}</div>
        </article>
      ))}
    </div>
  );
}

function ChainExposureTable({ filter }: { filter?: 'materials' }) {
  const rows = filter === 'materials'
    ? CHAIN_NODES.filter((node) => /Nickel|Steel|Solar/.test(node.commodity))
    : CHAIN_NODES;

  return (
    <div className="wm-trade-policy-chain">
      {rows.map((node) => (
        <article className={`wm-trade-policy-chain-row ${node.tone}`} key={node.commodity}>
          <div>
            <span>商品 / 政策</span>
            <strong>{node.commodity}</strong>
            <em>{node.policy}</em>
          </div>
          <div>
            <span>上游</span>
            <strong>{node.upstream}</strong>
          </div>
          <div>
            <span>下游</span>
            <strong>{node.downstream}</strong>
          </div>
          <p>{node.marketRead}</p>
        </article>
      ))}
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
  title: 'Trade Policy Radar',
  eyebrow: 'world',
  description: 'Trade policy shock radar linking public policy sources to commodities, supply chains, and market implications.',
  defaultEnabled: true,
});
