import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, ImagePlus, Loader2, Pencil, Send, X } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { api, type LogItem, type Status, type Task, type User } from "@/lib/api";
import { STATUS_LABEL, STATUS_ORDER } from "@/lib/constants";
import { StatusBadge } from "@/components/StatusBadge";
import { UserAvatar } from "@/components/UserAvatar";
import { TaskFormDialog } from "@/components/TaskFormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { formatDateTime, formatShortDate, isPast } from "@/lib/format";
import { cn } from "@/lib/utils";

// Returns a translatable descriptor for an activity-log entry's action.
function describeMsg(log: LogItem): MessageDescriptor {
  switch (log.type) {
    case "created":
      return msg`created this task`;
    case "note":
      return log.text ? msg`logged a note` : msg`attached an image`;
    case "status_change": {
      const to = log.toStatus as Status | null;
      if (to === "done") return msg`completed this task`;
      if (to === "abandoned") return msg`abandoned this task`;
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

function LogEntry({ log, user }: { log: LogItem; user?: User }) {
  const { i18n } = useLingui();
  const name = user?.name ?? i18n._(msg`Someone`);
  return (
    <div className="flex gap-3">
      <UserAvatar name={name} avatarPath={user?.avatarPath} className="mt-0.5 h-8 w-8 text-[10px]" />
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          <span className="font-medium">{name}:</span>{" "}
          <span className="text-zinc-500">{i18n._(describeMsg(log))}</span>
          <span className="ml-2 text-xs text-zinc-500">{formatDateTime(log.createdAt)}</span>
        </div>
        {log.type === "note" && log.text && <p className="mt-1 whitespace-pre-wrap text-sm">{log.text}</p>}
        {log.imagePath && (
          <a href={log.imagePath} target="_blank" rel="noreferrer">
            <img src={log.imagePath} alt="attachment" className="mt-2 max-h-64 rounded-lg border object-cover" />
          </a>
        )}
      </div>
    </div>
  );
}

function MetaRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
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

  const [noteText, setNoteText] = useState("");
  const [noteImage, setNoteImage] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function reload() {
    const [detail, u, g] = await Promise.all([api.getTask(taskId), api.listUsers(), api.listTags()]);
    setTask(detail.task);
    setLogs(detail.logs);
    setUsers(u);
    setTags(g);
  }

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  async function changeStatus(to: Status) {
    if (!task || task.status === to) return;
    const res = await api.updateTask(task.id, { status: to });
    setTask(res.task);
    setLogs((prev) => [...prev, ...res.newLogs]);
  }

  async function postNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim() && !noteImage) return;
    setPosting(true);
    try {
      const log = await api.addLog(taskId, noteText.trim(), noteImage);
      setLogs((prev) => [...prev, log]);
      setNoteText("");
      setNoteImage(null);
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setPosting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }
  if (!task) {
    return (
      <div className="space-y-4">
        <Link to="/" className="inline-flex items-center text-sm text-zinc-500 hover:text-zinc-900">
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
    <div className="space-y-5">
      <Link
        to={`/?project=${task.projectId}`}
        className="inline-flex items-center text-sm text-zinc-500 hover:text-zinc-900"
      >
        <ChevronLeft className="h-4 w-4" /> <Trans>Back to board</Trans>
      </Link>

      <div className="flex items-start justify-between gap-3">
        <h1 className="text-xl font-bold leading-tight">{task.title}</h1>
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="h-4 w-4" />
          <Trans>Edit task</Trans>
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_280px]">
        {/* Properties rail */}
        <Card className="order-1 space-y-4 p-4 md:order-2 md:self-start">
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
          </MetaRow>
          <MetaRow label={<Trans>Tag</Trans>}>
            <Badge className="border-transparent bg-zinc-200 text-zinc-800">#{task.tag}</Badge>
          </MetaRow>
          <MetaRow label={<Trans>Assignee</Trans>}>
            {assignee ? (
              <span className="inline-flex items-center gap-2">
                <UserAvatar name={assignee.name} avatarPath={assignee.avatarPath} className="h-6 w-6 text-[10px]" />
                {assignee.name}
              </span>
            ) : (
              <span className="text-zinc-500">
                <Trans>Unassigned</Trans>
              </span>
            )}
          </MetaRow>
          <MetaRow label={<Trans>Due date</Trans>}>
            {task.dueDate ? (
              <span className={cn(overdue && "text-red-600")}>{formatShortDate(task.dueDate)}</span>
            ) : (
              <span className="text-zinc-500">—</span>
            )}
          </MetaRow>
          <MetaRow label={<Trans>Created</Trans>}>
            {formatShortDate(task.createdAt.slice(0, 10))}
            {creator && (
              <span className="text-zinc-500">
                {" "}
                <Trans>by {creator.name}</Trans>
              </span>
            )}
          </MetaRow>
        </Card>

        {/* Main column */}
        <div className="order-2 space-y-5 md:order-1">
          {task.description && <p className="whitespace-pre-wrap text-sm text-zinc-500">{task.description}</p>}

          <div className="space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <Trans>Activity log</Trans>
            </h2>
            {logs.map((log) => (
              <LogEntry key={log.id} log={log} user={usersById.get(log.userId)} />
            ))}
          </div>

          <Card className="sticky bottom-20 p-3">
            <form onSubmit={postNote} className="space-y-2">
              <Textarea
                placeholder={t`Log an update…`}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                className="min-h-[60px]"
              />
              {noteImage && (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="truncate">{noteImage.name}</span>
                  <button type="button" onClick={() => setNoteImage(null)} className="text-red-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="flex items-center justify-between">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => setNoteImage(e.target.files?.[0] ?? null)}
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
                  <ImagePlus className="h-4 w-4" />
                  <Trans>Photo</Trans>
                </Button>
                <Button type="submit" size="sm" disabled={posting || (!noteText.trim() && !noteImage)}>
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
    </div>
  );
}
