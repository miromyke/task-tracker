import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CalendarClock } from "lucide-react";
import type { Status, Task, User } from "@/lib/api";
import { STATUSES } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/UserAvatar";
import { formatShortDate, isPast } from "@/lib/format";
import { cn } from "@/lib/utils";

interface BoardProps {
  tasks: Task[];
  usersById: Map<number, User>;
  onCardClick: (id: number) => void;
  onMove: (task: Task, to: Status) => void;
}

function TaskCardBody({ task, usersById }: { task: Task; usersById: Map<number, User> }) {
  const assignee = task.assigneeId ? usersById.get(task.assigneeId) : undefined;
  const overdue = task.dueDate && isPast(task.dueDate) && task.status !== "done" && task.status !== "abandoned";
  return (
    <div className="rounded-md border bg-card p-3 shadow-sm">
      <div className="mb-2 text-sm font-medium leading-snug">{task.title}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-transparent bg-secondary text-secondary-foreground">#{task.tag}</Badge>
        {task.dueDate && (
          <span className={cn("inline-flex items-center gap-1 text-xs", overdue ? "text-destructive" : "text-muted-foreground")}>
            <CalendarClock className="h-3.5 w-3.5" />
            {formatShortDate(task.dueDate)}
          </span>
        )}
        {assignee && (
          <div className="ml-auto">
            <UserAvatar name={assignee.name} avatarPath={assignee.avatarPath} className="h-6 w-6 text-[10px]" />
          </div>
        )}
      </div>
    </div>
  );
}

function DraggableCard({
  task,
  usersById,
  onClick,
}: {
  task: Task;
  usersById: Map<number, User>;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={cn("cursor-grab touch-none active:cursor-grabbing", isDragging && "opacity-40")}
    >
      <TaskCardBody task={task} usersById={usersById} />
    </div>
  );
}

function Column({
  status,
  label,
  tasks,
  usersById,
  onCardClick,
}: {
  status: Status;
  label: string;
  tasks: Task[];
  usersById: Map<number, User>;
  onCardClick: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="text-sm font-semibold">{label}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2 rounded-lg border border-dashed p-2 transition-colors",
          isOver ? "border-primary bg-accent" : "border-border bg-muted/40"
        )}
      >
        {tasks.map((t) => (
          <DraggableCard key={t.id} task={t} usersById={usersById} onClick={() => onCardClick(t.id)} />
        ))}
        {tasks.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">No tasks</p>}
      </div>
    </div>
  );
}

export function KanbanBoard({ tasks, usersById, onCardClick, onMove }: BoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } })
  );

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
      <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
        {STATUSES.map((s) => (
          <Column
            key={s.key}
            status={s.key}
            label={s.label}
            tasks={tasks.filter((t) => t.status === s.key)}
            usersById={usersById}
            onCardClick={onCardClick}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? (
          <div className="w-72 rotate-1">
            <TaskCardBody task={activeTask} usersById={usersById} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
