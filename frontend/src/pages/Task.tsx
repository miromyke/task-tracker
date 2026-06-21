import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Ban,
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  Download,
  FileText,
  Loader2,
  Paperclip,
  Pencil,
  RotateCcw,
  Send,
  Square,
  X,
} from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { api, criteriaMet, type Asset, type Criterion, type LogItem, type Status, type Task, type User } from "@/lib/api";
import { STATUS_LABEL, STATUS_ORDER } from "@/lib/constants";
import { StatusBadge } from "@/components/StatusBadge";
import { UserAvatar } from "@/components/UserAvatar";
import { TaskFormDialog } from "@/components/TaskFormDialog";
import { BlockTaskDialog } from "@/components/BlockTaskDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, formatShortDate, isPast } from "@/lib/format";
import { cn } from "@/lib/utils";

// Returns a translatable descriptor for an activity-log entry's action.
function describeMsg(log: LogItem): MessageDescriptor {
  switch (log.type) {
    case "created":
      return msg`created this task`;
    case "note":
      return log.text ? msg`logged a note` : msg`attached a file`;
    case "status_change": {
      const to = log.toStatus as Status | null;
      if (to === "done") return msg`completed this task`;
      if (to === "abandoned") return msg`abandoned this task`;
      if (to === "blocked") return msg`blocked this task`;
      if (to === "in_progress") return msg`started working on this`;
      if (to === "todo") return msg`moved this back to To do`;
      return msg`changed the status`;
    }
    case "due_date_change":
      return msg`changed the due date`;
    case "edit":
      return msg`edited this task`;
    default:
      return msg`updated this task`;
  }
}

// AttachmentView renders one uploaded asset by kind: images inline, video in a
// native player, everything else (documents/other) as a download chip.
function AttachmentView({ asset }: { asset: Asset }) {
  if (asset.kind === "image") {
    return (
      <a href={asset.path} target="_blank" rel="noreferrer">
        <img src={asset.path} alt={asset.filename} className="max-h-64 rounded-lg border object-cover" />
      </a>
    );
  }
  if (asset.kind === "video") {
    return <video src={asset.path} controls preload="metadata" className="max-h-64 rounded-lg border" />;
  }
  return (
    <a
      href={`${asset.path}?download=1`}
      className="inline-flex max-w-full items-center gap-2 rounded-lg border bg-muted px-3 py-2 text-sm hover:bg-muted"
    >
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{asset.filename}</span>
      <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </a>
  );
}

function LogEntry({ log, user }: { log: LogItem; user?: User }) {
  const { i18n } = useLingui();
  const name = user?.name ?? i18n._(msg`Someone`);
  const isNote = log.type === "note";
  // Comments show the author then their message; activity entries narrate the
  // action. A blocked status_change carries the block reason as its text.
  const showText = log.text && (isNote || log.type === "status_change");
  return (
    <div className="flex gap-3">
      <UserAvatar name={name} avatarPath={user?.avatarPath} className="mt-0.5 h-8 w-8 text-[10px]" />
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          <span className="font-medium">{name}:</span>{" "}
          {!isNote && <span className="text-muted-foreground">{i18n._(describeMsg(log))}</span>}
          <span className="ml-2 text-xs text-muted-foreground">{formatDateTime(log.createdAt)}</span>
        </div>
        {showText && <p className="mt-1 whitespace-pre-wrap text-sm">{log.text}</p>}
        {(log.attachments ?? []).length > 0 && (
          <div className="mt-2 flex flex-col items-start gap-2">
            {log.attachments.map((a) => (
              <AttachmentView key={a.id} asset={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MetaRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

export function TaskPage() {
  const { id } = useParams();
  const taskId = Number(id);
  const { t, i18n } = useLingui();

  const [task, setTask] = useState<Task | null>(null);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [logTab, setLogTab] = useState<"comments" | "activity">("comments");

  const [noteText, setNoteText] = useState("");
  const [noteFiles, setNoteFiles] = useState<File[]>([]);
  const [posting, setPosting] = useState(false);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function reload() {
    const [detail, u, g, ts] = await Promise.all([
      api.getTask(taskId),
      api.listUsers(),
      api.listTags(),
      api.listAllTasks({ includeArchived: true }),
    ]);
    setTask(detail.task);
    setLogs(detail.logs);
    setUsers(u);
    setTags(g);
    setAllTasks(ts);
  }

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const comments = useMemo(() => logs.filter((l) => l.type === "note"), [logs]);
  const activity = useMemo(() => logs.filter((l) => l.type !== "note"), [logs]);
  // Resolve the blocker's title by cross-referencing the loaded task list.
  const taskTitleById = useMemo(() => new Map(allTasks.map((t) => [t.id, t.title])), [allTasks]);

  async function changeStatus(to: Status) {
    if (!task || task.status === to) return;
    if (to === "done" && !criteriaMet(task)) {
      setStatusError(t`Check off all success criteria before marking this done.`);
      return;
    }
    // Blocking needs a required reference + optional reason — collect them first.
    if (to === "blocked") {
      setStatusError(null);
      setBlockOpen(true);
      return;
    }
    setStatusError(null);
    const res = await api.updateTask(task.id, { status: to });
    setTask(res.task);
    setLogs((prev) => [...prev, ...res.newLogs]);
  }

  async function applyBlock(blockedByTaskId: number, reason: string) {
    if (!task) return;
    const res = await api.updateTask(task.id, { status: "blocked", blockedByTaskId, blockedReason: reason });
    setTask(res.task);
    setLogs((prev) => [...prev, ...res.newLogs]);
  }

  async function toggleArchive() {
    if (!task) return;
    const res = await api.updateTask(task.id, { archived: !task.archived });
    setTask(res.task);
  }

  async function toggleCriterion(c: Criterion) {
    if (!task || c.abandoned) return;
    const res = await api.setCriterion(task.id, c.id, { done: !c.done });
    setTask(res.task);
    setStatusError(null);
  }

  async function abandonCriterion(c: Criterion) {
    if (!task) return;
    const res = await api.setCriterion(task.id, c.id, { abandoned: !c.abandoned });
    setTask(res.task);
    setStatusError(null);
  }

  async function postNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim() && noteFiles.length === 0) return;
    setPosting(true);
    try {
      const log = await api.addLog(taskId, noteText.trim(), noteFiles);
      setLogs((prev) => [...prev, log]);
      setLogTab("comments");
      setNoteText("");
      setNoteFiles([]);
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setPosting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!task) {
    return (
      <div className="space-y-4">
        <Link to="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> <Trans>Back</Trans>
        </Link>
        <p>
          <Trans>Task not found.</Trans>
        </p>
      </div>
    );
  }

  const assignee = task.assigneeId ? usersById.get(task.assigneeId) : undefined;
  const creator = usersById.get(task.createdBy);
  const overdue = task.dueDate && isPast(task.dueDate) && task.status !== "done" && task.status !== "abandoned";

  return (
    <div className="flex h-full flex-col gap-5">
      <Link
        to={`/?project=${task.projectId}`}
        className="inline-flex shrink-0 items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> <Trans>Back to board</Trans>
      </Link>

      <div className="flex shrink-0 items-start justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold leading-tight">
          {task.archived && <Archive className="h-4 w-4 shrink-0 text-muted-foreground" />}
          {task.title}
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleArchive}
            title={task.archived ? t`Unarchive task` : t`Archive task`}
          >
            {task.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            <span className="hidden sm:inline">{task.archived ? <Trans>Unarchive</Trans> : <Trans>Archive</Trans>}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" />
            <Trans>Edit task</Trans>
          </Button>
        </div>
      </div>

      {/* Mobile-only compact properties bar — part of the header; desktop uses the rail */}
      <div className="shrink-0 space-y-2 border-b pb-3 md:hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <Select value={task.status} onValueChange={(v) => changeStatus(v as Status)}>
            <SelectTrigger className="h-8 w-auto gap-1.5 border-0 bg-transparent px-1 shadow-none focus:ring-0 focus:ring-offset-0">
              <StatusBadge status={task.status} />
            </SelectTrigger>
            <SelectContent>
              {STATUS_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {i18n._(STATUS_LABEL[s])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="text-border">|</span>

          {assignee ? (
            <span className="inline-flex items-center gap-1.5">
              <UserAvatar name={assignee.name} avatarPath={assignee.avatarPath} className="h-5 w-5 text-[9px]" />
              {assignee.name}
            </span>
          ) : (
            <span className="text-muted-foreground">
              <Trans>Unassigned</Trans>
            </span>
          )}

          <span className="text-border">|</span>

          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" />
            {task.dueDate ? (
              <span className={cn(overdue && "text-red-600")}>{formatShortDate(task.dueDate)}</span>
            ) : (
              "—"
            )}
          </span>

          {task.tags.length > 0 && (
            <span className="flex flex-wrap items-center gap-1">
              {task.tags.map((tg) => (
                <Badge key={tg} className="border-transparent bg-accent text-accent-foreground">
                  #{tg}
                </Badge>
              ))}
            </span>
          )}
        </div>
        {statusError && <p className="text-xs text-red-600">{statusError}</p>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 md:flex-row">
        {/* Desktop properties rail (mobile uses the compact bar inside the column) */}
        <Card className="hidden shrink-0 space-y-4 p-4 md:order-2 md:block md:w-[280px] md:self-start">
          <MetaRow label={<Trans>Status</Trans>}>
            <Select value={task.status} onValueChange={(v) => changeStatus(v as Status)}>
              <SelectTrigger className="h-9">
                <StatusBadge status={task.status} />
              </SelectTrigger>
              <SelectContent>
                {STATUS_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>
                    {i18n._(STATUS_LABEL[s])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {statusError && <p className="mt-1 text-xs text-red-600">{statusError}</p>}
          </MetaRow>
          <MetaRow label={<Trans>Tags</Trans>}>
            <span className="flex flex-wrap gap-1">
              {task.tags.map((tg) => (
                <Badge key={tg} className="border-transparent bg-accent text-accent-foreground">
                  #{tg}
                </Badge>
              ))}
            </span>
          </MetaRow>
          <MetaRow label={<Trans>Assignee</Trans>}>
            {assignee ? (
              <span className="inline-flex items-center gap-2">
                <UserAvatar name={assignee.name} avatarPath={assignee.avatarPath} className="h-6 w-6 text-[10px]" />
                {assignee.name}
              </span>
            ) : (
              <span className="text-muted-foreground">
                <Trans>Unassigned</Trans>
              </span>
            )}
          </MetaRow>
          <MetaRow label={<Trans>Due date</Trans>}>
            {task.dueDate ? (
              <span className={cn(overdue && "text-red-600")}>{formatShortDate(task.dueDate)}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </MetaRow>
          <MetaRow label={<Trans>Created</Trans>}>
            {formatShortDate(task.createdAt.slice(0, 10))}
            {creator && (
              <span className="text-muted-foreground">
                {" "}
                <Trans>by {creator.name}</Trans>
              </span>
            )}
          </MetaRow>
        </Card>

        {/* Main column: content scrolls within the available height; the note
            input below stays put. */}
        <div className="order-2 flex min-h-0 flex-1 flex-col md:order-1">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          {task.status === "blocked" && (
            <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/40">
              <div className="flex items-center gap-1.5 font-medium text-amber-900 dark:text-amber-200">
                <Ban className="h-4 w-4" />
                <Trans>Blocked</Trans>
              </div>
              {task.blockedByTaskId && (
                <p className="text-amber-900 dark:text-amber-200">
                  <Trans>Blocked by</Trans>{" "}
                  <Link to={`/tasks/${task.blockedByTaskId}`} className="font-medium underline">
                    {taskTitleById.get(task.blockedByTaskId) ?? `#${task.blockedByTaskId}`}
                  </Link>
                </p>
              )}
              {task.blockedReason && (
                <p className="whitespace-pre-wrap text-amber-800 dark:text-amber-300">{task.blockedReason}</p>
              )}
            </div>
          )}
          {task.description && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{task.description}</p>}

          {(task.criteria ?? []).length > 0 &&
            (() => {
              const live = task.criteria.filter((c) => !c.abandoned);
              const abandoned = task.criteria.filter((c) => c.abandoned);
              return (
                <Card className="space-y-3 p-4">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Trans>Success criteria</Trans>{" "}
                    <span className="text-muted-foreground">
                      {live.filter((c) => c.done).length}/{live.length}
                    </span>
                  </h2>
                  <ul className="space-y-1.5">
                    {live.map((c) => (
                      <li key={c.id} className="group flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => toggleCriterion(c)}
                          className="flex min-w-0 flex-1 items-start gap-2 text-left text-sm hover:text-foreground"
                        >
                          {c.done ? (
                            <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                          ) : (
                            <Square className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className={cn(c.done && "text-muted-foreground line-through")}>{c.text}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => abandonCriterion(c)}
                          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground group-hover:text-muted-foreground"
                          aria-label={t`Abandon criterion`}
                          title={t`Abandon criterion`}
                        >
                          <Ban className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  {abandoned.length > 0 && (
                    <ul className="space-y-1.5 border-t pt-2">
                      {abandoned.map((c) => (
                        <li key={c.id} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <Ban className="mt-0.5 h-4 w-4 shrink-0" />
                          <span className="min-w-0 flex-1 line-through">{c.text}</span>
                          <button
                            type="button"
                            onClick={() => abandonCriterion(c)}
                            className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                            aria-label={t`Restore criterion`}
                            title={t`Restore criterion`}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })()}

          <div className="space-y-4">
            <Tabs value={logTab} onValueChange={(v) => setLogTab(v as typeof logTab)}>
              <TabsList>
                <TabsTrigger value="comments">
                  <Trans>Comments</Trans>
                  {comments.length > 0 && <span className="ml-1.5 text-xs text-muted-foreground">{comments.length}</span>}
                </TabsTrigger>
                <TabsTrigger value="activity">
                  <Trans>Activity</Trans>
                  {activity.length > 0 && <span className="ml-1.5 text-xs text-muted-foreground">{activity.length}</span>}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {(logTab === "comments" ? comments : activity).map((log) => (
              <LogEntry key={log.id} log={log} user={usersById.get(log.userId)} />
            ))}
            {logTab === "comments" && comments.length === 0 && (
              <p className="text-sm text-muted-foreground">
                <Trans>No comments yet. Post the first update below.</Trans>
              </p>
            )}
          </div>
          </div>

          <Card className="mt-4 shrink-0 border-0 p-0 pr-1 shadow-none">
            <form onSubmit={postNote} className="space-y-2">
              <Textarea
                placeholder={t`Log an update…`}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                className="min-h-[60px]"
              />
              {noteFiles.length > 0 && (
                <div className="space-y-1">
                  {noteFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Paperclip className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{f.name}</span>
                      <button
                        type="button"
                        onClick={() => setNoteFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="text-red-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between">
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    const sel = e.target.files ? Array.from(e.target.files) : [];
                    if (sel.length) setNoteFiles((prev) => [...prev, ...sel]);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
                  <Paperclip className="h-4 w-4" />
                  <Trans>Attach</Trans>
                </Button>
                <Button type="submit" size="sm" disabled={posting || (!noteText.trim() && noteFiles.length === 0)}>
                  {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  <Trans>Post</Trans>
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
      <TaskFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        projectId={task.projectId}
        task={task}
        users={users}
        tags={tags}
        onSaved={() => reload()}
      />

      <BlockTaskDialog
        open={blockOpen}
        onOpenChange={setBlockOpen}
        projectId={task.projectId}
        currentTaskId={task.id}
        onConfirm={applyBlock}
      />
    </div>
  );
}
