import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { api, type Status, type Task, type User } from "@/lib/api";
import { STATUS_LABEL, STATUS_ORDER } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  task?: Task | null; // present => edit mode
  users: User[];
  tags: string[];
  onSaved: (task: Task) => void;
}

const NONE = "__none__";

export function TaskFormDialog({ open, onOpenChange, projectId, task, users, tags, onSaved }: Props) {
  const { t, i18n } = useLingui();
  const editing = !!task;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tag, setTag] = useState("");
  const [assignee, setAssignee] = useState<string>(NONE);
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<Status>("todo");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setTag(task?.tag ?? "");
    setAssignee(task?.assigneeId ? String(task.assigneeId) : NONE);
    setDueDate(task?.dueDate ?? "");
    setStatus(task?.status ?? "todo");
    setError(null);
  }, [open, task]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError(t`Title is required`);
    if (!tag.trim()) return setError(t`Tag is required`);
    setBusy(true);
    setError(null);
    const payload = {
      title: title.trim(),
      description: description.trim(),
      tag: tag.trim(),
      assigneeId: assignee === NONE ? null : Number(assignee),
      dueDate: dueDate || null,
      status,
    };
    try {
      let saved: Task;
      if (editing && task) {
        saved = (await api.updateTask(task.id, payload)).task;
      } else {
        saved = await api.createTask(projectId, payload);
      }
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not save task`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? <Trans>Edit task</Trans> : <Trans>New task</Trans>}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">
              <Trans>Title</Trans>
            </Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!editing} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">
              <Trans>Description</Trans>
            </Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="tag">
                <Trans>Tag</Trans>
              </Label>
              <Input id="tag" list="tag-suggestions" placeholder={t`e.g. roof`} value={tag} onChange={(e) => setTag(e.target.value)} />
              <datalist id="tag-suggestions">
                {tags.map((tg) => (
                  <option key={tg} value={tg} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label htmlFor="due">
                <Trans>Due date</Trans>
              </Label>
              <Input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>
                <Trans>Assignee</Trans>
              </Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    <Trans>Unassigned</Trans>
                  </SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>
                <Trans>Status</Trans>
              </Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {i18n._(STATUS_LABEL[s])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? <Trans>Save changes</Trans> : <Trans>Create task</Trans>}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
