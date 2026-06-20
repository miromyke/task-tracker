import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { api, type Project, type Status, type Task, type User } from "@/lib/api";
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
  projectId?: number | null; // preselected project; when absent in create mode, the user picks one
  projects?: Project[]; // choices for the project picker (create mode, no fixed project)
  task?: Task | null; // present => edit mode
  users: User[];
  tags: string[]; // all existing tags, for the combobox suggestions
  onSaved: (task: Task) => void;
}

const NONE = "__none__";

export function TaskFormDialog({ open, onOpenChange, projectId, projects, task, users, tags, onSaved }: Props) {
  const { t, i18n } = useLingui();
  const editing = !!task;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagOpen, setTagOpen] = useState(false);
  const [tagHighlight, setTagHighlight] = useState(0);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const [assignee, setAssignee] = useState<string>(NONE);
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<Status>("todo");
  const [project, setProject] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only offer the picker when creating without a fixed project.
  const showProjectPicker = !editing && !projectId && !!projects?.length;

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setSelectedTags(task?.tags ?? []);
    setTagInput("");
    setAssignee(task?.assigneeId ? String(task.assigneeId) : NONE);
    setDueDate(task?.dueDate ?? "");
    setStatus(task?.status ?? "todo");
    setProject(projectId ? String(projectId) : "");
    setError(null);
  }, [open, task, projectId]);

  // Existing tags that match the current query and aren't already picked.
  const tagQuery = tagInput.trim().toLowerCase();
  const tagMatches = tags.filter(
    (tg) => !selectedTags.includes(tg) && (!tagQuery || tg.toLowerCase().includes(tagQuery))
  );
  // Offer to create when the typed value isn't an existing tag.
  const canCreateTag = tagQuery.length > 0 && !tags.some((tg) => tg.toLowerCase() === tagQuery);
  const tagOptionCount = tagMatches.length + (canCreateTag ? 1 : 0);

  function addTag(raw: string) {
    const v = raw.trim();
    if (!v) return;
    setSelectedTags((prev) => (prev.some((x) => x.toLowerCase() === v.toLowerCase()) ? prev : [...prev, v]));
    setTagInput("");
    setTagHighlight(0);
  }

  function removeTag(tg: string) {
    setSelectedTags((prev) => prev.filter((x) => x !== tg));
  }

  function onTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setTagOpen(true);
      setTagHighlight((h) => Math.min(h + 1, tagOptionCount - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setTagHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (tagOpen && tagHighlight < tagMatches.length) addTag(tagMatches[tagHighlight]);
      else addTag(tagInput); // commit / create the typed value
    } else if (e.key === "Escape") {
      setTagOpen(false);
    } else if (e.key === "Backspace" && !tagInput && selectedTags.length) {
      removeTag(selectedTags[selectedTags.length - 1]);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError(t`Title is required`);
    // Fold in a tag the user typed but didn't commit with Enter.
    const finalTags = tagInput.trim() && !selectedTags.includes(tagInput.trim())
      ? [...selectedTags, tagInput.trim()]
      : selectedTags;
    if (finalTags.length === 0) return setError(t`At least one tag is required`);
    const targetProject = projectId || Number(project);
    if (!editing && !targetProject) return setError(t`Pick a project`);
    setBusy(true);
    setError(null);
    const payload = {
      title: title.trim(),
      description: description.trim(),
      tags: finalTags,
      assigneeId: assignee === NONE ? null : Number(assignee),
      dueDate: dueDate || null,
      status,
    };
    try {
      let saved: Task;
      if (editing && task) {
        saved = (await api.updateTask(task.id, payload)).task;
      } else {
        saved = await api.createTask(targetProject, payload);
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
          {showProjectPicker && (
            <div className="space-y-2">
              <Label>
                <Trans>Project</Trans>
              </Label>
              <Select value={project} onValueChange={setProject}>
                <SelectTrigger>
                  <SelectValue placeholder={t`Select a project`} />
                </SelectTrigger>
                <SelectContent>
                  {projects!.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
                <Trans>Tags</Trans>
              </Label>
              <div className="relative">
                <div
                  className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2 py-1 text-sm focus-within:ring-1 focus-within:ring-ring"
                  onClick={() => tagInputRef.current?.focus()}
                >
                  {selectedTags.map((tg) => (
                    <span
                      key={tg}
                      className="inline-flex items-center gap-1 rounded bg-zinc-200 px-1.5 py-0.5 text-xs text-zinc-800"
                    >
                      #{tg}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTag(tg);
                        }}
                        className="text-zinc-500 hover:text-zinc-900"
                        aria-label={t`Remove tag`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    id="tag"
                    ref={tagInputRef}
                    placeholder={selectedTags.length ? "" : t`e.g. roof`}
                    className="min-w-[5rem] flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                    value={tagInput}
                    onChange={(e) => {
                      setTagInput(e.target.value);
                      setTagOpen(true);
                      setTagHighlight(0);
                    }}
                    onKeyDown={onTagKeyDown}
                    onFocus={() => setTagOpen(true)}
                    onBlur={() => setTagOpen(false)}
                  />
                </div>
                {tagOpen && tagOptionCount > 0 && (
                  <ul className="absolute z-50 mt-1 max-h-44 w-full overflow-auto rounded-md border bg-white py-1 text-sm shadow-md">
                    {tagMatches.map((tg, i) => (
                      <li key={tg}>
                        <button
                          type="button"
                          // Keep the input focused so its onBlur doesn't close the list before the click lands.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => addTag(tg)}
                          onMouseEnter={() => setTagHighlight(i)}
                          className={`flex w-full items-center px-2 py-1.5 text-left ${
                            i === tagHighlight ? "bg-zinc-100" : ""
                          }`}
                        >
                          #{tg}
                        </button>
                      </li>
                    ))}
                    {canCreateTag && (
                      <li>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => addTag(tagInput)}
                          onMouseEnter={() => setTagHighlight(tagMatches.length)}
                          className={`flex w-full items-center gap-1 px-2 py-1.5 text-left ${
                            tagHighlight === tagMatches.length ? "bg-zinc-100" : ""
                          }`}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <Trans>Create</Trans> <span className="font-medium">#{tagInput.trim()}</span>
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </div>
              <p className="text-xs text-zinc-500">
                <Trans>Pick an existing tag or type a new one and press Enter.</Trans>
              </p>
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
