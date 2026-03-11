"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VolumePoint } from "@/types";

export function VolumeChart({ title, data }: { title: string; data: VolumePoint[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={20} tick={{ fill: "#71717a", fontSize: 11, fontFamily: "var(--font-mono)" }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: "#71717a", fontSize: 11, fontFamily: "var(--font-mono)" }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#131722",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "8px",
                  color: "#e4e4e7"
                }}
                labelStyle={{ color: "#a1a1aa", fontFamily: "var(--font-mono)" }}
                cursor={{ fill: "rgba(255,255,255,0.03)" }}
              />
              <Bar dataKey="trade_count" fill="#00ffaa" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}