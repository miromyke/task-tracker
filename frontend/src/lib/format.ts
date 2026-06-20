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

export function isPast(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const due = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}
