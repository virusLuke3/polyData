"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startTransition, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/utils";
import type { MarketListResponse } from "@/types";

export function MarketsExplorer({ initialStatus, initialQuery, data }: { initialStatus: string; initialQuery: string; data: MarketListResponse }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);

  function updateParams(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(next).forEach(([key, value]) => {
      if (!value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <CardTitle>Markets Explorer</CardTitle>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <Tabs value={initialStatus} onValueChange={(value) => updateParams({ status: value, page: "1" })}>
              <TabsList>
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="closed">Closed</TabsTrigger>
              </TabsList>
            </Tabs>
            <form
              className="flex gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                updateParams({ q: query, page: "1" });
              }}
            >
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title or contract id" />
              <Button type="submit">Filter</Button>
            </form>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Latest Price</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Tags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((market) => (
                <TableRow key={market.id}>
                  <TableCell>
                    <Link href={`/markets/${market.id}`} className="font-medium hover:text-primary">
                      {market.title}
                    </Link>
                    <div className="mt-1 text-xs text-muted-foreground">{market.conditionId.slice(0, 18)}...</div>
                  </TableCell>
                  <TableCell>{formatDate(market.endDate)}</TableCell>
                  <TableCell>{market.latestPrice || "-"}</TableCell>
                  <TableCell>{market.category}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {market.tags.slice(0, 2).map((tag) => (
                        <Badge key={tag} variant="outline">{tag}</Badge>
                      ))}
                      <Badge variant="default">{market.status}</Badge>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-6 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Page {data.pagination.page}
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                disabled={data.pagination.page <= 1}
                onClick={() => updateParams({ page: String(data.pagination.page - 1) })}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={!data.pagination.hasMore}
                onClick={() => updateParams({ page: String(data.pagination.page + 1) })}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}