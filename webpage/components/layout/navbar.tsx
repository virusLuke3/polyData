"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, DatabaseZap } from "lucide-react";
import { FormEvent, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const navItems = [
  {
    href: "/",
    label: "Dashboard",
    isActive: (pathname: string) => pathname === "/"
  },
  {
    href: "/markets?status=active",
    label: "Active Markets",
    isActive: (pathname: string, status: string | null) => pathname === "/markets" && (status === "active" || status === null)
  },
  {
    href: "/markets?status=closed",
    label: "History",
    isActive: (pathname: string, status: string | null) => pathname === "/markets" && status === "closed"
  },
  {
    href: "/markets?status=active&q=settled",
    label: "Oracle Events",
    isActive: (pathname: string, _status: string | null, query: string | null) => pathname === "/markets" && (query?.includes("settled") || query?.includes("oracle") || false)
  }
];

export function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(() => {
      router.push(`/markets?q=${encodeURIComponent(query.trim())}`);
    });
  }

  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-[#0b0e14]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-md border border-emerald-400/20 bg-emerald-400/10 text-emerald-300 shadow-glow">
              <DatabaseZap className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.32em] text-zinc-100">polyData</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Polymarket Intelligence Console</div>
            </div>
          </Link>
          <nav className="hidden items-center gap-1 lg:flex">
            {navItems.map((item) => (
              <Button
                asChild
                key={item.href}
                variant="ghost"
                size="sm"
                className={item.isActive(pathname, searchParams.get("status"), searchParams.get("q")) ? "border-l-2 border-l-emerald-400 bg-white/[0.04] text-zinc-100" : "border-l-2 border-l-transparent"}
              >
                <Link href={item.href} className="uppercase tracking-[0.16em] text-[11px]">
                  {item.label}
                </Link>
              </Button>
            ))}
          </nav>
        </div>

        <form onSubmit={onSubmit} className="flex w-full max-w-xl items-center gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              className="pl-10 font-mono"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by market title, condition id, question id"
            />
          </div>
          <Button type="submit" className="font-mono uppercase tracking-[0.16em]">
            Search
          </Button>
        </form>
      </div>
    </header>
  );
}