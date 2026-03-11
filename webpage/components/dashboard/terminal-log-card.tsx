import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCompactNumber, formatTime } from "@/lib/utils";
import type { RecentMarket } from "@/types";

const statusTone: Record<string, string> = {
  Active: "text-emerald-300",
  Closed: "text-zinc-300",
  Settled: "text-cyan-300",
  Proposed: "text-amber-300"
};

export function TerminalLogCard({ title, items }: { title: string; items: RecentMarket[] }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-white/5 pb-4">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[420px] overflow-y-auto">
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/markets/${item.id}`}
              className="block border-b border-white/5 px-5 py-4 transition hover:bg-white/[0.03]"
            >
              <div className="font-mono text-sm leading-7 text-zinc-200">
                <span className="text-zinc-500">[{formatTime(item.lastTradeAt)}]</span>{" "}
                <span className={statusTone[item.status] ?? "text-cyan-300"}>[{item.status.toUpperCase()}]</span>{" "}
                <span className="text-zinc-100">MID:{item.id}</span>{" "}
                <span className="text-zinc-400">TRADES:</span>{" "}
                <span className="text-zinc-100">{formatCompactNumber(item.tradeCount)}</span>{" "}
                <span className="text-zinc-400">PX:</span>{" "}
                <span className="text-zinc-100">{item.latestPrice ?? "-"}</span>
              </div>
              <div className="mt-1 line-clamp-1 font-mono text-xs text-zinc-500">{item.title}</div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}