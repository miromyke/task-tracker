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

// Tailwind classes for status badges (tinted chip + colored text).
export const STATUS_STYLE: Record<Status, string> = {
  todo: "bg-status-todo/15 text-status-todo border-status-todo/30",
  in_progress: "bg-status-progress/15 text-status-progress border-status-progress/30",
  done: "bg-status-done/15 text-status-done border-status-done/30",
  abandoned: "bg-status-abandoned/15 text-status-abandoned border-status-abandoned/30",
};

// Solid status color (dots, progress-bar segments, column accents).
export const STATUS_DOT: Record<Status, string> = {
  todo: "bg-status-todo",
  in_progress: "bg-status-progress",
  done: "bg-status-done",
  abandoned: "bg-status-abandoned",
};

// Order used by the kanban board and progress bar.
export const STATUS_ORDER: Status[] = ["todo", "in_progress", "done", "abandoned"];
