import { Badge } from "@/components/ui/badge";
import type { OracleEvent } from "@/types";

function getVariant(status: string) {
  if (status === "settle") return "danger" as const;
  if (status === "propose") return "warning" as const;
  if (status === "dispute") return "outline" as const;
  return "success" as const;
}

export function OracleTimeline({ events }: { events: OracleEvent[] }) {
  if (events.length === 0) {
    return <div className="rounded-md border border-white/5 bg-white/[0.02] px-4 py-6 font-mono text-sm text-zinc-500">No oracle events matched to this market in the current index.</div>;
  }

  return (
    <div className="space-y-4">
      {events.map((event, index) => (
        <div key={`${event.id}-${event.txHash}`} className="relative rounded-3xl border border-border/70 bg-white/80 p-5">
          {index < events.length - 1 ? <div className="absolute left-8 top-14 h-8 w-px bg-border" /> : null}
          <div className="flex items-start gap-4">
            <div className="mt-1 h-4 w-4 rounded-full bg-primary" />
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant={getVariant(event.eventStatus)}>{event.eventStatus}</Badge>
                <span className="text-sm text-muted-foreground">{event.eventTime}</span>
              </div>
              <div className="text-sm text-muted-foreground">{event.marketTitle}</div>
              <div className="grid gap-2 text-sm md:grid-cols-2">
                <div>Proposed Price: {event.proposedPrice || "-"}</div>
                <div>Settled Price: {event.settledPrice || "-"}</div>
                <div>Requester: {event.requester || "-"}</div>
                <div>Proposer: {event.proposer || "-"}</div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}