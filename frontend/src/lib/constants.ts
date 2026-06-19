import type { Status } from "./api";

export const STATUSES: { key: Status; label: string }[] = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "done", label: "Done" },
  { key: "abandoned", label: "Abandoned" },
];

export const STATUS_LABEL: Record<Status, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  abandoned: "Abandoned",
};

// Tailwind classes for status badges / column accents.
export const STATUS_STYLE: Record<Status, string> = {
  todo: "bg-slate-100 text-slate-700 border-slate-200",
  in_progress: "bg-blue-100 text-blue-700 border-blue-200",
  done: "bg-green-100 text-green-700 border-green-200",
  abandoned: "bg-red-100 text-red-700 border-red-200",
};
