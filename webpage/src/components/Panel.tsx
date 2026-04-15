import { type ComponentChildren } from 'preact';

type PanelProps = {
  title: string;
  badge?: string;
  count?: string | number;
  status?: 'live' | 'locked' | 'muted';
  controls?: ComponentChildren;
  className?: string;
  children: ComponentChildren;
};

export function Panel({ title, badge, count, status = 'live', controls, className, children }: PanelProps) {
  return (
    <section className={`wm-panel${className ? ` ${className}` : ''}`}>
      <header className="wm-panel-header">
        <div className="wm-panel-title-wrap">
          <h3 className="wm-panel-title">{title}</h3>
          {badge ? <span className={`wm-panel-badge ${status}`}>{badge}</span> : null}
        </div>
        <div className="wm-panel-header-right">
          {controls}
          {count !== undefined ? <span className="wm-panel-count">{count}</span> : null}
        </div>
      </header>
      <div className="wm-panel-body">{children}</div>
    </section>
  );
}
