import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Archive, ArchiveRestore, CalendarDays, FolderKanban, Images, Loader2, Plus, X } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { api, criteriaMet, type Project, type Pulse, type Status, type Task, type User } from "@/lib/api";
import { PulseCard } from "@/components/PulseCard";
import { KanbanBoard } from "@/components/KanbanBoard";
import { BlockTaskDialog } from "@/components/BlockTaskDialog";
import { CalendarView } from "@/components/CalendarView";
import { FilesView } from "@/components/FilesView";
import { TaskFormDialog } from "@/components/TaskFormDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const ALL = "__all__";

function CreateProjectDialog({ onCreated }: { onCreated: (p: Project) => void }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const p = await api.createProject(name.trim(), description.trim());
      onCreated(p);
      setName("");
      setDescription("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="rounded-full">
          <Plus className="h-4 w-4" />
          <Trans>New</Trans>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>New project</Trans>
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pname">
              <Trans>Name</Trans>
            </Label>
            <Input id="pname" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t`e.g. Kitchen Remodel`} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pdesc">
              <Trans>Description</Trans>
            </Label>
            <Textarea id="pdesc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              <Trans>Create</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProjectTile({
  label,
  count,
  active,
  archived,
  onClick,
}: {
  label: React.ReactNode;
  count: number;
  active: boolean;
  archived?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors lg:w-full",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:border-border hover:bg-muted",
        archived && !active && "opacity-60"
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 truncate font-medium">
        {archived && <Archive className="h-3.5 w-3.5 shrink-0 opacity-70" />}
        <span className="truncate">{label}</span>
      </span>
      <span className={cn("text-xs tabular-nums", active ? "text-white/60" : "text-muted-foreground")}>{count}</span>
    </button>
  );
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const { t } = useLingui();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("project") ? Number(searchParams.get("project")) : null;

  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [tag, setTag] = useState<string>(ALL);
  const [view, setView] = useState<"board" | "calendar" | "files">("board");
  const [moveError, setMoveError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [blockTask, setBlockTask] = useState<Task | null>(null);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);

  async function loadBase() {
    const [p, t, u, g] = await Promise.all([
      api.listProjects(showArchived),
      api.listAllTasks({ includeArchived: showArchived }),
      api.listUsers(),
      api.listTags(),
    ]);
    setProjects(p);
    setTasks(t);
    setUsers(u);
    setTags(g);
  }

  // The selected project filters the board and pulse; null => all projects.
  const selectedProject = useMemo(
    () => (selectedId ? projects.find((p) => p.id === selectedId) ?? null : null),
    [projects, selectedId]
  );

  useEffect(() => {
    setLoading(true);
    loadBase().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  // Pulse is scoped server-side, so refetch whenever the selection changes.
  useEffect(() => {
    api.getPulse(selectedId ?? undefined).then(setPulse);
  }, [selectedId]);

  function select(id: number | null) {
    setSearchParams(id ? { project: String(id) } : {}, { replace: true });
  }

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  // Title lookup over all loaded tasks so blocked cards can name their blocker
  // even when the tag filter hides it from the board.
  const taskTitleById = useMemo(() => new Map(tasks.map((t) => [t.id, t.title])), [tasks]);
  const visibleTasks = useMemo(
    () =>
      tasks.filter(
        (t) => (!selectedId || t.projectId === selectedId) && (tag === ALL || t.tags.includes(tag))
      ),
    [tasks, selectedId, tag]
  );

  async function onMove(task: Task, to: Status) {
    if (task.status === to) return;
    // Guard the done-gate up front so the card never visibly jumps and snaps back.
    if (to === "done" && !criteriaMet(task)) {
      setMoveError(t`"${task.title}" still has unchecked success criteria — open it to finish them first.`);
      return;
    }
    // Blocking needs a required reference (and optional reason): collect it first
    // rather than moving the card optimistically.
    if (to === "blocked") {
      setMoveError(null);
      setBlockTask(task);
      return;
    }
    setMoveError(null);
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: to } : t)));
    try {
      await api.updateTask(task.id, { status: to });
      api.getPulse(selectedId ?? undefined).then(setPulse);
    } catch {
      loadBase();
    }
  }

  // Apply a block once the dialog has gathered the blocking task + reason.
  async function applyBlock(blockedByTaskId: number, reason: string) {
    if (!blockTask) return;
    const res = await api.updateTask(blockTask.id, { status: "blocked", blockedByTaskId, blockedReason: reason });
    setTasks((prev) => prev.map((t) => (t.id === res.task.id ? res.task : t)));
    api.getPulse(selectedId ?? undefined).then(setPulse);
  }

  // Archive / unarchive the selected project. When archiving while archived items
  // are hidden, the project drops out of the list, so deselect it.
  async function setProjectArchived(archived: boolean) {
    if (!selectedProject) return;
    await api.setProjectArchived(selectedProject.id, archived);
    if (archived && !showArchived) select(null);
    await loadBase();
  }

  // Archiving a project hides it (and its tasks) from the default view, so guard
  // it behind a confirm dialog. Unarchiving is the safe direction and stays direct.
  function onArchiveProjectClick() {
    if (!selectedProject) return;
    if (selectedProject.archived) setProjectArchived(false);
    else setArchiveConfirmOpen(true);
  }

  // The view switch (Tasks/Calendar/Files): shown in a desktop top strip over the
  // content column, or inline in the mobile header.
  const viewTabs = (
    <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
      <TabsList>
        {(
          [
            { key: "board", icon: FolderKanban, label: <Trans>Tasks</Trans> },
            { key: "calendar", icon: CalendarDays, label: <Trans>Calendar</Trans> },
            { key: "files", icon: Images, label: <Trans>Files</Trans> },
          ] as const
        ).map(({ key, icon: Icon, label }) => (
          <TabsTrigger key={key} value={key} className="gap-1.5">
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );

  // Heading reflects the active tab and whether a project is selected.
  const heading = selectedProject ? (
    view === "calendar" ? (
      <Trans>Events for {selectedProject.name}</Trans>
    ) : view === "files" ? (
      <Trans>Files for {selectedProject.name}</Trans>
    ) : (
      <Trans>Tasks for {selectedProject.name}</Trans>
    )
  ) : view === "calendar" ? (
    <Trans>All events</Trans>
  ) : view === "files" ? (
    <Trans>All files</Trans>
  ) : (
    <Trans>All tasks</Trans>
  );

  return (
    <div className="flex flex-col gap-10 pt-1">
      {/* Desktop: tabs in a top strip aligned over the content column. */}
      <div className="hidden lg:flex lg:flex-row lg:gap-12">
        <div className="lg:w-56 lg:shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">{viewTabs}</div>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:gap-12">
        {/* Projects stack */}
        <aside className="lg:w-56 lg:shrink-0">
        <div className="mb-2 flex items-center justify-between gap-2 lg:mb-5">
          <h1 className="text-lg font-bold tracking-tight">
            <Trans>Projects</Trans>
          </h1>
          <CreateProjectDialog
            onCreated={(p) => {
              setProjects((prev) => [p, ...prev]);
              select(p.id);
            }}
          />
        </div>
        {/* Mobile: a compact dropdown; desktop keeps the tile list below. */}
        <div className="lg:hidden">
          <Select
            value={selectedId ? String(selectedId) : ALL}
            onValueChange={(v) => select(v === ALL ? null : Number(v))}
          >
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                <Trans>All projects</Trans>
              </SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="hidden lg:flex lg:flex-col lg:gap-3">
          <ProjectTile
            label={<Trans>All</Trans>}
            count={tasks.length}
            active={selectedId === null}
            onClick={() => select(null)}
          />
          {projects.map((p) => (
            <ProjectTile
              key={p.id}
              label={p.name}
              count={p.taskCount}
              active={selectedId === p.id}
              archived={p.archived}
              onClick={() => select(p.id)}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Archive className="h-3.5 w-3.5" />
          {showArchived ? <Trans>Hide archived</Trans> : <Trans>Show archived</Trans>}
        </button>

        {view !== "files" && (
          <div className="mt-4 lg:mt-6">
            <h2 className="mb-2 text-lg font-bold tracking-tight lg:mb-5">
              <Trans>Tags</Trans>
            </h2>
            <Select value={tag} onValueChange={setTag}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>
                  <Trans>All tags</Trans>
                </SelectItem>
                {tags.map((t) => (
                  <SelectItem key={t} value={t}>
                    #{t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </aside>

      {/* Main content: board or calendar, scoped to the selection */}
      <div className="min-w-0 flex-1 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-2xl font-bold tracking-tight">{heading}</h2>
            {selectedProject?.description && (
              <p className="mt-1 text-sm text-muted-foreground">{selectedProject.description}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Tasks / Calendar / Files — desktop shows these in the top strip above. */}
            <div className="lg:hidden">{viewTabs}</div>
            {selectedProject && (
              <Button variant="outline" onClick={onArchiveProjectClick}>
                {selectedProject.archived ? (
                  <>
                    <ArchiveRestore className="h-4 w-4" />
                    <Trans>Unarchive this project</Trans>
                  </>
                ) : (
                  <>
                    <Archive className="h-4 w-4" />
                    <Trans>Archive this project</Trans>
                  </>
                )}
              </Button>
            )}
            {view === "board" && (
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">
                  <Trans>Add task</Trans>
                </span>
              </Button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : view === "calendar" ? (
          <CalendarView projectId={selectedId ?? undefined} tag={tag === ALL ? undefined : tag} />
        ) : view === "files" ? (
          <FilesView projectId={selectedId ?? undefined} projects={projects} usersById={usersById} />
        ) : (
          <>
            {moveError && (
              <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                <span>{moveError}</span>
                <button
                  type="button"
                  onClick={() => setMoveError(null)}
                  className="shrink-0 text-amber-500 hover:text-amber-900 dark:hover:text-amber-200"
                  aria-label={t`Dismiss`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            {pulse && <PulseCard pulse={pulse} projectId={selectedId ?? undefined} />}
            <KanbanBoard
              tasks={visibleTasks}
              usersById={usersById}
              taskTitleById={taskTitleById}
              onCardClick={(taskId) => navigate(`/tasks/${taskId}`)}
              onMove={onMove}
            />
          </>
        )}
      </div>
      </div>

      <TaskFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        projectId={selectedId ?? undefined}
        projects={projects}
        users={users}
        tags={tags}
        onSaved={() => loadBase()}
      />

      <BlockTaskDialog
        open={!!blockTask}
        onOpenChange={(o) => !o && setBlockTask(null)}
        projectId={blockTask?.projectId}
        currentTaskId={blockTask?.id}
        onConfirm={applyBlock}
      />

      <ConfirmDialog
        open={archiveConfirmOpen}
        onOpenChange={setArchiveConfirmOpen}
        title={<Trans>Archive this project?</Trans>}
        description={
          <Trans>
            The project and its tasks will be hidden from the default view. You can unarchive it later with “Show
            archived”.
          </Trans>
        }
        confirmLabel={<Trans>Archive project</Trans>}
        onConfirm={() => setProjectArchived(true)}
      />
    </div>
  );
}
