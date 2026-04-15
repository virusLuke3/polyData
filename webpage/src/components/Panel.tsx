import { type ComponentChildren } from 'preact';

type PanelProps = {
  title: string;
  badge?: string;
  count?: string | number;
  status?: 'live' | 'locked' | 'muted';
  children: ComponentChildren;
};

export function Panel({ title, badge, count, status = 'live', children }: PanelProps) {
  return (
    <section className="wm-panel">
      <header className="wm-panel-header">
        <div className="wm-panel-title-wrap">
          <h3 className="wm-panel-title">{title}</h3>
          {badge ? <span className={`wm-panel-badge ${status}`}>{badge}</span> : null}
        </div>
        {count !== undefined ? <span className="wm-panel-count">{count}</span> : null}
      </header>
      <div className="wm-panel-body">{children}</div>
    </section>
  );
}
