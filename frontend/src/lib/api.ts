// ---- Types (mirror the Go backend JSON) ----

export type Status = "todo" | "in_progress" | "done" | "abandoned";

export interface User {
  id: number;
  username: string;
  name: string;
  avatarPath: string | null;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  createdBy: number;
  createdAt: string;
  taskCount: number;
}

export interface Task {
  id: number;
  projectId: number;
  title: string;
  description: string;
  tags: string[];
  assigneeId: number | null;
  dueDate: string | null;
  status: Status;
  postponeCount: number;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

export type AssetKind = "image" | "video" | "document" | "other";

export interface Asset {
  id: number;
  projectId: number;
  taskId: number | null;
  logId: number | null;
  uploadedBy: number;
  kind: AssetKind;
  mime: string;
  filename: string;
  path: string;
  thumbPath: string | null;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  createdAt: string;
}

export interface LogItem {
  id: number;
  taskId: number;
  userId: number;
  type: string; // created | note | status_change | due_date_change | edit
  text: string;
  fromStatus: string | null;
  toStatus: string | null;
  attachments: Asset[];
  createdAt: string;
}

export interface CalendarDay {
  date: string;
  count: number;
  attachments: number;
  gold: boolean;
}

export interface DayEvent {
  id: number;
  type: string; // note | status_change
  text: string;
  fromStatus: string | null;
  toStatus: string | null;
  attachments: Asset[];
  createdAt: string;
  user: User;
  task: {
    id: number;
    title: string;
    projectId: number;
    projectName: string;
    tags: string[];
  };
}

export interface PulseDay {
  date: string;
  count: number;
  gold: boolean;
  attachments: number;
}

export interface Pulse {
  days: PulseDay[];
}

export interface TaskUpdate {
  title?: string;
  description?: string;
  tags?: string[];
  assigneeId?: number | null;
  dueDate?: string | null;
  status?: Status;
}

// ---- HTTP layer ----

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch("/api" + path, { credentials: "include", ...opts });
  if (!res.ok) {
    let msg = res.statusText || "request failed";
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function jsonBody(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const api = {
  // auth
  login: (username: string) => req<User>("/login", jsonBody("POST", { username })),
  logout: () => req<{ ok: boolean }>("/logout", { method: "POST" }),
  me: () => req<User>("/me"),

  // users
  listUsers: () => req<User[]>("/users"),
  uploadAvatar: (file: File) => {
    const fd = new FormData();
    fd.append("image", file);
    return req<User>("/users/avatar", { method: "POST", body: fd });
  },

  // projects
  listProjects: () => req<Project[]>("/projects"),
  createProject: (name: string, description: string) =>
    req<Project>("/projects", jsonBody("POST", { name, description })),
  getProject: (id: number) => req<Project>(`/projects/${id}`),
  // Activity pulse across all projects, or one when projectId is given.
  getPulse: (projectId?: number) =>
    req<Pulse>(`/pulse${qs({ project: projectId ? String(projectId) : undefined })}`),

  // tasks
  listTasks: (projectId: number, opts: { status?: string; tag?: string } = {}) =>
    req<Task[]>(`/projects/${projectId}/tasks${qs(opts)}`),
  // Tasks across all projects.
  listAllTasks: (opts: { status?: string; tag?: string } = {}) =>
    req<Task[]>(`/tasks${qs(opts)}`),
  createTask: (
    projectId: number,
    body: {
      title: string;
      description: string;
      tags: string[];
      assigneeId: number | null;
      dueDate: string | null;
      status: Status;
    }
  ) => req<Task>(`/projects/${projectId}/tasks`, jsonBody("POST", body)),
  getTask: (id: number) => req<{ task: Task; logs: LogItem[] }>(`/tasks/${id}`),
  updateTask: (id: number, patch: TaskUpdate) =>
    req<{ task: Task; newLogs: LogItem[] }>(`/tasks/${id}`, jsonBody("PATCH", patch)),
  addLog: (taskId: number, text: string, files: File[]) => {
    const fd = new FormData();
    fd.append("text", text);
    for (const f of files) fd.append("files", f);
    return req<LogItem>(`/tasks/${taskId}/log`, { method: "POST", body: fd });
  },

  // assets (Files page)
  uploadAssets: (projectId: number, files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    return req<Asset[]>(`/projects/${projectId}/assets`, { method: "POST", body: fd });
  },
  listAssets: (opts: { projectId?: number; kind?: string; tag?: string; page?: number } = {}) =>
    req<{ assets: Asset[]; hasMore: boolean }>(
      `/assets${qs({
        project: opts.projectId ? String(opts.projectId) : undefined,
        kind: opts.kind,
        tag: opts.tag,
        page: opts.page ? String(opts.page) : undefined,
      })}`
    ),

  // tags + calendar
  listTags: () => req<string[]>("/tags"),
  getCalendar: (from: string, to: string, tag?: string, projectId?: number) =>
    req<CalendarDay[]>(
      `/calendar${qs({ from, to, tag, project: projectId ? String(projectId) : undefined })}`
    ),
  getCalendarDay: (date: string, tag?: string, projectId?: number) =>
    req<{ date: string; events: DayEvent[] }>(
      `/calendar/day/${date}${qs({ tag, project: projectId ? String(projectId) : undefined })}`
    ),
};
