// ---- Types (mirror the Go backend JSON) ----

export type Status = "todo" | "in_progress" | "blocked" | "done" | "abandoned";

export type Role = "admin" | "member";

export interface User {
  id: number;
  username: string;
  name: string;
  avatarPath: string | null;
  role: Role;
  disabled: boolean;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  createdBy: number;
  createdAt: string;
  taskCount: number;
  archived: boolean;
}

export interface Criterion {
  id: number;
  taskId: number;
  text: string;
  done: boolean;
  abandoned: boolean;
  position: number;
}

export interface Task {
  id: number;
  projectId: number;
  title: string;
  description: string;
  tags: string[];
  criteria: Criterion[];
  assigneeId: number | null;
  dueDate: string | null;
  status: Status;
  postponeCount: number;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  // Populated only while status === "blocked".
  blockedByTaskId: number | null;
  blockedReason: string;
}

// CriterionInput is a checklist item in a task edit. Existing items keep their
// id (their text and done state are immutable; only `abandoned` can change);
// new items omit the id. Criteria are never deleted — dropping one means
// abandoning it.
export interface CriterionInput {
  id?: number;
  text: string;
  abandoned: boolean;
}

// criteriaMet reports whether every non-abandoned success criterion on a task is
// checked. Abandoned items are ignored; a task with no live criteria is
// vacuously met (never blocked from "done").
export function criteriaMet(task: Task): boolean {
  return (task.criteria ?? []).filter((c) => !c.abandoned).every((c) => c.done);
}

export type AssetKind = "image" | "video" | "document" | "other";

export interface Asset {
  id: number;
  projectId: number | null;
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
  // Set when the asset is awaiting admin purge in the "Submitted for deletion"
  // queue; null on live files.
  deletionRequestedAt: string | null;
  deletionRequestedBy: number | null;
}

// LogDetails is the structured, language-neutral payload on a log entry. Each
// action type populates only its relevant fields; older entries have no details
// and the UI falls back to a generic narration.
export interface LogDetails {
  // status_change → blocked
  reason?: string;
  blockedByTaskId?: number;
  // due_date_change, title_change (from/to)
  from?: string | null;
  to?: string | null;
  // assignee_change
  fromUser?: number | null;
  toUser?: number | null;
  // archive
  archived?: boolean;
  // criterion_check
  criterion?: string;
  done?: boolean;
  // tags_change / criteria_change (top-level diff)
  added?: string[];
  removed?: string[];
  abandoned?: string[];
  restored?: string[];
  // legacy "edit" entry (nested diff)
  fields?: string[];
  tags?: { added?: string[]; removed?: string[] };
  criteria?: { added?: string[]; abandoned?: string[]; restored?: string[] };
}

export interface LogItem {
  id: number;
  taskId: number;
  userId: number;
  type: string; // created|note|status_change|due_date_change|assignee_change|title_change|description_change|tags_change|criteria_change|criterion_check|archive (legacy: edit)
  text: string;
  fromStatus: string | null;
  toStatus: string | null;
  details?: LogDetails | null;
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

export interface Channel {
  id: number;
  name: string;
  description: string;
  createdBy: number;
  createdAt: string;
  archived: boolean;
  messageCount: number;
  lastMessageAt: string | null;
}

// A chat message. `text` holds raw reference tokens (@username, #<taskId>,
// #file<assetId>) resolved at render time by MessageText.
export interface Message {
  id: number;
  channelId: number;
  userId: number;
  text: string;
  createdAt: string;
}

export interface TaskUpdate {
  title?: string;
  description?: string;
  tags?: string[];
  criteria?: CriterionInput[];
  assigneeId?: number | null;
  dueDate?: string | null;
  status?: Status;
  archived?: boolean;
  blockedByTaskId?: number | null;
  blockedReason?: string;
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
  // deployment info (unauthenticated)
  config: () => req<{ env: string }>("/config"),

  // auth
  login: (username: string, password: string) =>
    req<User>("/login", jsonBody("POST", { username, password })),
  logout: () => req<{ ok: boolean }>("/logout", { method: "POST" }),
  me: () => req<User>("/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    req<{ ok: boolean }>("/me/password", jsonBody("POST", { currentPassword, newPassword })),

  // users
  listUsers: () => req<User[]>("/users"),
  createUser: (body: { username: string; name: string; password: string; role: Role }) =>
    req<User>("/users", jsonBody("POST", body)),
  updateUser: (id: number, body: { password?: string; role?: Role; disabled?: boolean }) =>
    req<User>(`/users/${id}`, jsonBody("PATCH", body)),
  uploadAvatar: (file: File) => {
    const fd = new FormData();
    fd.append("image", file);
    return req<User>("/users/avatar", { method: "POST", body: fd });
  },

  // projects
  listProjects: (includeArchived = false) =>
    req<Project[]>(`/projects${qs({ archived: includeArchived ? "1" : undefined })}`),
  createProject: (name: string, description: string) =>
    req<Project>("/projects", jsonBody("POST", { name, description })),
  getProject: (id: number) => req<Project>(`/projects/${id}`),
  setProjectArchived: (id: number, archived: boolean) =>
    req<Project>(`/projects/${id}`, jsonBody("PATCH", { archived })),
  // Activity pulse across all projects, or one when projectId is given.
  getPulse: (projectId?: number) =>
    req<Pulse>(`/pulse${qs({ project: projectId ? String(projectId) : undefined })}`),

  // tasks
  listTasks: (projectId: number, opts: { status?: string; tag?: string; includeArchived?: boolean } = {}) =>
    req<Task[]>(
      `/projects/${projectId}/tasks${qs({
        status: opts.status,
        tag: opts.tag,
        archived: opts.includeArchived ? "1" : undefined,
      })}`
    ),
  // Tasks across all projects.
  listAllTasks: (opts: { status?: string; tag?: string; includeArchived?: boolean } = {}) =>
    req<Task[]>(
      `/tasks${qs({
        status: opts.status,
        tag: opts.tag,
        archived: opts.includeArchived ? "1" : undefined,
      })}`
    ),
  createTask: (
    projectId: number,
    body: {
      title: string;
      description: string;
      tags: string[];
      criteria: string[];
      assigneeId: number | null;
      dueDate: string | null;
      status: Status;
      blockedByTaskId?: number | null;
      blockedReason?: string;
    }
  ) => req<Task>(`/projects/${projectId}/tasks`, jsonBody("POST", body)),
  getTask: (id: number) => req<{ task: Task; logs: LogItem[] }>(`/tasks/${id}`),
  updateTask: (id: number, patch: TaskUpdate) =>
    req<{ task: Task; newLogs: LogItem[] }>(`/tasks/${id}`, jsonBody("PATCH", patch)),
  setCriterion: (taskId: number, criterionId: number, patch: { done?: boolean; abandoned?: boolean }) =>
    req<{ task: Task; newLogs: LogItem[] }>(`/tasks/${taskId}/criteria/${criterionId}`, jsonBody("PATCH", patch)),
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
  // Upload files with no project attached (the "No project" bucket / chat uploads).
  uploadOrphanAssets: (files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    return req<Asset[]>(`/assets`, { method: "POST", body: fd });
  },
  // projectId: a number scopes to that project; "none" returns only project-less
  // files; omit for all projects.
  listAssets: (
    opts: { projectId?: number | "none"; kind?: string; tag?: string; pending?: boolean; page?: number } = {}
  ) =>
    req<{ assets: Asset[]; hasMore: boolean }>(
      `/assets${qs({
        project: opts.projectId ? String(opts.projectId) : undefined,
        kind: opts.kind,
        tag: opts.tag,
        pending: opts.pending ? "1" : undefined,
        page: opts.page ? String(opts.page) : undefined,
      })}`
    ),
  // Single asset by id — resolves inline #file references in chat messages.
  getAsset: (id: number) => req<Asset>(`/assets/${id}`),
  // Soft-delete: move an asset into the admin purge queue. Returns the updated row.
  requestDeleteAsset: (id: number) => req<Asset>(`/assets/${id}/delete`, { method: "POST" }),
  // Admin: cancel a pending deletion.
  restoreAsset: (id: number) => req<Asset>(`/assets/${id}/restore`, { method: "POST" }),
  // Admin: permanently delete a queued asset (row + bytes).
  purgeAsset: (id: number) => req<void>(`/assets/${id}`, { method: "DELETE" }),

  // chat
  listChannels: (includeArchived = false) =>
    req<Channel[]>(`/channels${qs({ archived: includeArchived ? "1" : undefined })}`),
  createChannel: (name: string, description: string) =>
    req<Channel>("/channels", jsonBody("POST", { name, description })),
  setChannelArchived: (id: number, archived: boolean) =>
    req<Channel>(`/channels/${id}`, jsonBody("PATCH", { archived })),
  listMessages: (channelId: number, opts: { after?: number; limit?: number } = {}) =>
    req<Message[]>(
      `/channels/${channelId}/messages${qs({
        after: opts.after ? String(opts.after) : undefined,
        limit: opts.limit ? String(opts.limit) : undefined,
      })}`
    ),
  postMessage: (channelId: number, text: string) =>
    req<Message>(`/channels/${channelId}/messages`, jsonBody("POST", { text })),

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
