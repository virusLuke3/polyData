"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StatusShare } from "@/types";

const DARK_COLORS = ["#00ffaa", "#22d3ee", "#f59e0b", "#f43f5e", "#64748b"];

export function StatusPieChart({ data }: { data: StatusShare[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Market Status Share</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[1fr_180px] md:items-center">
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={3}>
                {data.map((entry, index) => (
                  <Cell key={entry.name} fill={DARK_COLORS[index % DARK_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "#131722",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "8px",
                  color: "#e4e4e7"
                }}
                labelStyle={{ color: "#a1a1aa", fontFamily: "var(--font-mono)" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-3">
          {data.map((entry, index) => (
            <div key={entry.name} className="flex items-center justify-between rounded-md border border-white/5 bg-white/[0.03] px-4 py-3 text-sm text-zinc-300">
              <div className="flex items-center gap-3">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: DARK_COLORS[index % DARK_COLORS.length] }} />
                {entry.name}
              </div>
              <span className="font-mono font-semibold text-zinc-100">{entry.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}