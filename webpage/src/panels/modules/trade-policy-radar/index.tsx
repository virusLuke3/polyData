import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import type { PanelRenderMap } from '../../types';
import { panelFromRenderer } from '../helpers';
import './styles.css';

type TabId = 'events' | 'tariffs' | 'flows' | 'remedies' | 'ntm' | 'materials';
type Tone = 'up' | 'down' | 'watch' | 'neutral';

type PolicyEvent = {
  id: string;
  source: string;
  sourceClass: string;
  category: string;
  tag: string;
  tagTone: Tone;
  title: string;
  summary: string;
  age: string;
  readout: string;
};

type RateRow = {
  market: string;
  code: string;
  value: string;
  change: string;
  tone: Tone;
  meta: string;
};

type ChainRow = {
  commodity: string;
  policy: string;
  upstream: string;
  downstream: string;
  readout: string;
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

const KPI_ROWS = [
  { label: 'EVENTS', value: '12', meta: '30D', tone: 'watch' },
  { label: 'RESTRICTIVE', value: '67%', meta: 'GTA LENS', tone: 'down' },
  { label: 'INPUT SHOCK', value: '4', meta: 'HS6 WATCH', tone: 'up' },
  { label: 'PMKT LINK', value: '8', meta: 'ACTIVE MKTS', tone: 'neutral' },
] satisfies Array<{ label: string; value: string; meta: string; tone: Tone }>;

const EVENTS: PolicyEvent[] = [
  {
    id: 'ev-batteries',
    source: 'GLOBAL TRADE ALERT',
    sourceClass: 'GTA',
    category: 'CLEAN ENERGY',
    tag: 'TARIFF',
    tagTone: 'down',
    title: 'US/EU clean-energy tariff pressure keeps battery and EV supply-chain risk elevated',
    summary: 'EVs, solar modules, batteries and steel remain the cleanest policy-to-margin transmission path.',
    age: '2H AGO',
    readout: '上游金属、本土替代链偏强；下游整车与组件毛利率承压。',
  },
  {
    id: 'ev-minerals',
    source: 'OECD',
    sourceClass: 'OECD',
    category: 'RAW MATERIALS',
    tag: 'EXPORT',
    tagTone: 'watch',
    title: 'Nickel, cobalt and lithium export restrictions are the upstream cost shock to monitor',
    summary: 'Export taxes, quotas and licensing regimes can reprice battery inputs before official trade data updates.',
    age: '7H AGO',
    readout: '先看资源国、矿业股、精炼产能，再看电池与储能成本。',
  },
  {
    id: 'ev-ntm',
    source: 'WTO I-TIP',
    sourceClass: 'I-TIP',
    category: 'TBT / SPS',
    tag: 'NTM',
    tagTone: 'neutral',
    title: 'Non-tariff barriers matter most for food, pharma, chemicals and auto parts',
    summary: 'TBT/SPS, import licensing and quantity limits usually show up as delays, compliance cost and supplier shifts.',
    age: '11H AGO',
    readout: '不一定直接加税，但会改变库存周期、交付时间和区域供应商。',
  },
  {
    id: 'ev-remedy',
    source: 'WTO REMEDIES',
    sourceClass: 'REMEDY',
    category: 'AD / CVD',
    tag: 'PROBE',
    tagTone: 'down',
    title: 'Trade-remedy investigations are the fastest margin shock for steel, solar and chemicals',
    summary: 'Anti-dumping and countervailing duties can turn an investigation headline into a pricing event quickly.',
    age: '1D AGO',
    readout: '钢铁、光伏、化工、轮胎、铝材需要单独盯调查状态。',
  },
];

const TARIFF_ROWS: RateRow[] = [
  { market: 'WTO MFN BASE', code: 'US / CN', value: '3.4%', change: '+0.0pp', tone: 'neutral', meta: 'official baseline' },
  { market: 'EFFECTIVE RATE', code: 'US IMPORTS', value: '11.8%', change: '+8.4pp', tone: 'down', meta: 'policy layer' },
  { market: 'BOUND DUTY', code: 'EU STEEL', value: '0-2%', change: 'stable', tone: 'neutral', meta: 'legal ceiling' },
  { market: 'RTA CHECK', code: 'ASEAN', value: 'mixed', change: 'watch', tone: 'watch', meta: 'preferential rates' },
];

const FLOW_ROWS: ChainRow[] = [
  {
    commodity: 'Nickel / Cobalt / Lithium',
    policy: 'export tax / quota / license',
    upstream: 'miners / refiners',
    downstream: 'battery / EV / storage',
    readout: '资源端弹性更高，下游先看毛利率压缩。',
    tone: 'down',
  },
  {
    commodity: 'Steel / Aluminum',
    policy: 'AD / CVD / safeguard',
    upstream: 'domestic producers',
    downstream: 'autos / machinery / packaging',
    readout: '本土产能受保护，进口依赖制造商成本上升。',
    tone: 'watch',
  },
  {
    commodity: 'Solar / Batteries',
    policy: 'tariff / origin rule',
    upstream: 'polysilicon / cells / modules',
    downstream: 'utilities / installers / clean ETF',
    readout: '区域替代链受益，终端装机节奏可能被推迟。',
    tone: 'down',
  },
  {
    commodity: 'Food / Pharma / Chemicals',
    policy: 'TBT / SPS / licensing',
    upstream: 'agri / API / base chemicals',
    downstream: 'retail / healthcare / consumer',
    readout: '主要体现为通关延迟、合规成本和库存重建。',
    tone: 'neutral',
  },
];

function toneClass(tone: Tone) {
  return `tone-${tone}`;
}

function TradePolicyRadarPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('events');
  const [showHelp, setShowHelp] = useState(false);

  return (
    <Panel
      title="贸易政策"
      badge="LIVE"
      status="live"
      count={12}
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
          <strong>贸易政策雷达</strong>
          <p>事件用 GTA，关税用 WTO，贸易流用 WITS/Comtrade，救济/非关税/原料限制分别映射到行业和 Polymarket 主题。</p>
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

        <div className="wm-trade-kpi-strip">
          {KPI_ROWS.map((row) => (
            <span className={toneClass(row.tone)} key={row.label}>
              <b>{row.label}</b>
              <strong>{row.value}</strong>
              <em>{row.meta}</em>
            </span>
          ))}
        </div>

        {activeTab === 'events' ? <PolicyNewsList /> : null}
        {activeTab === 'tariffs' ? <TariffTape /> : null}
        {activeTab === 'flows' ? <ChainTape rows={FLOW_ROWS} /> : null}
        {activeTab === 'remedies' ? <PolicyNewsList filter="REMEDY" /> : null}
        {activeTab === 'ntm' ? <PolicyNewsList filter="I-TIP" /> : null}
        {activeTab === 'materials' ? <ChainTape rows={FLOW_ROWS.filter((row) => /Nickel|Steel|Solar/.test(row.commodity))} /> : null}
      </div>
    </Panel>
  );
}

function PolicyNewsList({ filter }: { filter?: string }) {
  const rows = filter ? EVENTS.filter((event) => event.sourceClass === filter) : EVENTS;
  return (
    <div className="wm-trade-news-list">
      {rows.map((event) => (
        <article className="wm-trade-news-row" key={event.id}>
          <div className="wm-trade-news-meta">
            <span className="wm-trade-dot" />
            <b>{event.category}</b>
            <em>{event.source}</em>
            <i className={`wm-trade-tag ${toneClass(event.tagTone)}`}>{event.tag}</i>
          </div>
          <strong>{event.title}</strong>
          <p>{event.summary}</p>
          <div className="wm-trade-news-foot">
            <span>{event.age}</span>
            <b>READ SOURCE</b>
          </div>
          <div className="wm-trade-readout">{event.readout}</div>
        </article>
      ))}
    </div>
  );
}

function TariffTape() {
  return (
    <div className="wm-trade-rate-table">
      <div className="wm-trade-rate-head">
        <span>CODE</span>
        <span>RATE</span>
        <span>MOVE</span>
      </div>
      {TARIFF_ROWS.map((row) => (
        <div className="wm-trade-rate-row" key={`${row.market}-${row.code}`}>
          <div>
            <strong>{row.market}</strong>
            <em>{row.code}</em>
          </div>
          <b>{row.value}</b>
          <span className={toneClass(row.tone)}>{row.change}</span>
          <i>{row.meta}</i>
        </div>
      ))}
    </div>
  );
}

function ChainTape({ rows }: { rows: ChainRow[] }) {
  return (
    <div className="wm-trade-chain-table">
      {rows.map((row) => (
        <article className="wm-trade-chain-row" key={row.commodity}>
          <div className="wm-trade-chain-main">
            <strong>{row.commodity}</strong>
            <em>{row.policy}</em>
          </div>
          <div className="wm-trade-chain-pair">
            <span>UP</span>
            <b>{row.upstream}</b>
          </div>
          <div className="wm-trade-chain-pair">
            <span>DOWN</span>
            <b>{row.downstream}</b>
          </div>
          <p className={toneClass(row.tone)}>{row.readout}</p>
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
