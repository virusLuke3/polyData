"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Activity, CandlestickChart, Clock3, Landmark } from "lucide-react";

const panels = [
  {
    href: "/",
    title: "Live Overview",
    description: "Metrics, volume pulses, status split",
    icon: Activity,
    isActive: (pathname: string) => pathname === "/"
  },
  {
    href: "/markets?status=active",
    title: "Markets Explorer",
    description: "Active and closed markets with filters",
    icon: CandlestickChart,
    isActive: (pathname: string, status: string | null) => pathname === "/markets" && (status === "active" || status === null)
  },
  {
    href: "/markets?status=closed",
    title: "Settlement History",
    description: "Closed and settled market archive",
    icon: Clock3,
    isActive: (pathname: string, status: string | null) => pathname === "/markets" && status === "closed"
  },
  {
    href: "/markets?status=active&q=oracle",
    title: "Oracle Lens",
    description: "Track propose and settle event chains",
    icon: Landmark,
    isActive: (pathname: string, _status: string | null, query: string | null) => pathname === "/markets" && (query?.includes("oracle") || query?.includes("settled") || false)
  }
];

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <aside className="hidden xl:block xl:w-80">
      <div className="terminal-panel overflow-hidden rounded-md p-4">
        <div className="border-b border-white/5 pb-3 text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Navigation</div>
        <div className="mt-4 space-y-2">
          {panels.map((panel) => {
            const Icon = panel.icon;
            const active = panel.isActive(pathname, searchParams.get("status"), searchParams.get("q"));
            return (
              <Link
                key={panel.href}
                href={panel.href}
                className={[
                  "group flex items-start gap-3 rounded-md border px-3 py-3 transition",
                  active
                    ? "border-emerald-400/20 bg-emerald-400/10 shadow-glow"
                    : "border-white/5 bg-white/[0.02] hover:border-cyan-400/20 hover:bg-cyan-400/[0.06]"
                ].join(" ")}
              >
                <div className={[
                  "mt-0.5 rounded-sm border p-2",
                  active ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-white/5 bg-white/[0.03] text-cyan-300"
                ].join(" ")}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="border-l border-white/5 pl-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-200">{panel.title}</div>
                  <div className="mt-1 text-xs leading-5 text-zinc-500">{panel.description}</div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </aside>
  );
}