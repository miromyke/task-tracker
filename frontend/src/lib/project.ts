import type { Project, Status, Task, User } from "./api";

export interface Progress {
  total: number;
  done: number;
  percent: number;
  counts: Record<Status, number>;
}

export function deriveProgress(tasks: Task[]): Progress {
  const counts: Record<Status, number> = { todo: 0, in_progress: 0, done: 0, abandoned: 0 };
  for (const t of tasks) counts[t.status]++;
  const total = tasks.length;
  const considered = total - counts.abandoned; // abandoned tasks don't count toward completion
  const percent = considered > 0 ? Math.round((counts.done / considered) * 100) : 0;
  return { total, done: counts.done, percent, counts };
}

// Members = project creator + everyone who created or is assigned a task in it.
export function deriveMembers(tasks: Task[], project: Project | null, usersById: Map<number, User>): User[] {
  const ids = new Set<number>();
  if (project) ids.add(project.createdBy);
  for (const t of tasks) {
    ids.add(t.createdBy);
    if (t.assigneeId) ids.add(t.assigneeId);
  }
  return [...ids].map((id) => usersById.get(id)).filter((u): u is User => !!u);
}

// Soonest due date among still-open tasks (todo / in_progress), if any.
export function nextDue(tasks: Task[]): string | null {
  const open = tasks
    .filter((t) => (t.status === "todo" || t.status === "in_progress") && t.dueDate)
    .map((t) => t.dueDate!)
    .sort();
  return open[0] ?? null;
}

// Tasks shown in the overview "Up next": open tasks, soonest due first.
export function upNext(tasks: Task[], limit = 4): Task[] {
  return tasks
    .filter((t) => t.status === "todo" || t.status === "in_progress")
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.id - b.id)
    .slice(0, limit);
}
