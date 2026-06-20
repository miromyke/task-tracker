import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { api, type CalendarDay } from "@/lib/api";
import { DayCarousel } from "@/components/DayCarousel";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ALL = "__all__";
const ZOOMS = [1, 2, 3, 6];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const daysInMonth = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();
// 0 = Monday ... 6 = Sunday
const firstWeekday = (y: number, m0: number) => (new Date(y, m0, 1).getDay() + 6) % 7;

function addMonths(y: number, m0: number, n: number) {
  const total = m0 + n;
  return { year: y + Math.floor(total / 12), month0: ((total % 12) + 12) % 12 };
}

function todayStr() {
  const d = new Date();
  return ymd(d.getFullYear(), d.getMonth(), d.getDate());
}

function cellClass(day: CalendarDay | undefined): string {
  if (!day) return "bg-zinc-200/60 text-zinc-500/60";
  if (day.gold) return "bg-amber-400 text-amber-950 font-semibold";
  switch (day.level) {
    case 1:
      return "bg-green-200 text-green-900";
    case 2:
      return "bg-green-300 text-green-950";
    case 3:
      return "bg-green-500 text-white";
    case 4:
      return "bg-green-700 text-white";
    default:
      return "bg-zinc-200/60 text-zinc-500/60";
  }
}

function MonthGrid({
  year,
  month0,
  title,
  weekdays,
  data,
  onPick,
}: {
  year: number;
  month0: number;
  title: string;
  weekdays: string[];
  data: Map<string, CalendarDay>;
  onPick: (date: string) => void;
}) {
  const offset = firstWeekday(year, month0);
  const total = daysInMonth(year, month0);
  const today = todayStr();
  const cells: (number | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);

  return (
    <div className="rounded-lg border p-3">
      <h3 className="mb-2 text-center text-sm font-semibold capitalize">{title}</h3>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-medium capitalize text-zinc-500">
        {weekdays.map((w, i) => (
          <div key={i}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} />;
          const date = ymd(year, month0, d);
          const day = data.get(date);
          const clickable = !!day;
          return (
            <button
              key={date}
              disabled={!clickable}
              onClick={() => clickable && onPick(date)}
              className={cn(
                "flex aspect-square items-center justify-center rounded-md text-xs transition-transform",
                cellClass(day),
                clickable && "hover:scale-105 cursor-pointer",
                date === today && "ring-2 ring-zinc-900 ring-offset-1"
              )}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CalendarPage() {
  const { i18n } = useLingui();
  const [zoom, setZoom] = useState<number>(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches ? 2 : 1
  );
  const now = new Date();
  const [anchor, setAnchor] = useState({ year: now.getFullYear(), month0: now.getMonth() });
  const [tag, setTag] = useState<string>(ALL);
  const [tags, setTags] = useState<string[]>([]);
  const [days, setDays] = useState<CalendarDay[]>([]);

  const [carouselOpen, setCarouselOpen] = useState(false);
  const [pickedDate, setPickedDate] = useState("");

  // Locale-aware month + weekday names.
  const monthLong = useMemo(() => new Intl.DateTimeFormat(i18n.locale, { month: "long" }), [i18n.locale]);
  const monthShort = useMemo(() => new Intl.DateTimeFormat(i18n.locale, { month: "short" }), [i18n.locale]);
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.locale, { weekday: "short" });
    // 2024-01-01 is a Monday
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i)));
  }, [i18n.locale]);
  const mLong = (m0: number) => monthLong.format(new Date(2000, m0, 1));
  const mShort = (m0: number) => monthShort.format(new Date(2000, m0, 1));

  useEffect(() => {
    api.listTags().then(setTags);
  }, []);

  const last = addMonths(anchor.year, anchor.month0, zoom - 1);
  const from = ymd(anchor.year, anchor.month0, 1);
  const to = ymd(last.year, last.month0, daysInMonth(last.year, last.month0));

  useEffect(() => {
    api.getCalendar(from, to, tag === ALL ? undefined : tag).then(setDays);
  }, [from, to, tag]);

  const data = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const activeDates = useMemo(() => days.map((d) => d.date).sort(), [days]);

  const months = Array.from({ length: zoom }, (_, i) => addMonths(anchor.year, anchor.month0, i));
  const rangeLabel =
    zoom === 1
      ? `${mLong(anchor.month0)} ${anchor.year}`
      : `${mShort(anchor.month0)} ${anchor.year} – ${mShort(last.month0)} ${last.year}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          <Trans>Timeline</Trans>
        </h1>
        <div className="flex items-center gap-2">
          <Select value={tag} onValueChange={setTag}>
            <SelectTrigger className="h-9 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                <Trans>All tags</Trans>
              </SelectItem>
              {tags.map((t) => (
                <SelectItem key={t} value={t}>
                  #{t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(zoom)} onValueChange={(v) => setZoom(Number(v))}>
            <SelectTrigger className="h-9 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ZOOMS.map((z) => (
                <SelectItem key={z} value={String(z)}>
                  <Plural value={z} one="# month" other="# months" />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="outline" size="icon" onClick={() => setAnchor(addMonths(anchor.year, anchor.month0, -zoom))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-sm font-medium capitalize">{rangeLabel}</div>
        <Button variant="outline" size="icon" onClick={() => setAnchor(addMonths(anchor.year, anchor.month0, zoom))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {months.map((m) => (
          <MonthGrid
            key={`${m.year}-${m.month0}`}
            year={m.year}
            month0={m.month0}
            title={`${mLong(m.month0)} ${m.year}`}
            weekdays={weekdays}
            data={data}
            onPick={(date) => {
              setPickedDate(date);
              setCarouselOpen(true);
            }}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <Trans>Less</Trans>
          <span className="inline-flex gap-0.5">
            <span className="h-3 w-3 rounded-sm bg-zinc-200/60" />
            <span className="h-3 w-3 rounded-sm bg-green-200" />
            <span className="h-3 w-3 rounded-sm bg-green-300" />
            <span className="h-3 w-3 rounded-sm bg-green-500" />
            <span className="h-3 w-3 rounded-sm bg-green-700" />
          </span>
          <Trans>More</Trans>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-amber-400" />
          <Trans>Task completed</Trans>
        </span>
      </div>

      <DayCarousel
        open={carouselOpen}
        onOpenChange={setCarouselOpen}
        initialDate={pickedDate}
        activeDates={activeDates}
        tag={tag === ALL ? undefined : tag}
      />
    </div>
  );
}
