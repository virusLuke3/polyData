"use client";

import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PricePoint } from "@/types";

export function MarketPriceChart({ data }: { data: PricePoint[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>YES / NO Price Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="timestamp" tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis tickLine={false} axisLine={false} domain={[0, 1]} />
              <Tooltip />
              <Line type="monotone" dataKey="yesPrice" stroke="#0f766e" strokeWidth={2.5} dot={false} name="YES" />
              <Line type="monotone" dataKey="noPrice" stroke="#be123c" strokeWidth={2.5} dot={false} name="NO" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}