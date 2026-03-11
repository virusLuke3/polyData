import { MetricCards } from "@/components/dashboard/metric-cards";
import { TerminalLogCard } from "@/components/dashboard/terminal-log-card";
import { StatusPieChart } from "@/components/charts/status-pie-chart";
import { VolumeChart } from "@/components/charts/volume-chart";
import { getDashboardData } from "@/lib/api";

export default async function DashboardPage() {
  const dashboard = await getDashboardData();

  return (
    <div className="space-y-6 pb-8">
      <section className="terminal-panel terminal-grid overflow-hidden rounded-md p-6 lg:p-8">
        <div className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
          <div className="space-y-4">
            <div className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-400">Dashboard Core</div>
            <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-balance text-zinc-100 lg:text-5xl">
              Market structure, trade flow, and oracle resolution in one dark quant surface.
            </h1>
            <p className="max-w-3xl text-sm leading-7 text-zinc-400 lg:text-base">
              Real-time market inventory, settlement cadence, and trade pressure rendered like an execution terminal instead of a marketing dashboard.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-md border border-emerald-400/10 bg-emerald-400/[0.06] p-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Primary Signal</div>
              <div className="mt-3 font-mono text-lg text-emerald-300 terminal-glow">Active market pulse online</div>
            </div>
            <div className="rounded-md border border-cyan-400/10 bg-cyan-400/[0.06] p-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Data Source</div>
              <div className="mt-3 font-mono text-lg text-cyan-300">Warehouse + live API composition</div>
            </div>
            <div className="rounded-md border border-white/5 bg-white/[0.03] p-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Render Mode</div>
              <div className="mt-3 font-mono text-lg text-zinc-100">Server-side dynamic fetch pipeline</div>
            </div>
          </div>
        </div>
      </section>

      <MetricCards metrics={dashboard.metrics} />

      <section className="grid gap-6 xl:grid-cols-[1.25fr_0.9fr]">
        <VolumeChart title="Trade Volume Trend · Last 7 Days" data={dashboard.volume7d} />
        <StatusPieChart data={dashboard.statusShare} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
        <VolumeChart title="Trade Volume Trend · Last 30 Days" data={dashboard.volume30d} />
        <TerminalLogCard title="Recent Trade Terminal" items={dashboard.recentActiveMarkets} />
      </section>
    </div>
  );
}