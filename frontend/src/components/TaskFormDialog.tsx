import { useEffect, useRef, useState } from "react";
import { Ban, Calendar as CalendarIcon, Loader2, Plus, RotateCcw, X } from "lucide-react";
import { format, parse } from "date-fns";
import { enUS, uk } from "date-fns/locale";
import { Trans, useLingui } from "@lingui/react/macro";
import { api, type CriterionInput, type Project, type Status, type Task, type User } from "@/lib/api";
import { STATUS_LABEL, STATUS_ORDER } from "@/lib/constants";
import { BlockedBySelect, useBlockCandidates } from "@/components/BlockTaskDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
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
  const [criteria, setCriteria] = useState<CriterionInput[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagOpen, setTagOpen] = useState(false);
  const [tagHighlight, setTagHighlight] = useState(0);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const [assignee, setAssignee] = useState<string>(NONE);
  const [dueDate, setDueDate] = useState("");
  const [dueOpen, setDueOpen] = useState(false);
  const [status, setStatus] = useState<Status>("todo");
  const [project, setProject] = useState<string>("");
  const [blockedBy, setBlockedBy] = useState("");
  const [blockedReason, setBlockedReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only offer the picker when creating without a fixed project.
  const showProjectPicker = !editing && !projectId && !!projects?.length;

  // Candidate "blocked by" tasks come from the form's target project; loaded only
  // while the status is "blocked".
  const formProjectId = projectId || Number(project) || undefined;
  const blockCandidates = useBlockCandidates(formProjectId, task?.id, open && status === "blocked");

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setCriteria(task?.criteria?.map((c) => ({ id: c.id, text: c.text, abandoned: c.abandoned })) ?? []);
    setSelectedTags(task?.tags ?? []);
    setTagInput("");
    setAssignee(task?.assigneeId ? String(task.assigneeId) : NONE);
    setDueDate(task?.dueDate ?? "");
    setStatus(task?.status ?? "todo");
    setProject(projectId ? String(projectId) : "");
    setBlockedBy(task?.blockedByTaskId ? String(task.blockedByTaskId) : "");
    setBlockedReason(task?.blockedReason ?? "");
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

  function addCriterion() {
    setCriteria((prev) => [...prev, { text: "", abandoned: false }]);
  }
  function setCriterionText(i: number, text: string) {
    setCriteria((prev) => prev.map((c, j) => (j === i ? { ...c, text } : c)));
  }
  // New (unsaved) items can be removed outright; existing ones are immutable and
  // can only be abandoned/restored.
  function removeNewCriterion(i: number) {
    setCriteria((prev) => prev.filter((_, j) => j !== i));
  }
  function toggleAbandon(i: number) {
    setCriteria((prev) => prev.map((c, j) => (j === i ? { ...c, abandoned: !c.abandoned } : c)));
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
    const targetProject = projectId || Number(project);
    if (!editing && !targetProject) return setError(t`Pick a project`);
    // Keep existing items (always have text); drop only blank new ones.
    const finalCriteria = criteria
      .map((c) => ({ ...c, text: c.text.trim() }))
      .filter((c) => c.id != null || c.text);
    // A task needs at least one live (non-abandoned) success criterion.
    if (finalCriteria.every((c) => c.abandoned)) return setError(t`Add at least one success criterion`);
    // A blocked task must reference the task that blocks it.
    if (status === "blocked" && !blockedBy) return setError(t`Select the task that blocks this one`);
    setBusy(true);
    setError(null);
    const base = {
      title: title.trim(),
      description: description.trim(),
      tags: finalTags,
      assigneeId: assignee === NONE ? null : Number(assignee),
      dueDate: dueDate || null,
      status,
      blockedByTaskId: status === "blocked" ? Number(blockedBy) : null,
      blockedReason: status === "blocked" ? blockedReason.trim() : "",
    };
    try {
      let saved: Task;
      if (editing && task) {
        saved = (
          await api.updateTask(task.id, {
            ...base,
            criteria: finalCriteria.map((c) => ({ id: c.id, text: c.text, abandoned: c.abandoned })),
          })
        ).task;
      } else {
        saved = await api.createTask(targetProject, { ...base, criteria: finalCriteria.map((c) => c.text) });
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
              <Trans>Description</Trans> <span className="font-normal text-muted-foreground"><Trans>(optional)</Trans></span>
            </Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>
              <Trans>Success criteria</Trans>
            </Label>
            <div className="space-y-2">
              {criteria.map((c, i) =>
                c.id != null ? (
                  // Existing criterion: immutable text, can only be abandoned/restored.
                  <div key={c.id} className="flex items-center gap-2">
                    <Input
                      value={c.text}
                      disabled
                      className={c.abandoned ? "line-through text-muted-foreground" : "text-foreground"}
                    />
                    <button
                      type="button"
                      onClick={() => toggleAbandon(i)}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label={c.abandoned ? t`Restore criterion` : t`Abandon criterion`}
                      title={c.abandoned ? t`Restore criterion` : t`Abandon criterion`}
                    >
                      {c.abandoned ? <RotateCcw className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                    </button>
                  </div>
                ) : (
                  // New, unsaved criterion: editable and removable.
                  <div key={`new-${i}`} className="flex items-center gap-2">
                    <Input
                      value={c.text}
                      placeholder={t`e.g. Tiles grouted and sealed`}
                      onChange={(e) => setCriterionText(i, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (i === criteria.length - 1 && c.text.trim()) addCriterion();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => removeNewCriterion(i)}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label={t`Remove criterion`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )
              )}
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={addCriterion} className="px-2">
              <Plus className="h-4 w-4" />
              <Trans>Add criterion</Trans>
            </Button>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Criteria can't be edited once added — only abandoned. All remaining criteria must be checked before a
                task can be marked done.
              </Trans>
            </p>
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
                      className="inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-xs text-accent-foreground"
                    >
                      #{tg}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTag(tg);
                        }}
                        className="text-muted-foreground hover:text-foreground"
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
                  <ul className="absolute z-50 mt-1 max-h-44 w-full overflow-auto rounded-md border bg-popover py-1 text-sm shadow-md">
                    {tagMatches.map((tg, i) => (
                      <li key={tg}>
                        <button
                          type="button"
                          // Keep the input focused so its onBlur doesn't close the list before the click lands.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => addTag(tg)}
                          onMouseEnter={() => setTagHighlight(i)}
                          className={`flex w-full items-center px-2 py-1.5 text-left ${
                            i === tagHighlight ? "bg-muted" : ""
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
                            tagHighlight === tagMatches.length ? "bg-muted" : ""
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
              <p className="text-xs text-muted-foreground">
                <Trans>Pick an existing tag or type a new one and press Enter.</Trans>
              </p>
            </div>
            <div className="space-y-2">
              <Label>
                <Trans>Due date</Trans>
              </Label>
              <Popover open={dueOpen} onOpenChange={setDueOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn("w-full justify-start gap-2 font-normal", !dueDate && "text-muted-foreground")}
                  >
                    <CalendarIcon className="h-4 w-4" />
                    {dueDate ? formatShortDate(dueDate) : <Trans>Pick a date</Trans>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    locale={i18n.locale === "uk" ? uk : enUS}
                    selected={dueDate ? parse(dueDate, "yyyy-MM-dd", new Date()) : undefined}
                    onSelect={(d) => {
                      setDueDate(d ? format(d, "yyyy-MM-dd") : "");
                      setDueOpen(false);
                    }}
                    initialFocus
                  />
                  {dueDate && (
                    <div className="border-t p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          setDueDate("");
                          setDueOpen(false);
                        }}
                      >
                        <Trans>Clear date</Trans>
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
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

          {status === "blocked" && (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/40">
              <div className="space-y-2">
                <Label>
                  <Trans>Blocked by</Trans>
                </Label>
                <BlockedBySelect candidates={blockCandidates} value={blockedBy} onChange={setBlockedBy} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="blocked-reason">
                  <Trans>Reason</Trans>{" "}
                  <span className="font-normal text-muted-foreground">
                    <Trans>(optional)</Trans>
                  </span>
                </Label>
                <Textarea
                  id="blocked-reason"
                  value={blockedReason}
                  onChange={(e) => setBlockedReason(e.target.value)}
                />
              </div>
            </div>
          )}

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
