import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarketPriceChart } from "@/components/charts/market-price-chart";
import { OracleTimeline } from "@/components/markets/oracle-timeline";
import { TradesTable } from "@/components/markets/trades-table";
import { getMarketDetail } from "@/lib/api";
import { formatDate } from "@/lib/utils";

function badgeVariant(status: string) {
  if (status === "Settled") return "danger" as const;
  if (status === "Proposed") return "warning" as const;
  return "success" as const;
}

export default async function MarketDetailPage({ params }: { params: { id: string } }) {
  const { market, priceSeries, trades, oracleEvents } = await getMarketDetail(params.id);
  const defaultTab = trades.length > 0 || oracleEvents.length === 0 ? "trades" : "oracle";

  return (
    <div className="space-y-8">
      <section className="rounded-[2rem] border border-border/70 bg-white/80 p-8 shadow-panel backdrop-blur">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={badgeVariant(market.status)}>{market.status}</Badge>
              <span className="text-sm text-muted-foreground">End date: {formatDate(market.endDate)}</span>
            </div>
            <h1 className="font-serif text-4xl font-semibold tracking-tight text-balance">{market.title}</h1>
            <p className="max-w-3xl text-muted-foreground">{market.description || "This market detail page combines market metadata, price movement, trade tape, and oracle state transitions."}</p>
          </div>
          <Card className="min-w-[280px]">
            <CardHeader>
              <CardTitle>Identifiers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <div className="text-muted-foreground">Condition ID</div>
                <div className="break-all font-mono text-xs">{market.conditionId}</div>
              </div>
              <div>
                <div className="text-muted-foreground">YES Token</div>
                <div className="break-all font-mono text-xs">{market.yesTokenId}</div>
              </div>
              <div>
                <div className="text-muted-foreground">NO Token</div>
                <div className="break-all font-mono text-xs">{market.noTokenId}</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <MarketPriceChart data={priceSeries} />

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="trades">Trades Table ({trades.length})</TabsTrigger>
          <TabsTrigger value="oracle">Oracle Timeline ({oracleEvents.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="trades">
          <Card>
            <CardHeader>
              <CardTitle>Latest Trades</CardTitle>
            </CardHeader>
            <CardContent>
              <TradesTable trades={trades} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="oracle">
          <Card>
            <CardHeader>
              <CardTitle>Oracle Event Chain</CardTitle>
            </CardHeader>
            <CardContent>
              <OracleTimeline events={oracleEvents} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}