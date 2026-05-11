import { type ComponentChildren } from 'preact';

type PanelProps = {
  title: string;
  badge?: string;
  count?: string | number;
  status?: 'live' | 'locked' | 'muted';
  titleControls?: ComponentChildren;
  controls?: ComponentChildren;
  headerOverlay?: ComponentChildren;
  className?: string;
  dataPanelId?: string;
  children: ComponentChildren;
};

export function Panel({ title, badge, count, status = 'live', titleControls, controls, headerOverlay, className, dataPanelId, children }: PanelProps) {
  return (
    <section className={`wm-panel${className ? ` ${className}` : ''}`} data-panel-id={dataPanelId}>
      <header className="wm-panel-header">
        <div className="wm-panel-title-wrap">
          <h3 className="wm-panel-title">{title}</h3>
          {titleControls ? <div className="wm-panel-title-controls">{titleControls}</div> : null}
          {badge ? <span className={`wm-panel-badge ${status}`}>{badge}</span> : null}
        </div>
        <div className="wm-panel-header-right">
          {controls}
          {count !== undefined ? <span className="wm-panel-count">{count}</span> : null}
        </div>
      </header>
      {headerOverlay ? <div className="wm-panel-header-overlay">{headerOverlay}</div> : null}
      <div className="wm-panel-body">{children}</div>
    </section>
  );
}
