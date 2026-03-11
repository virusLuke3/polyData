import { Activity, ArrowRightLeft, Scale } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCompactNumber } from "@/lib/utils";
import type { DashboardMetrics } from "@/types";

export function MetricCards({ metrics }: { metrics: DashboardMetrics }) {
  const items = [
    { label: "Active Markets", value: metrics.activeMarkets, icon: Activity, accent: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" },
    { label: "Total Trades", value: metrics.totalTrades, icon: ArrowRightLeft, accent: "border-cyan-400/20 bg-cyan-400/10 text-cyan-300" },
    { label: "Oracle Settlements / 24h", value: metrics.settlements24h, icon: Scale, accent: "border-amber-400/20 bg-amber-400/10 text-amber-300" }
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Card key={item.label} className="terminal-grid overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle>{item.label}</CardTitle>
              <div className={`rounded-sm border p-2 ${item.accent}`}>
                <Icon className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="terminal-glow font-mono text-3xl font-semibold tracking-tight text-zinc-100">{formatCompactNumber(item.value)}</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}