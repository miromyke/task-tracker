import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { Pulse, Status } from "@/lib/api";
import { STATUS_DOT, STATUS_LABEL, STATUS_ORDER } from "@/lib/constants";
import { Card } from "@/components/ui/card";
import { DayCarousel } from "@/components/DayCarousel";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

function barColor(count: number, gold: boolean): string {
  if (count === 0) return "bg-muted"; // no activity
  if (gold) return "bg-lime4"; // completion day → saturated lime
  return "bg-lime2"; // normal activity → pale lime
}

const FULL = 60; // chart height in px
const MIN = 14; // min bar height for an active day

export function PulseCard({
  pulse,
  counts,
  projectId,
}: {
  pulse: Pulse;
  counts: Record<Status, number>;
  projectId: number;
}) {
  const { i18n } = useLingui();
  const max = Math.max(1, ...pulse.days.map((d) => d.count));
  const activeDates = pulse.days.filter((d) => d.count > 0).map((d) => d.date);

  const [open, setOpen] = useState(false);
  const [pickedDate, setPickedDate] = useState("");

  return (
    <Card className="space-y-3 p-4">
      {/* header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-status-done" />
          <span className="font-semibold">
            <Trans>Pulse</Trans>
          </span>
        </div>
        {pulse.lastActivity && (
          <span className="text-sm text-muted-foreground">
            <Trans>last activity {formatShortDate(pulse.lastActivity)}</Trans>
          </span>
        )}
      </div>

      {/* 14-day activity chart */}
      <div className="flex items-end gap-1" style={{ height: FULL }}>
        {pulse.days.map((d) => {
          const h = d.count === 0 ? 4 : MIN + (d.count / max) * (FULL - MIN);
          const label = `${formatShortDate(d.date)} · ${d.count}`;
          if (d.count === 0) {
            return <div key={d.date} title={label} className="flex-1 rounded-md bg-muted opacity-70" style={{ height: h }} />;
          }
          return (
            <button
              key={d.date}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => {
                setPickedDate(d.date);
                setOpen(true);
              }}
              className={cn(
                "flex-1 cursor-pointer rounded-md outline-none transition-all",
                barColor(d.count, d.gold),
                "hover:brightness-105 hover:ring-2 hover:ring-foreground/30 focus-visible:ring-2 focus-visible:ring-ring"
              )}
              style={{ height: h }}
            />
          );
        })}
      </div>

      {/* stats */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">{pulse.updatesThisWeek}</span>{" "}
            <Trans>updates this week</Trans>
          </span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-lime4" />
            <span className="font-semibold text-foreground">{pulse.completedThisWeek}</span>{" "}
            <Trans context="count">completed</Trans>
          </span>
        </div>
        <span className="text-muted-foreground">
          <Trans>past 14 days</Trans>
        </span>
      </div>

      {/* status legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
        {STATUS_ORDER.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[s])} />
            {i18n._(STATUS_LABEL[s])} {counts[s]}
          </span>
        ))}
      </div>

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
