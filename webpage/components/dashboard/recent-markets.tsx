import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import type { RecentMarket } from "@/types";

function statusVariant(status: string) {
  if (status === "Settled") return "danger" as const;
  if (status === "Proposed") return "warning" as const;
  return "success" as const;
}

export function RecentMarketsTable({ items }: { items: RecentMarket[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recently Active Markets</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Market</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Trades</TableHead>
              <TableHead>Last Trade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <Link href={`/markets/${item.id}`} className="font-medium hover:text-primary">
                    {item.title}
                  </Link>
                  <div className="mt-1 text-xs text-muted-foreground">{item.slug}</div>
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                </TableCell>
                <TableCell>{item.tradeCount}</TableCell>
                <TableCell>{formatDate(item.lastTradeAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}