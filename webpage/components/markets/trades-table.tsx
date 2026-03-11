import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import type { Trade } from "@/types";

export function TradesTable({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) {
    return <div className="rounded-md border border-white/5 bg-white/[0.02] px-4 py-6 font-mono text-sm text-zinc-500">No indexed trades for this market yet. This can mean the market has not traded, or the trade backfill for these tokens is not complete.</div>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>Side</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>Price</TableHead>
          <TableHead>Tx</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trades.map((trade) => (
          <TableRow key={`${trade.txHash}-${trade.logIndex}`}>
            <TableCell>{formatDate(trade.timestamp)}</TableCell>
            <TableCell>
              <Badge variant={trade.side === "BUY" ? "success" : "warning"}>{trade.side}</Badge>
            </TableCell>
            <TableCell>{trade.outcome ?? "-"}</TableCell>
            <TableCell>{trade.size}</TableCell>
            <TableCell>{trade.price}</TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">{trade.txHash.slice(0, 10)}...</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}