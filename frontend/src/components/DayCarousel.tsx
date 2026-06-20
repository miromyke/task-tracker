import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { api, type DayEvent } from "@/lib/api";
import { UserAvatar } from "@/components/UserAvatar";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { formatDayHeading, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate: string;
  activeDates: string[]; // sorted ascending; days that have activity
  tag?: string;
  projectId?: number; // scope the day report to one project
}

type Slide = { kind: "media"; event: DayEvent } | { kind: "items"; events: DayEvent[] };

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
    if (e.imagePath) {
      flush();
      slides.push({ kind: "media", event: e });
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
        : i18n._(msg`added a photo`)
      : i18n._(statusActionMsg(event.toStatus));
  return (
    <div className="flex gap-3">
      <UserAvatar name={event.user.name} avatarPath={event.user.avatarPath} className="mt-0.5 h-9 w-9 text-[11px]" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug">
          <span className="font-semibold">{event.user.name}:</span>{" "}
          <span className="text-white/70">
            <Trans>Task</Trans> <span className="font-medium text-white">«{event.task.title}»</span>{" "}
            <span className="font-semibold text-lime-300">{action}</span>
          </span>
        </p>
        <p className="mt-2 text-xs text-white/50">
          {event.task.projectName} · #{event.task.tag} · {formatTime(event.createdAt)}
        </p>
      </div>
    </div>
  );
}

export function DayCarousel({ open, onOpenChange, initialDate, activeDates, tag, projectId }: Props) {
  const [currentDate, setCurrentDate] = useState(initialDate);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [slideIndex, setSlideIndex] = useState(0);
  const [loading, setLoading] = useState(true);
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
      .getCalendarDay(currentDate, tag, projectId)
      .then((r) => {
        if (cancelled) return;
        const sl = buildSlides(r.events);
        setSlides(sl);
        setSlideIndex(pending.current === "end" ? Math.max(0, sl.length - 1) : 0);
        pending.current = "start";
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, currentDate, tag, projectId]);

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
                <img
                  src={slide.event.imagePath!}
                  alt="attachment"
                  className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-5 pt-16">
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

            {/* mobile: tap zones — left third = back, right two-thirds = forward */}
            <button type="button" aria-label="Previous" onClick={prev} className="absolute inset-y-0 left-0 z-10 w-1/3 cursor-default sm:hidden" />
            <button type="button" aria-label="Next" onClick={next} className="absolute inset-y-0 right-0 z-10 w-2/3 cursor-default sm:hidden" />
          </div>
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
