import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import type { Status } from "./api";

// Order used by the kanban board and progress bar.
export const STATUS_ORDER: Status[] = ["todo", "in_progress", "blocked", "done", "abandoned"];

// Translatable labels (resolve with i18n._(STATUS_LABEL[status])).
export const STATUS_LABEL: Record<Status, MessageDescriptor> = {
  todo: msg`To do`,
  in_progress: msg`In progress`,
  blocked: msg`Blocked`,
  done: msg`Done`,
  abandoned: msg`Abandoned`,
};

// Tailwind classes for status badges (tinted chip + colored text).
export const STATUS_STYLE: Record<Status, string> = {
  todo: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700",
  in_progress: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900",
  blocked: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
  done: "bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-900",
  abandoned: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900",
};

// Solid status color (dots, progress-bar segments, column accents).
export const STATUS_DOT: Record<Status, string> = {
  todo: "bg-slate-400",
  in_progress: "bg-blue-500",
  blocked: "bg-amber-500",
  done: "bg-green-500",
  abandoned: "bg-red-500",
};
