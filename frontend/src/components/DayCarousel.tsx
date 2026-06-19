import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { api, type DayEvent } from "@/lib/api";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { formatDayHeading, formatTime } from "@/lib/format";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate: string;
  activeDates: string[]; // sorted ascending; days that have activity
  tag?: string;
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

// The phrase describing what happened, excluding the actor's name.
function actionPhrase(e: DayEvent): string {
  if (e.type === "note") return e.text ? `logged “${e.text}”` : "added a photo";
  switch (e.toStatus) {
    case "done":
      return "completed";
    case "abandoned":
      return "abandoned";
    case "in_progress":
      return "started";
    case "todo":
      return "moved to To do";
    default:
      return "updated";
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

function EventRow({ event }: { event: DayEvent }) {
  return (
    <div className="flex gap-3">
      <UserAvatar name={event.user.name} avatarPath={event.user.avatarPath} className="mt-0.5 h-8 w-8 text-[10px]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-medium">{event.user.name}</span>{" "}
          <span className="text-muted-foreground">{actionPhrase(event)}</span>{" "}
          <span className="font-medium">«{event.task.title}»</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {event.task.projectName} · #{event.task.tag} · {formatTime(event.createdAt)}
        </p>
      </div>
    </div>
  );
}

export function DayCarousel({ open, onOpenChange, initialDate, activeDates, tag }: Props) {
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
      .getCalendarDay(currentDate, tag)
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
  }, [open, currentDate, tag]);

  const hasNextDay = adjacentDate(activeDates, currentDate, 1) !== null;
  const hasPrevDay = adjacentDate(activeDates, currentDate, -1) !== null;
  const canNext = slideIndex < slides.length - 1 || hasNextDay;
  const canPrev = slideIndex > 0 || hasPrevDay;

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

  const slide = slides[slideIndex];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] max-w-md flex-col gap-0 p-0 sm:h-[80vh]">
        <div className="border-b p-4 pr-12">
          <DialogTitle className="text-base">{formatDayHeading(currentDate)}</DialogTitle>
          {tag && <Badge className="mt-1 border-transparent bg-secondary text-secondary-foreground">#{tag}</Badge>}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !slide ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
              Nothing logged on this day.
            </div>
          ) : slide.kind === "media" ? (
            <div className="flex h-full flex-col gap-3">
              <a href={slide.event.imagePath!} target="_blank" rel="noreferrer" className="flex min-h-0 flex-1">
                <img
                  src={slide.event.imagePath!}
                  alt="attachment"
                  className="m-auto max-h-full max-w-full rounded-md object-contain"
                />
              </a>
              <EventRow event={slide.event} />
            </div>
          ) : (
            <div className="space-y-5">
              {slide.events.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t p-3">
          <Button variant="ghost" size="sm" onClick={prev} disabled={!canPrev}>
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>
          <span className="text-xs text-muted-foreground">
            {slides.length > 0 ? `${slideIndex + 1} / ${slides.length}` : "—"}
          </span>
          <Button variant="ghost" size="sm" onClick={next} disabled={!canNext}>
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
