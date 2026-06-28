// ---- Types (mirror the Go backend JSON) ----

export type Status = "todo" | "in_progress" | "blocked" | "done" | "abandoned";

export type Role = "admin" | "member";

// Per-user capabilities (#17). Admins bypass these entirely — see can().
export interface Capabilities {
  manageProjects: boolean; // create / archive projects
  viewReporting: boolean; // pulse + calendar
  viewHistory: boolean; // task activity logs
}

export type Capability = keyof Capabilities;

export interface User {
  id: number;
  username: string;
  // name is the composed display name (first + surname), kept for every consumer
  // that renders a single name. firstName/surname are the structured source (#19).
  name: string;
  firstName: string;
  surname: string;
  // jobRole is a free-text job/function label (e.g. "Architect") shown in braces
  // after the name (#26). Distinct from `role` (the admin/member access role).
  jobRole: string;
  avatarPath: string | null;
  role: Role;
  disabled: boolean;
  capabilities: Capabilities;
}

// can reports whether a user may exercise a capability. Admins always can.
export function can(user: User | null | undefined, cap: Capability): boolean {
  if (!user) return false;
  return user.role === "admin" || !!user.capabilities?.[cap];
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
  // Where a project-less upload came from when it isn't derivable from the ids:
  // "chat" for a chat-composer upload, "" for a direct Files-page upload.
  source: string;
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

// A log entry the day report doesn't narrate as a story line (edit, due-date /
// assignee change, archive, checklist tweak…). Rolled up into the "also today"
// footer and listed in the detailed view.
export interface MinorEvent {
  type: string;
  createdAt: string;
  userName: string;
  taskTitle: string;
  projectName: string;
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

// A chat message. `text` holds raw reference tokens (@[userId], #<taskId>,
// #file<assetId>) resolved at render time by MessageText. Soft-deletable (#15):
// when deletedAt is set, non-admins receive an empty `text` tombstone while
// admins keep the original for the audit view.
export interface Message {
  id: number;
  channelId: number;
  userId: number;
  text: string;
  createdAt: string;
  deletedAt: string | null;
  deletedBy: number | null;
}

export type NotificationType = "mention" | "task_assigned" | "task_activity";

// A per-user notification (#14). Refs are resolved server-side to titles/names so
// the bell can render a line directly. count > 1 means coalesced task activity.
export interface Notification {
  id: number;
  type: NotificationType;
  count: number;
  read: boolean;
  createdAt: string;
  updatedAt: string;
  actor: { id: number; name: string; jobRole: string; avatarPath: string | null } | null;
  taskId: number | null;
  taskTitle: string | null;
  channelId: number | null;
  channelName: string | null;
  messageId: number | null;
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
  updateProfile: (body: { firstName: string; surname: string; jobRole: string }) =>
    req<User>("/me", jsonBody("PATCH", body)),
  changePassword: (currentPassword: string, newPassword: string) =>
    req<{ ok: boolean }>("/me/password", jsonBody("POST", { currentPassword, newPassword })),

  // users
  listUsers: () => req<User[]>("/users"),
  createUser: (body: {
    username: string;
    firstName: string;
    surname: string;
    jobRole: string;
    password: string;
    role: Role;
  }) => req<User>("/users", jsonBody("POST", body)),
  updateUser: (
    id: number,
    body: {
      password?: string;
      firstName?: string;
      surname?: string;
      jobRole?: string;
      role?: Role;
      disabled?: boolean;
      capabilities?: Capabilities;
    }
  ) => req<User>(`/users/${id}`, jsonBody("PATCH", body)),
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
  // project membership (#18)
  listProjectMembers: (projectId: number) => req<User[]>(`/projects/${projectId}/members`),
  addProjectMember: (projectId: number, userId: number) =>
    req<User[]>(`/projects/${projectId}/members`, jsonBody("POST", { userId })),
  removeProjectMember: (projectId: number, userId: number) =>
    req<User[]>(`/projects/${projectId}/members/${userId}`, { method: "DELETE" }),
  // Activity pulse across all projects, or one when projectId is given.
  // includeArchived surfaces logs from archived tasks/projects (mirrors ?archived=1).
  getPulse: (projectId?: number, includeArchived = false) =>
    req<Pulse>(
      `/pulse${qs({
        project: projectId ? String(projectId) : undefined,
        archived: includeArchived ? "1" : undefined,
      })}`
    ),

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
  getTask: (id: number) =>
    req<{ task: Task; logs: LogItem[]; canViewHistory: boolean }>(`/tasks/${id}`),
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
  // source ("chat") records provenance for the Files page; omit for a plain upload.
  uploadOrphanAssets: (files: File[], source?: "chat") => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    if (source) fd.append("source", source);
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
  // Soft-delete a message (author or admin). Returns the updated row.
  deleteMessage: (channelId: number, messageId: number) =>
    req<Message>(`/channels/${channelId}/messages/${messageId}`, { method: "DELETE" }),

  // tags + calendar
  listTags: () => req<string[]>("/tags"),
  getCalendar: (from: string, to: string, tag?: string, projectId?: number, includeArchived = false) =>
    req<CalendarDay[]>(
      `/calendar${qs({
        from,
        to,
        tag,
        project: projectId ? String(projectId) : undefined,
        archived: includeArchived ? "1" : undefined,
      })}`
    ),
  getCalendarDay: (date: string, tag?: string, projectId?: number, includeArchived = false) =>
    req<{ date: string; events: DayEvent[]; minor: MinorEvent[] }>(
      `/calendar/day/${date}${qs({
        tag,
        project: projectId ? String(projectId) : undefined,
        archived: includeArchived ? "1" : undefined,
      })}`
    ),

  // notifications
  listNotifications: () => req<Notification[]>("/notifications"),
  notificationsUnreadCount: () => req<{ count: number }>("/notifications/unread-count"),
  markNotificationRead: (id: number) =>
    req<{ ok: boolean }>(`/notifications/${id}/read`, { method: "POST" }),
  markAllNotificationsRead: () =>
    req<{ ok: boolean }>("/notifications/read-all", { method: "POST" }),
};
