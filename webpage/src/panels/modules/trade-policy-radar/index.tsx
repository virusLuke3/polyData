import { useMemo, useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import type { PanelRenderMap } from '../../types';
import { panelFromRenderer } from '../helpers';
import './styles.css';

type TabId = 'events' | 'tariffs' | 'flows' | 'remedies' | 'ntm' | 'materials';
type Tone = 'up' | 'down' | 'watch' | 'neutral';

type PolicyItem = {
  id: string;
  tab: TabId;
  source: string;
  category: string;
  tag: string;
  tone: Tone;
  title: string;
  region: string;
  measure: string;
  products: string;
  impact: string;
  market: string;
  updated: string;
};

const TABS: Array<{ id: TabId; label: string; hint: string }> = [
  { id: 'events', label: '事件', hint: '先看政策动作' },
  { id: 'tariffs', label: '关税', hint: '官方税率基准' },
  { id: 'flows', label: '贸易流', hint: '谁依赖谁' },
  { id: 'remedies', label: '救济', hint: '反倾销反补贴' },
  { id: 'ntm', label: '非关税', hint: '许可标准配额' },
  { id: 'materials', label: '原料', hint: '出口限制' },
];

const DEFAULT_TAB_META = TABS[0] as { id: TabId; label: string; hint: string };

const POLICY_ITEMS: PolicyItem[] = [
  {
    id: 'event-clean-energy',
    tab: 'events',
    source: '全球贸易预警',
    category: '清洁能源',
    tag: '关税',
    tone: 'down',
    title: '美国和欧盟继续围绕电动车、太阳能组件、电池加码贸易限制',
    region: '美国 / 欧盟 / 中国',
    measure: '新增关税、反补贴调查、原产地规则收紧',
    products: '电动车、太阳能组件、锂电池、钢铝材料',
    impact: '本土替代链和上游金属受益，进口依赖的整车和组件厂毛利率承压。',
    market: '清洁能源补贴、太阳能关税、电动车销量、锂电池价格相关市场',
    updated: '2小时前',
  },
  {
    id: 'event-chip-control',
    tab: 'events',
    source: '各国政府公告',
    category: '半导体',
    tag: '出口管制',
    tone: 'watch',
    title: '先进芯片、光刻设备和云算力限制继续影响半导体供应链',
    region: '美国 / 中国 / 日本 / 荷兰',
    measure: '出口许可、投资限制、设备销售限制',
    products: '人工智能芯片、先进制程设备、云计算服务',
    impact: '设备商订单节奏和国产替代预期会先动，随后传导到云资本开支。',
    market: '人工智能芯片出口、半导体设备销售、中国科技政策相关市场',
    updated: '6小时前',
  },
  {
    id: 'tariff-us-china',
    tab: 'tariffs',
    source: '世贸组织关税库',
    category: '官方税率',
    tag: '税率',
    tone: 'neutral',
    title: '用官方税率库确认国家和商品编码的法定关税基准',
    region: '美国 / 中国 / 欧盟',
    measure: '最惠国税率、约束税率、区域协定税率',
    products: '钢铁、铝材、汽车零部件、电子产品',
    impact: '这是测算政策冲击的基准层，不等同于实时新闻，但能判断加税空间。',
    market: '进口成本、制造业利润率、区域替代链相关市场',
    updated: '每日校验',
  },
  {
    id: 'tariff-effective',
    tab: 'tariffs',
    source: '世贸组织关税库',
    category: '有效税率',
    tag: '叠加',
    tone: 'down',
    title: '实际进口成本要把基础税率、额外关税和贸易救济税叠加看',
    region: '美国 / 欧盟',
    measure: '基础关税 + 额外关税 + 反倾销或反补贴税',
    products: '光伏组件、钢管、轮胎、化工品',
    impact: '单看最惠国税率会低估真实成本，叠加税率才对应企业毛利率。',
    market: '钢铁、光伏、化工、轮胎行业利润率相关市场',
    updated: '每日校验',
  },
  {
    id: 'flow-battery-chain',
    tab: 'flows',
    source: '世界银行贸易数据库',
    category: '产业链',
    tag: '贸易流',
    tone: 'watch',
    title: '把商品编码映射到进出口流，判断哪个国家和公司真正暴露',
    region: '印尼 / 中国 / 韩国 / 美国 / 欧盟',
    measure: '按商品编码追踪出口国、进口国、贸易额和替代来源',
    products: '镍、钴、锂、电池材料、电池包',
    impact: '贸易限制先影响资源和精炼环节，再影响电池、储能和整车成本。',
    market: '镍价、锂价、电动车成本、储能装机相关市场',
    updated: '月度更新',
  },
  {
    id: 'flow-steel-chain',
    tab: 'flows',
    source: '联合国商品贸易库',
    category: '产业链',
    tag: '敞口',
    tone: 'neutral',
    title: '钢铝贸易流可以拆出上游受益者和下游成本承压者',
    region: '美国 / 欧盟 / 中国 / 土耳其 / 印度',
    measure: '进口依赖度、替代供应商、出口目的地集中度',
    products: '热轧卷、铝材、钢管、机械零部件',
    impact: '本土钢铝企业可能受保护，下游汽车、机械、包装企业成本上升。',
    market: '钢铁价格、制造业利润率、汽车成本相关市场',
    updated: '月度更新',
  },
  {
    id: 'remedy-solar',
    tab: 'remedies',
    source: '世贸组织贸易救济库',
    category: '贸易救济',
    tag: '反补贴',
    tone: 'down',
    title: '光伏、钢铁、化工是反倾销和反补贴调查最敏感的行业',
    region: '美国 / 欧盟 / 中国 / 东南亚',
    measure: '反倾销调查、反补贴调查、保障措施',
    products: '太阳能电池、组件、钢铁、化工中间体',
    impact: '调查公告本身就可能改变订单和报价，终裁税率会进一步改变利润率。',
    market: '太阳能关税、钢铁进口限制、化工出口相关市场',
    updated: '1天前',
  },
  {
    id: 'ntm-food-pharma',
    tab: 'ntm',
    source: '世贸组织贸易措施门户',
    category: '非关税',
    tag: '标准',
    tone: 'watch',
    title: '技术标准、卫生检疫和进口许可会改变食品医药化工的通关速度',
    region: '欧盟 / 亚洲 / 北美',
    measure: '技术性贸易壁垒、卫生检疫、进口许可、数量限制',
    products: '农产品、食品、药品原料、化工品、汽车零部件',
    impact: '不一定直接加税，但会造成交付延迟、合规成本上升和库存重建。',
    market: '食品通胀、药品短缺、化工供应链相关市场',
    updated: '11小时前',
  },
  {
    id: 'materials-critical-minerals',
    tab: 'materials',
    source: '经合组织原料限制库',
    category: '工业原料',
    tag: '出口限制',
    tone: 'down',
    title: '镍、钴、锂、铜、稀土的出口限制会先冲击上游价格',
    region: '印尼 / 智利 / 刚果（金）/ 中国',
    measure: '出口税、出口禁令、许可证、配额',
    products: '镍、钴、锂、铜、稀土、铝、铁矿石',
    impact: '资源国和矿业股弹性更高，下游电池、电子和新能源制造先看毛利率压缩。',
    market: '关键矿产价格、电池成本、资源国政策相关市场',
    updated: '7小时前',
  },
];

function toneClass(tone: Tone) {
  return `tone-${tone}`;
}

function TradePolicyRadarPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('events');
  const [showHelp, setShowHelp] = useState(false);
  const activeTabMeta = TABS.find((tab) => tab.id === activeTab) || DEFAULT_TAB_META;
  const activeItems = useMemo(
    () => POLICY_ITEMS.filter((item) => item.tab === activeTab),
    [activeTab],
  );

  return (
    <Panel
      title="贸易政策"
      badge="实时"
      status="live"
      count={activeItems.length}
      titleControls={(
        <button
          type="button"
          className="wm-panel-help-button"
          aria-label="说明贸易政策面板"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((current) => !current)}
        >
          ?
        </button>
      )}
      headerOverlay={showHelp ? (
        <div className="wm-panel-help-popover">
          <strong>贸易政策</strong>
          <p>把政策事件、官方税率、贸易流、贸易救济、非关税措施和原材料出口限制，直接映射到商品、行业和预测市场。</p>
        </div>
      ) : null}
      className="wm-market-panel wm-trade-policy-radar-panel"
      dataPanelId="trade-policy-radar"
    >
      <div className="wm-trade-terminal">
        <div className="wm-trade-tabs" role="tablist" aria-label="贸易政策视图">
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

        <div className="wm-trade-news-list">
          {activeItems.map((item) => (
            <PolicyRow item={item} key={item.id} />
          ))}
        </div>
      </div>
    </Panel>
  );
}

function PolicyRow({ item }: { item: PolicyItem }) {
  return (
    <article className="wm-trade-news-row">
      <div className="wm-trade-news-meta">
        <span className="wm-trade-dot" />
        <b>{item.category}</b>
        <em>{item.source}</em>
        <i className={`wm-trade-tag ${toneClass(item.tone)}`}>{item.tag}</i>
      </div>

      <strong>{item.title}</strong>

      <div className="wm-trade-facts">
        <Fact label="地区" value={item.region} />
        <Fact label="措施" value={item.measure} />
        <Fact label="商品" value={item.products} />
      </div>

      <p>{item.impact}</p>

      <div className="wm-trade-readout">
        <span>市场映射</span>
        <b>{item.market}</b>
      </div>

      <div className="wm-trade-news-foot">
        <span>{item.updated}</span>
        <b>来源：{item.source}</b>
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
  title: '贸易政策',
  eyebrow: '全球',
  description: '把公开贸易政策数据源映射到商品、产业链和预测市场。',
  defaultEnabled: true,
});
