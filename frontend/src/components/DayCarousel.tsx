import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { plural } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { api, type Asset, type DayEvent, type MinorEvent } from "@/lib/api";
import { UserAvatar } from "@/components/UserAvatar";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { displayName, formatDayHeading, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate: string;
  activeDates: string[]; // sorted ascending; days that have activity
  tag?: string;
  projectId?: number; // scope the day report to one project
  includeArchived?: boolean; // surface logs from archived tasks/projects
}

type Slide = { kind: "media"; event: DayEvent; asset: Asset } | { kind: "items"; events: DayEvent[] };

function buildSlides(events: DayEvent[]): Slide[] {
  const slides: Slide[] = [];
  let cur: DayEvent[] = [];
  const flush = () => {
    if (cur.length) {
      slides.push({ kind: "items", events: cur });
      cur = [];
    }
  };
  for (const e of events) {
    // Each image/video attachment gets its own dedicated, full-bleed slide;
    // documents/other stay in the text item groups.
    const media = e.attachments.filter((a) => a.kind === "image" || a.kind === "video");
    if (media.length) {
      flush();
      for (const asset of media) slides.push({ kind: "media", event: e, asset });
    } else {
      cur.push(e);
      if (cur.length === 3) flush();
    }
  }
  flush();
  return slides;
}

function statusActionMsg(toStatus: string | null): MessageDescriptor {
  switch (toStatus) {
    case "done":
      return msg`completed`;
    case "abandoned":
      return msg`abandoned`;
    case "blocked":
      return msg`blocked`;
    case "in_progress":
      return msg`started`;
    case "todo":
      return msg`moved to To do`;
    default:
      return msg`updated`;
  }
}

function adjacentDate(dates: string[], current: string, dir: 1 | -1): string | null {
  const idx = dates.indexOf(current);
  if (idx === -1) {
    if (dir === 1) return dates.find((d) => d > current) ?? null;
    const before = dates.filter((d) => d < current);
    return before.length ? before[before.length - 1] : null;
  }
  const j = idx + dir;
  return j >= 0 && j < dates.length ? dates[j] : null;
}

function EventLine({ event }: { event: DayEvent }) {
  const { i18n } = useLingui();
  const action =
    event.type === "note"
      ? event.text
        ? `“${event.text}”`
        : i18n._(msg`added a file`)
      : i18n._(statusActionMsg(event.toStatus));
  return (
    <div className="flex gap-3">
      <UserAvatar
        name={event.user.name}
        firstName={event.user.firstName}
        surname={event.user.surname}
        avatarPath={event.user.avatarPath}
        className="mt-0.5 h-9 w-9 text-[11px]"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug">
          <span className="font-semibold">{displayName(event.user)}:</span>{" "}
          <span className="text-white/70">
            <Trans>Task</Trans> <span className="font-medium text-white">«{event.task.title}»</span>{" "}
            <span className="font-semibold text-lime-300">{action}</span>
          </span>
        </p>
        <p className="mt-2 text-xs text-white/50">
          {event.task.projectName}
          {event.task.tags.length ? ` · ${event.task.tags.map((tg) => `#${tg}`).join(" ")}` : ""} ·{" "}
          {formatTime(event.createdAt)}
        </p>
      </div>
    </div>
  );
}

// "3 edits" / "1 due-date change" — the count-bearing noun for the footer summary.
function minorLabel(type: string, n: number): string {
  switch (type) {
    case "created":
      return plural(n, { one: "# task created", other: "# tasks created" });
    case "edit":
      return plural(n, { one: "# edit", other: "# edits" });
    case "due_date_change":
      return plural(n, { one: "# due-date change", other: "# due-date changes" });
    case "assignee_change":
      return plural(n, { one: "# assignee change", other: "# assignee changes" });
    case "archive":
      return plural(n, { one: "# archive update", other: "# archive updates" });
    case "title_change":
      return plural(n, { one: "# title change", other: "# title changes" });
    case "description_change":
      return plural(n, { one: "# description edit", other: "# description edits" });
    case "tags_change":
      return plural(n, { one: "# tag change", other: "# tag changes" });
    case "criteria_change":
      return plural(n, { one: "# checklist change", other: "# checklist changes" });
    case "criterion_check":
      return plural(n, { one: "# checklist tick", other: "# checklist ticks" });
    default:
      return plural(n, { one: "# update", other: "# updates" });
  }
}

// The verb phrase for one minor event in the detailed view.
function minorAction(type: string): MessageDescriptor {
  switch (type) {
    case "created":
      return msg`created the task`;
    case "edit":
      return msg`edited the task`;
    case "due_date_change":
      return msg`changed the due date`;
    case "assignee_change":
      return msg`changed the assignee`;
    case "archive":
      return msg`archived / unarchived`;
    case "title_change":
      return msg`changed the title`;
    case "description_change":
      return msg`edited the description`;
    case "tags_change":
      return msg`changed tags`;
    case "criteria_change":
      return msg`edited the checklist`;
    case "criterion_check":
      return msg`ticked a checklist item`;
    default:
      return msg`updated`;
  }
}

function MinorLine({ event }: { event: MinorEvent }) {
  const { i18n } = useLingui();
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs leading-snug">
      <span className="min-w-0 text-white/70">
        <span className="font-medium text-white/90">{event.userName}:</span> {i18n._(minorAction(event.type))}{" "}
        <span className="text-white/90">«{event.taskTitle}»</span>
      </span>
      <span className="shrink-0 text-white/40">{formatTime(event.createdAt)}</span>
    </div>
  );
}

export function DayCarousel({ open, onOpenChange, initialDate, activeDates, tag, projectId, includeArchived }: Props) {
  const [currentDate, setCurrentDate] = useState(initialDate);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [slideIndex, setSlideIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [minor, setMinor] = useState<MinorEvent[]>([]);
  const [showDetail, setShowDetail] = useState(false);
  const pending = useRef<"start" | "end">("start");

  useEffect(() => {
    if (open) {
      pending.current = "start";
      setCurrentDate(initialDate);
    }
  }, [open, initialDate]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    api
      .getCalendarDay(currentDate, tag, projectId, includeArchived)
      .then((r) => {
        if (cancelled) return;
        const sl = buildSlides(r.events);
        setSlides(sl);
        setSlideIndex(pending.current === "end" ? Math.max(0, sl.length - 1) : 0);
        setMinor(r.minor);
        setShowDetail(false); // collapse the footer when the day changes
        pending.current = "start";
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, currentDate, tag, projectId, includeArchived]);

  function next() {
    if (slideIndex < slides.length - 1) {
      setSlideIndex((i) => i + 1);
    } else {
      const nd = adjacentDate(activeDates, currentDate, 1);
      if (nd) {
        pending.current = "start";
        setCurrentDate(nd);
      }
    }
  }

  function prev() {
    if (slideIndex > 0) {
      setSlideIndex((i) => i - 1);
    } else {
      const pd = adjacentDate(activeDates, currentDate, -1);
      if (pd) {
        pending.current = "end";
        setCurrentDate(pd);
      }
    }
  }

  // keyboard navigation: ← / → step through slides (and roll into adjacent days)
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slideIndex, slides, currentDate, activeDates]);

  const slide = slides[slideIndex];
  const isVideo = slide?.kind === "media" && slide.asset.kind === "video";

  // Roll the minor events up by type for the "also today" footer, busiest first.
  const minorByType = (() => {
    const counts = new Map<string, number>();
    for (const e of minor) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  })();
  const hasPrev = slideIndex > 0 || adjacentDate(activeDates, currentDate, -1) !== null;
  const hasNext = slideIndex < slides.length - 1 || adjacentDate(activeDates, currentDate, 1) !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className={cn(
          "z-50 flex flex-col gap-0 border-0 bg-neutral-900 p-0 text-neutral-50 shadow-none",
          // mobile: immersive fullscreen
          "left-0 top-0 h-full w-full max-w-none translate-x-0 translate-y-0 rounded-none",
          // desktop: centered, phone-sized story card on the dimmed backdrop
          "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-[90vh] sm:max-h-[920px] sm:w-[30rem] sm:max-w-[30rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:border-white/10 sm:shadow-2xl"
        )}
      >
        {/* card surface — clips media/progress to the rounded corners; the desktop
            arrows live outside this so they can sit beyond the card edges */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
          {/* segmented progress */}
          <div className="flex gap-1 px-3 pt-3">
            {(slides.length ? slides : [0]).map((_, i) => (
              <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
                <div className={cn("h-full rounded-full bg-white transition-all", i <= slideIndex ? "w-full" : "w-0")} />
              </div>
            ))}
          </div>

          {/* header */}
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <DialogTitle className="text-sm font-semibold capitalize">{formatDayHeading(currentDate)}</DialogTitle>
              <div className="text-xs text-white/60">
                {slides.length > 0 ? `${slideIndex + 1} / ${slides.length}` : "—"}
                {tag ? ` · #${tag}` : ""}
              </div>
            </div>
            <DialogClose className="rounded-full p-1 text-white/70 hover:text-white focus:outline-none">
              <X className="h-5 w-5" />
            </DialogClose>
          </div>

          {/* content + tap zones */}
          <div className="relative min-h-0 flex-1">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-white/60" />
              </div>
            ) : !slide ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-white/60">
                <Trans>Nothing logged on this day.</Trans>
              </div>
            ) : slide.kind === "media" ? (
              <div className="absolute inset-0">
                {slide.asset.kind === "video" ? (
                  <video
                    // Remount per asset so a freshly-focused video autoplays.
                    key={slide.asset.path}
                    src={slide.asset.path}
                    controls
                    autoPlay
                    playsInline
                    preload="auto"
                    className="absolute inset-0 z-10 m-auto max-h-full max-w-full object-contain"
                  />
                ) : (
                  <img
                    src={slide.asset.path}
                    alt={slide.asset.filename}
                    className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
                  />
                )}
                {/* caption overlay; pointer-events-none so it never blocks video controls.
                    For video it sits at the top, leaving the bottom clear for controls. */}
                <div
                  className={cn(
                    "pointer-events-none absolute inset-x-0 z-20 p-5",
                    slide.asset.kind === "video"
                      ? "top-0 bg-gradient-to-b from-black/80 to-transparent pb-16"
                      : "bottom-0 bg-gradient-to-t from-black/80 to-transparent pt-16"
                  )}
                >
                  <EventLine event={slide.event} />
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col justify-center gap-6 px-6 sm:px-14">
                {slide.events.map((e) => (
                  <EventLine key={e.id} event={e} />
                ))}
              </div>
            )}

            {/* mobile: tap zones — left third = back, right two-thirds = forward.
                On video slides they stop short of the bottom so the native
                controls stay clickable instead of triggering navigation. */}
            <button
              type="button"
              aria-label="Previous"
              onClick={prev}
              className={cn("absolute left-0 z-10 w-1/3 cursor-default sm:hidden", isVideo ? "bottom-16 top-0" : "inset-y-0")}
            />
            <button
              type="button"
              aria-label="Next"
              onClick={next}
              className={cn("absolute right-0 z-10 w-2/3 cursor-default sm:hidden", isVideo ? "bottom-16 top-0" : "inset-y-0")}
            />
          </div>

          {/* "also today" footer — minor events the story doesn't narrate, rolled
              up by type. Tapping expands a detailed, per-event list. */}
          {!loading && minor.length > 0 && (
            <div className="shrink-0 border-t border-amber-300/15 bg-gradient-to-t from-amber-400/[0.07] to-transparent backdrop-blur">
              {showDetail && (
                <div className="max-h-44 space-y-2 overflow-y-auto px-4 pb-2 pt-3">
                  {minor.map((e, i) => (
                    <MinorLine key={i} event={e} />
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowDetail((d) => !d)}
                aria-expanded={showDetail}
                className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[13px] transition-colors hover:bg-amber-400/[0.06]"
              >
                <span className="min-w-0">
                  <span className="mr-1.5 rounded bg-amber-400/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-200/80">
                    <Trans>Also today</Trans>
                  </span>{" "}
                  {minorByType.map(([type, n], i) => (
                    <span key={type} className="font-medium text-amber-100/70">
                      {i > 0 ? <span className="text-amber-300/40"> · </span> : ""}
                      {minorLabel(type, n)}
                    </span>
                  ))}
                </span>
                <span className="flex shrink-0 items-center gap-1 rounded-full border border-amber-300/25 bg-amber-400/[0.06] py-1 pl-2.5 pr-2 text-[11px] font-semibold uppercase tracking-wide text-amber-200/80 transition-colors group-hover:border-amber-300/45 group-hover:bg-amber-400/15 group-hover:text-amber-100">
                  {showDetail ? <Trans>Hide</Trans> : <Trans>Details</Trans>}
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showDetail && "rotate-180")} />
                </span>
              </button>
            </div>
          )}
        </div>

        {/* desktop: arrow controls, placed just outside the story card */}
        <button
          type="button"
          aria-label="Previous"
          onClick={prev}
          disabled={!hasPrev}
          className="absolute right-full top-1/2 z-20 mr-4 hidden -translate-y-1/2 rounded-full bg-white/10 p-3 text-white/90 transition hover:bg-white/20 disabled:opacity-0 sm:block"
        >
          <ChevronLeft className="h-8 w-8" />
        </button>
        <button
          type="button"
          aria-label="Next"
          onClick={next}
          disabled={!hasNext}
          className="absolute left-full top-1/2 z-20 ml-4 hidden -translate-y-1/2 rounded-full bg-white/10 p-3 text-white/90 transition hover:bg-white/20 disabled:opacity-0 sm:block"
        >
          <ChevronRight className="h-8 w-8" />
        </button>
      </DialogContent>
    </Dialog>
  );
}
