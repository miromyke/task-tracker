import { i18n } from "@lingui/core";

// Active app locale for date formatting (falls back to the browser default).
function loc(): string | undefined {
  return i18n.locale || undefined;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// avatarInitials derives the two-letter avatar label from the structured name
// when available (#19): first-name initial + surname initial. Falls back to the
// whitespace heuristic over the composed display name when the parts are absent
// (partial user payloads, e.g. a notification actor).
export function avatarInitials(firstName?: string, surname?: string, name = ""): string {
  const f = (firstName ?? "").trim();
  const s = (surname ?? "").trim();
  if (f && s) return (f[0] + s[0]).toUpperCase();
  if (f) return f.slice(0, 2).toUpperCase();
  if (s) return s.slice(0, 2).toUpperCase();
  return initials(name);
}

// Deterministic background color for an initials avatar.
const AVATAR_COLORS = [
  "bg-rose-200 text-rose-800",
  "bg-orange-200 text-orange-800",
  "bg-amber-200 text-amber-800",
  "bg-lime-200 text-lime-800",
  "bg-emerald-200 text-emerald-800",
  "bg-teal-200 text-teal-800",
  "bg-sky-200 text-sky-800",
  "bg-indigo-200 text-indigo-800",
  "bg-violet-200 text-violet-800",
  "bg-fuchsia-200 text-fuchsia-800",
];

export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(loc(), { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(loc(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// "2026-06-19" -> "Friday, June 19, 2026"
export function formatDayHeading(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(loc(), {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// "2026-06-19" -> "Jun 19"
export function formatShortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(loc(), { month: "short", day: "numeric" });
}

// A task created after its due date isn't overdue — it's an old task being
// logged after the fact. `createdAt` may be an ISO timestamp or a date string.
function createdAfterDue(date: string, createdAt?: string): boolean {
  return !!createdAt && createdAt.slice(0, 10) > date;
}

export function isPast(date: string, createdAt?: string): boolean {
  if (createdAfterDue(date, createdAt)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const due = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

// Whole days a due date is past (0 if it is today, in the future, or the task
// was created after the due date).
export function daysOverdue(date: string, createdAt?: string): number {
  if (createdAfterDue(date, createdAt)) return 0;
  const [y, m, d] = date.split("-").map(Number);
  const due = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ms = today.getTime() - due.getTime();
  return ms > 0 ? Math.floor(ms / 86_400_000) : 0;
}
