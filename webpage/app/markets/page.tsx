import { MarketsExplorer } from "@/components/markets/markets-explorer";
import { getMarkets } from "@/lib/api";

export default async function MarketsPage({ searchParams }: { searchParams: { status?: string; page?: string; q?: string } }) {
  const status = searchParams.status || "active";
  const page = Number(searchParams.page || "1");
  const q = searchParams.q || "";
  const data = await getMarkets({ status, page, q });

  return <MarketsExplorer initialStatus={status} initialQuery={q} data={data} />;
}