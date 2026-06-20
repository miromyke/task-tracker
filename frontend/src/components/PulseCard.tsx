import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import type { Pulse } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DayCarousel } from "@/components/DayCarousel";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

function barColor(count: number, gold: boolean, attachments: number): string {
  if (count === 0) return "bg-zinc-200"; // no activity
  if (gold) return "bg-purple-400"; // completion day → vibrant purple
  if (attachments > 0) return "bg-lime-300"; // day with an attachment → slightly deeper lime
  return "bg-lime-200"; // normal activity → pale lime
}

const FULL = 60; // chart height in px
const MIN = 14; // min bar height for an active day

const SPANS = [7, 14, 30, 90, 180] as const;
type Span = (typeof SPANS)[number];

const SPAN_LABEL: Record<Span, React.ReactNode> = {
  7: <Trans>1 week</Trans>,
  14: <Trans>2 weeks</Trans>,
  30: <Trans>1 month</Trans>,
  90: <Trans>3 months</Trans>,
  180: <Trans>6 months</Trans>,
};

export function PulseCard({ pulse, projectId }: { pulse: Pulse; projectId?: number }) {
  const { t } = useLingui();
  const [span, setSpan] = useState<Span>(30);
  const [open, setOpen] = useState(false);
  const [pickedDate, setPickedDate] = useState("");

  const days = pulse.days.slice(-span);
  const max = Math.max(1, ...days.map((d) => d.count));
  const activeDates = pulse.days.filter((d) => d.count > 0).map((d) => d.date);

  // tighten spacing/corners as bars get denser
  const dense = span > 30;
  const gap = dense ? "gap-px" : "gap-1";
  const radius = dense ? "rounded-sm" : "rounded-md";

  return (
    <Card className="space-y-3 p-4 shadow-none">
      {/* span selector */}
      <div className="flex justify-end">
        <div className="inline-flex rounded-md border p-0.5 text-xs">
          {SPANS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpan(s)}
              className={cn(
                "rounded px-2 py-1 transition-colors",
                s === span ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-900"
              )}
            >
              {SPAN_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {/* activity chart */}
      <TooltipProvider delayDuration={150}>
        <div className={cn("flex items-end", gap)} style={{ height: FULL }}>
          {days.map((d) => {
            const h = d.count === 0 ? 4 : MIN + (d.count / max) * (FULL - MIN);
            const logs = plural(d.count, { one: "# log", other: "# logs" });
            const atts = plural(d.attachments, { one: "# attachment", other: "# attachments" });
            const label = t`${formatShortDate(d.date)} · ${logs} · ${atts}`;
            return (
              <Tooltip key={d.date}>
                <TooltipTrigger asChild>
                  {d.count === 0 ? (
                    <div aria-label={label} className={cn("flex-1 bg-zinc-200 opacity-70", radius)} style={{ height: h }} />
                  ) : (
                    <button
                      type="button"
                      aria-label={label}
                      onClick={() => {
                        setPickedDate(d.date);
                        setOpen(true);
                      }}
                      className={cn(
                        "flex-1 cursor-pointer outline-none transition-all",
                        radius,
                        barColor(d.count, d.gold, d.attachments),
                        "hover:brightness-105 hover:ring-2 hover:ring-zinc-900/30 focus-visible:ring-2 focus-visible:ring-zinc-400"
                      )}
                      style={{ height: h }}
                    />
                  )}
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>

      <DayCarousel
        open={open}
        onOpenChange={setOpen}
        initialDate={pickedDate}
        activeDates={activeDates}
        projectId={projectId}
      />
    </Card>
  );
}
