import { useEffect, useMemo, useState } from "react";
import { DragDropContext, Droppable, DropResult } from "@hello-pangea/dnd";
import { useTasks, useUpdateTask, useDeleteTask } from "@/hooks/use-tasks";
import { TaskCard } from "@/components/TaskCard";
import { TaskDialog } from "@/components/TaskDialog";
import { TaskDetailDialog } from "@/components/TaskDetailDialog";
import { type Task } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, RotateCcw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useUsers } from "@/hooks/use-users";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLocation } from "wouter";
import { useEnsureTaskGroup } from "@/hooks/use-chat";
import { isTaskOverdue, parseDateOnly } from "@/lib/utils";

const COLUMNS = [
  { id: "todo", title: "To Do", color: "bg-slate-500", panelClassName: "bg-muted/30" },
  { id: "in_progress", title: "In Progress", color: "bg-blue-500", panelClassName: "bg-muted/30" },
  { id: "done", title: "Done", color: "bg-green-500", panelClassName: "bg-muted/30" },
  { id: "trash", title: "Trash", color: "bg-rose-500", panelClassName: "bg-rose-50/70" },
];

function getAssignedToIds(task: Task): number[] {
  const rawAssignedToIds = (task as any).assignedToIds;
  let assignedToIds: number[] = [];
  if (Array.isArray(rawAssignedToIds)) assignedToIds = rawAssignedToIds.map((id: unknown) => Number(id)).filter((id) => Number.isFinite(id));
  else if (typeof rawAssignedToIds === "string") {
    try {
      const parsed = JSON.parse(rawAssignedToIds);
      if (Array.isArray(parsed)) assignedToIds = parsed.map((id: unknown) => Number(id)).filter((id) => Number.isFinite(id));
    } catch {
      assignedToIds = [];
    }
  }
  if (assignedToIds.length === 0 && task.assignedToId) assignedToIds = [task.assignedToId];
  return assignedToIds;
}

function getTaskNonAdminParticipantCount(task: Task, users: Array<{ id: number; role?: string | null }>): number {
  const participantIds = Array.from(
    new Set<number>(
      [task.createdById, ...getAssignedToIds(task)].filter(
        (id): id is number => typeof id === "number" && Number.isFinite(id),
      ),
    ),
  );
  const nonAdminUserIds = new Set(
    users
      .filter((member) => String(member.role || "").toLowerCase() !== "admin")
      .map((member) => member.id),
  );
  return participantIds.filter((id) => nonAdminUserIds.has(id)).length;
}

export default function BoardView() {
  const { data: tasks, isLoading } = useTasks({ includeTrashed: true });
  const { data: users } = useUsers();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const ensureTaskGroup = useEnsureTaskGroup();
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [ownershipFilter, setOwnershipFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [dueFilter, setDueFilter] = useState("all");
  const [taskActionTarget, setTaskActionTarget] = useState<{ id: number; title: string; mode: "trash" | "delete" } | null>(null);

  const onDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;

    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const taskId = parseInt(draggableId);
    const draggedTask = filteredTasks.find((task) => task.id === taskId);
    const canMoveDraggedTask = !!user?.id && !!draggedTask && (
      user.role === "admin" ||
      draggedTask.createdById === user.id ||
      getAssignedToIds(draggedTask).includes(user.id)
    );
    if (!canMoveDraggedTask) {
      toast({
        title: "Read-only task",
        description: "Only participants can move this task.",
        variant: "destructive",
      });
      return;
    }

    const newStatus = destination.droppableId;
    const isTrashTransition = source.droppableId === "trash" || newStatus === "trash";
    const canManageTrash = !!user?.id && !!draggedTask && (
      user.role === "admin" ||
      draggedTask.createdById === user.id
    );
    if (isTrashTransition && !canManageTrash) {
      toast({
        title: "Trash is restricted",
        description: "Only the task creator or admin can move tasks in or out of trash.",
        variant: "destructive",
      });
      return;
    }

    // Optimistic update handled by React Query invalidation
    updateTask.mutate({
      id: taskId,
      status: newStatus,
      completed: newStatus === "done",
    }, {
      onSuccess: () => {
        if (newStatus === "trash") {
          toast({ title: "Task moved to trash" });
        } else if (source.droppableId === "trash") {
          toast({ title: "Task restored" });
        }
      },
      onError: () => {
        toast({
          title: isTrashTransition ? "Failed to update trash" : "Failed to move task",
          variant: "destructive",
        });
      }
    });
  };

  const handleEdit = (task: Task) => {
    setEditingTask(task);
    setIsDialogOpen(true);
  };

  const handleDelete = (id: number) => {
    const task = filteredTasks.find((entry) => entry.id === id);
    setTaskActionTarget({ id, title: task?.title || "this task", mode: "trash" });
  };

  const handleRestore = (task: Task) => {
    updateTask.mutate(
      {
        id: task.id,
        status: "todo",
        completed: false,
      },
      {
        onSuccess: () => toast({ title: "Task restored to To Do" }),
        onError: () => {
          toast({
            title: "Restore failed",
            description: "The task could not be restored from trash.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handlePermanentDelete = (task: Task) => {
    setTaskActionTarget({ id: task.id, title: task.title || "this task", mode: "delete" });
  };

  const confirmTaskAction = () => {
    if (!taskActionTarget) return;

    if (taskActionTarget.mode === "trash") {
      updateTask.mutate(
        {
          id: taskActionTarget.id,
          status: "trash",
          completed: false,
        },
        {
          onSuccess: () => toast({ title: "Task moved to trash" }),
        },
      );
      setTaskActionTarget(null);
      return;
    }

    deleteTask.mutate(taskActionTarget.id, {
      onSuccess: () => toast({ title: "Task deleted permanently" }),
    });
    setTaskActionTarget(null);
  };

  const handleView = (task: Task) => {
    setSelectedTask(task);
    setIsDetailDialogOpen(true);
  };

  const handleMessage = async (task: Task) => {
    if (!user?.id) return;
    if (getTaskNonAdminParticipantCount(task, users || []) >= 2) {
      try {
        await ensureTaskGroup.mutateAsync(task.id);
      } catch (error) {
        toast({
          title: "Chat unavailable",
          description: error instanceof Error ? error.message : "Unable to create task group chat",
          variant: "destructive",
        });
        return;
      }
      setLocation(`/chat?taskId=${task.id}`);
      return;
    }

    const participantIds = Array.from(
      new Set<number>(
        [task.createdById, ...getAssignedToIds(task)].filter(
          (id): id is number => typeof id === "number" && Number.isFinite(id),
        ),
      ),
    );
    const otherParticipantIds = participantIds.filter((id) => id !== user.id);
    const creatorId = typeof task.createdById === "number" && Number.isFinite(task.createdById)
      ? task.createdById
      : undefined;
    const fallbackUserId = creatorId && creatorId !== user.id
      ? creatorId
      : otherParticipantIds[0];

    if (fallbackUserId) {
      setLocation(`/chat?userId=${fallbackUserId}`);
      return;
    }

    toast({
      title: "Chat unavailable",
      description: "No other task participant is available for chat yet.",
      variant: "destructive",
    });
  };

  const baseVisibleTasks = (tasks || []).filter((task) => {
    if (user?.role === "admin") return true;
    if (!user?.id) return false;
    if (task.createdById === user.id) return true;

    const assignedToIds = getAssignedToIds(task);
    return assignedToIds.includes(user.id);
  });

  const filteredTasks = useMemo(() => {
    return baseVisibleTasks.filter((task) => {
      const assignedToIds = getAssignedToIds(task);
      const normalizedSearch = searchQuery.trim().toLowerCase();
      const taskText = `${task.title} ${task.description || ""}`.toLowerCase();

      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const dueDate = parseDateOnly(task.dueDate as any);
      const hasDueDate = !!dueDate;
      const dueTime = hasDueDate ? dueDate.getTime() : null;
      const startOfTodayTime = startOfToday.getTime();
      const endOfTodayTime = endOfToday.getTime();

      if (normalizedSearch && !taskText.includes(normalizedSearch)) return false;
      if (priorityFilter !== "all" && task.priority !== priorityFilter) return false;

      if (ownershipFilter === "created_by_me") {
        if (!user?.id || task.createdById !== user.id) return false;
      }
      if (ownershipFilter === "assigned_to_me") {
        if (!user?.id || !assignedToIds.includes(user.id)) return false;
      }

      if (assigneeFilter === "me") {
        if (!user?.id || !assignedToIds.includes(user.id)) return false;
      } else if (assigneeFilter === "unassigned") {
        if (assignedToIds.length > 0) return false;
      } else if (assigneeFilter !== "all") {
        const selectedAssigneeId = Number(assigneeFilter);
        if (!Number.isFinite(selectedAssigneeId) || !assignedToIds.includes(selectedAssigneeId)) return false;
      }

      if (dueFilter === "overdue") {
        if (!isTaskOverdue(task.status, task.dueDate as any)) return false;
      } else if (dueFilter === "today") {
        if (!hasDueDate || dueTime === null || dueTime < startOfTodayTime || dueTime > endOfTodayTime) return false;
      } else if (dueFilter === "upcoming") {
        if (!hasDueDate || dueTime === null || dueTime <= endOfTodayTime) return false;
      } else if (dueFilter === "no_due") {
        if (hasDueDate) return false;
      }

      return true;
    });
  }, [assigneeFilter, baseVisibleTasks, dueFilter, ownershipFilter, priorityFilter, searchQuery, user?.id]);

  const visibleTasks = useMemo(
    () => filteredTasks.filter((task) => task.status !== "trash"),
    [filteredTasks],
  );

  const trashedTasks = useMemo(
    () => filteredTasks.filter((task) => task.status === "trash"),
    [filteredTasks],
  );

  const filterUserOptions = useMemo(() => {
    const visibleUserIds = new Set<number>();
    baseVisibleTasks.forEach((task) => {
      getAssignedToIds(task).forEach((id) => visibleUserIds.add(id));
    });
    return (users || []).filter((u) => visibleUserIds.has(u.id));
  }, [baseVisibleTasks, users]);

  useEffect(() => {
    const allowedAssigneeValues = new Set<string>(["all", "me", "unassigned"]);
    filterUserOptions.forEach((filterUser) => allowedAssigneeValues.add(String(filterUser.id)));
    if (!allowedAssigneeValues.has(assigneeFilter)) {
      setAssigneeFilter("all");
    }
  }, [assigneeFilter, filterUserOptions]);

  const resetFilters = () => {
    setSearchQuery("");
    setPriorityFilter("all");
    setOwnershipFilter("all");
    setAssigneeFilter("all");
    setDueFilter("all");
  };

  const tasksByStatus = [...visibleTasks, ...trashedTasks].reduce((acc, task) => {
    const status = task.status || "todo";
    if (!acc[status]) acc[status] = [];
    acc[status].push(task);
    return acc;
  }, {} as Record<string, Task[]>);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-full min-w-0 pb-4">
      <div className="mb-4 rounded-xl border border-border/60 bg-card p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title or description"
            className="xl:col-span-2"
          />

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">All priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <select
            value={ownershipFilter}
            onChange={(e) => setOwnershipFilter(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">All relations</option>
            <option value="created_by_me">Created by me</option>
            <option value="assigned_to_me">Assigned to me</option>
          </select>

          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">All assignees</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
            {filterUserOptions.map((filterUser) => (
              <option key={filterUser.id} value={String(filterUser.id)}>
                {filterUser.name}
              </option>
            ))}
          </select>

          <select
            value={dueFilter}
            onChange={(e) => setDueFilter(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">All due dates</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="upcoming">Upcoming</option>
            <option value="no_due">No due date</option>
          </select>
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {visibleTasks.length} active and {trashedTasks.length} trashed tasks out of {baseVisibleTasks.length}
          </p>
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-2">
            <RotateCcw className="h-3.5 w-3.5" />
            Reset filters
          </Button>
        </div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="overflow-x-hidden pb-2">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
            {COLUMNS.map((column) => (
              <div key={column.id} className="flex min-w-0 flex-col">
                <div className="mb-4 flex items-center justify-between px-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`h-2 w-2 shrink-0 rounded-full ${column.color}`} />
                    <h3 className="truncate text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      {column.title}
                    </h3>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {tasksByStatus[column.id]?.length || 0}
                    </span>
                  </div>
                </div>

                <div className={`min-h-[520px] rounded-xl border border-border/50 p-3 ${column.panelClassName}`}>
                  <Droppable droppableId={column.id}>
                    {(provided, snapshot) => (
                      <div
                        {...provided.droppableProps}
                        ref={provided.innerRef}
                        className={`h-full min-h-[490px] min-w-0 transition-colors ${snapshot.isDraggingOver ? "rounded-lg bg-muted/50" : ""}`}
                      >
                        {tasksByStatus[column.id]?.map((task: Task, index: number) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            index={index}
                            canEdit={!!user?.id && (
                              task.createdById === user.id ||
                              user.role === "admin"
                            )}
                            canMove={task.status === "trash"
                              ? !!user?.id && (task.createdById === user.id || user.role === "admin")
                              : !!user?.id && (
                                user.role === "admin" ||
                                task.createdById === user.id ||
                                getAssignedToIds(task).includes(user.id)
                              )}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            onRestore={handleRestore}
                            onPermanentDelete={handlePermanentDelete}
                            onView={handleView}
                            onMessage={(task) => {
                              void handleMessage(task);
                            }}
                          />
                        ))}
                        {provided.placeholder}

                        {!!user?.id && column.id !== "trash" && (
                          <button
                            onClick={() => {
                              setEditingTask(null);
                              setIsDialogOpen(true);
                            }}
                            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 py-2.5 text-sm text-muted-foreground transition-all hover:border-primary/50 hover:bg-background/80 hover:text-foreground"
                          >
                            <Plus className="h-4 w-4" />
                            Add Task
                          </button>
                        )}
                      </div>
                    )}
                  </Droppable>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DragDropContext>

      <TaskDialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) setEditingTask(null);
        }}
        task={editingTask || undefined}
      />

      <TaskDetailDialog
        open={isDetailDialogOpen}
        onOpenChange={(open) => {
          setIsDetailDialogOpen(open);
          if (!open) setSelectedTask(null);
        }}
        task={selectedTask}
        onEdit={(task) => {
          setSelectedTask(null);
          setIsDetailDialogOpen(false);
          handleEdit(task);
        }}
      />

      <Dialog open={taskActionTarget !== null} onOpenChange={(open) => (!open ? setTaskActionTarget(null) : undefined)}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-[420px] fixed !top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2">
          <DialogHeader>
            <DialogTitle>{taskActionTarget?.mode === "delete" ? "Delete Permanently" : "Move To Trash"}</DialogTitle>
            <DialogDescription>
              {taskActionTarget?.mode === "delete"
                ? `This will permanently remove ${taskActionTarget?.title || "this task"} and cannot be undone.`
                : `Move ${taskActionTarget?.title || "this task"} to trash? You can restore it later from the Trash column.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setTaskActionTarget(null)}>
              Cancel
            </Button>
            <Button
              variant={taskActionTarget?.mode === "delete" ? "destructive" : "default"}
              type="button"
              onClick={confirmTaskAction}
              disabled={deleteTask.isPending || updateTask.isPending}
            >
              {deleteTask.isPending || updateTask.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : taskActionTarget?.mode === "delete"
                  ? "Delete permanently"
                  : "Move to trash"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
