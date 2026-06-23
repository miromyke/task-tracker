import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Archive, Ban, CalendarClock, CheckCircle2, ListChecks, RotateCcw } from "lucide-react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { Status, Task, User } from "@/lib/api";
import { STATUS_DOT, STATUS_LABEL, STATUS_ORDER } from "@/lib/constants";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserAvatar } from "@/components/UserAvatar";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { daysOverdue, formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface BoardProps {
  tasks: Task[];
  usersById: Map<number, User>;
  taskTitleById: Map<number, string>;
  onCardClick: (id: number) => void;
  onMove: (task: Task, to: Status) => void;
}

function CardBody({
  task,
  usersById,
  taskTitleById,
}: {
  task: Task;
  usersById: Map<number, User>;
  taskTitleById: Map<number, string>;
}) {
  const { t } = useLingui();
  const assignee = task.assigneeId ? usersById.get(task.assigneeId) : undefined;
  const blockerTitle = task.blockedByTaskId ? taskTitleById.get(task.blockedByTaskId) : undefined;
  const done = task.status === "done";
  const closed = done || task.status === "abandoned";
  const overdueDays = task.dueDate ? daysOverdue(task.dueDate) : 0;
  // Open + overdue is urgent (red); closed (done/abandoned) + overdue is just
  // historical (neutral); done + met the due date is a win (green).
  const openOverdue = overdueDays > 0 && !closed;
  const closedOverdue = overdueDays > 0 && closed;
  const doneOnTime = done && !!task.dueDate && overdueDays === 0;
  const criteria = (task.criteria ?? []).filter((c) => !c.abandoned);
  const criteriaDone = criteria.filter((c) => c.done).length;
  const criteriaAllDone = criteria.length > 0 && criteriaDone === criteria.length;
  return (
    <>
      <div className="mb-2 text-sm font-medium leading-snug">{task.title}</div>
      {task.status === "blocked" && blockerTitle && (
        <div className="mb-2 inline-flex max-w-full items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <Ban className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            <Trans>Blocked by {blockerTitle}</Trans>
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {task.archived && (
          <span className="inline-flex items-center gap-1 rounded-md border border-muted-foreground/30 bg-background px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
            <Archive className="h-3.5 w-3.5" />
            <Trans>Archived</Trans>
          </span>
        )}
        {task.dueDate &&
          (openOverdue || closedOverdue ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs",
                closedOverdue
                  ? "bg-accent text-accent-foreground"
                  : overdueDays > 7
                    ? "bg-red-600 text-white"
                    : "bg-red-200 text-red-900"
              )}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              <Plural value={overdueDays} one="Overdue by # day" other="Overdue by # days" />
            </span>
          ) : doneOnTime ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-green-100 px-1.5 py-0.5 text-xs text-green-800">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <Trans>Completed on time</Trans>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              {formatShortDate(task.dueDate)}
            </span>
          ))}
        {criteria.length > 0 && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs",
              criteriaAllDone ? "bg-green-100 text-green-800" : "bg-muted text-muted-foreground"
            )}
            title={t`Success criteria`}
          >
            <ListChecks className="h-3.5 w-3.5" />
            {criteriaDone}/{criteria.length}
          </span>
        )}
        {task.postponeCount > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800"
            title={t`Due date pushed back`}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <Trans>Postponed</Trans>
            {task.postponeCount > 1 && <span className="font-semibold">×{task.postponeCount}</span>}
          </span>
        )}
        {assignee && (
          <div className="ml-auto">
            <UserAvatar
              name={assignee.name}
              firstName={assignee.firstName}
              surname={assignee.surname}
              avatarPath={assignee.avatarPath}
              className="h-6 w-6 text-[10px]"
            />
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- Desktop: 4 columns, drag to move ---------- */

function DraggableCard({
  task,
  usersById,
  taskTitleById,
  onClick,
}: {
  task: Task;
  usersById: Map<number, User>;
  taskTitleById: Map<number, string>;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={cn(
        "cursor-grab touch-none rounded-lg border bg-card p-4 shadow-sm active:cursor-grabbing",
        task.archived && "border-dashed border-muted-foreground/40 bg-muted/40 opacity-70",
        isDragging && "opacity-40"
      )}
    >
      <CardBody task={task} usersById={usersById} taskTitleById={taskTitleById} />
    </div>
  );
}

function Column({
  status,
  tasks,
  usersById,
  taskTitleById,
  onCardClick,
}: {
  status: Status;
  tasks: Task[];
  usersById: Map<number, User>;
  taskTitleById: Map<number, string>;
  onCardClick: (id: number) => void;
}) {
  const { i18n } = useLingui();
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-3 flex items-center gap-2 px-1">
        <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[status])} />
        <span className="text-sm font-semibold">{i18n._(STATUS_LABEL[status])}</span>
        <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-32 flex-1 flex-col gap-3 rounded-xl border border-dashed p-3 transition-colors",
          isOver ? "border-foreground bg-accent" : "border-border bg-muted/40"
        )}
      >
        {tasks.map((t) => (
          <DraggableCard
            key={t.id}
            task={t}
            usersById={usersById}
            taskTitleById={taskTitleById}
            onClick={() => onCardClick(t.id)}
          />
        ))}
        {tasks.length === 0 && (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            <Trans>No tasks</Trans>
          </p>
        )}
      </div>
    </div>
  );
}

function DesktopBoard({ tasks, usersById, taskTitleById, onCardClick, onMove }: BoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragStart(e: DragStartEvent) {
    setActiveTask(tasks.find((t) => t.id === e.active.id) ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveTask(null);
    const to = e.over?.id as Status | undefined;
    if (!to) return;
    const task = tasks.find((t) => t.id === e.active.id);
    if (task && task.status !== to) onMove(task, to);
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveTask(null)}>
      <div className="grid grid-cols-5 gap-4 xl:gap-5">
        {STATUS_ORDER.map((s) => (
          <Column
            key={s}
            status={s}
            tasks={tasks.filter((t) => t.status === s)}
            usersById={usersById}
            taskTitleById={taskTitleById}
            onCardClick={onCardClick}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? (
          <div className="w-64 rotate-1 rounded-lg border bg-card p-3 shadow-md">
            <CardBody task={activeTask} usersById={usersById} taskTitleById={taskTitleById} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/* ---------- Mobile: same columns as desktop, horizontally scrollable ---------- */
/* Tap-to-move (the per-card "Move:" select) replaces drag here — dragging would
   fight the horizontal scroll. */

function MobileColumnCard({
  task,
  usersById,
  taskTitleById,
  onCardClick,
  onMove,
}: {
  task: Task;
  usersById: Map<number, User>;
  taskTitleById: Map<number, string>;
  onCardClick: (id: number) => void;
  onMove: (task: Task, to: Status) => void;
}) {
  const { i18n } = useLingui();
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3 shadow-sm",
        task.archived && "border-dashed border-muted-foreground/40 bg-muted/40 opacity-70"
      )}
    >
      <div onClick={() => onCardClick(task.id)}>
        <CardBody task={task} usersById={usersById} taskTitleById={taskTitleById} />
      </div>
      <div className="mt-2 flex items-center justify-end border-t pt-2">
        <Select value={task.status} onValueChange={(v) => onMove(task, v as Status)}>
          <SelectTrigger className="h-7 w-auto gap-1 border-none px-2 text-xs text-muted-foreground shadow-none">
            <span className="text-muted-foreground">
              <Trans>Move:</Trans>
            </span>
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
  );
}

function MobileBoard({ tasks, usersById, taskTitleById, onCardClick, onMove }: BoardProps) {
  const { i18n } = useLingui();
  return (
    <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2">
      {STATUS_ORDER.map((s) => {
        const colTasks = tasks.filter((t) => t.status === s);
        return (
          <div key={s} className="flex w-[78vw] max-w-xs shrink-0 snap-start flex-col">
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[s])} />
              <span className="text-sm font-semibold">{i18n._(STATUS_LABEL[s])}</span>
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground">{colTasks.length}</span>
            </div>
            <div className="flex min-h-24 flex-1 flex-col gap-2 rounded-xl border border-dashed border-border bg-muted/40 p-2">
              {colTasks.length === 0 ? (
                <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                  <Trans>No tasks</Trans>
                </p>
              ) : (
                colTasks.map((t) => (
                  <MobileColumnCard
                    key={t.id}
                    task={t}
                    usersById={usersById}
                    taskTitleById={taskTitleById}
                    onCardClick={onCardClick}
                    onMove={onMove}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function KanbanBoard(props: BoardProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  return isDesktop ? <DesktopBoard {...props} /> : <MobileBoard {...props} />;
}
