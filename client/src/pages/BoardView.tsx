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
import { useLocation } from "wouter";
import { useEnsureTaskGroup } from "@/hooks/use-chat";

const COLUMNS = [
  { id: "todo", title: "To Do", color: "bg-slate-500" },
  { id: "in_progress", title: "In Progress", color: "bg-blue-500" },
  { id: "done", title: "Done", color: "bg-green-500" },
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

export default function BoardView() {
  const { data: tasks, isLoading } = useTasks();
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

  const onDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;

    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const taskId = parseInt(draggableId);
    const draggedTask = visibleTasks.find((task) => task.id === taskId);
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

    // Optimistic update handled by React Query invalidation
    updateTask.mutate({
      id: taskId,
      status: newStatus
    }, {
      onError: () => {
        toast({
          title: "Failed to move task",
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
    if (confirm("Are you sure you want to delete this task?")) {
      deleteTask.mutate(id, {
        onSuccess: () => toast({ title: "Task deleted" }),
      });
    }
  };

  const handleView = (task: Task) => {
    const canEditTask = !!user?.id && task.createdById === user.id;
    if (!canEditTask) {
      setSelectedTask(task);
      setIsDetailDialogOpen(true);
    }
  };

  const handleMessage = async (task: Task) => {
    if (!user?.id) return;
    const participantIds = Array.from(
      new Set<number>(
        [task.createdById, ...getAssignedToIds(task)].filter(
          (id): id is number => typeof id === "number" && Number.isFinite(id)
        )
      )
    );
    const otherParticipantIds = participantIds.filter((id) => id !== user.id);

    if (otherParticipantIds.length === 1) {
      setLocation(`/chat?userId=${otherParticipantIds[0]}`);
      return;
    }

    if (otherParticipantIds.length > 1) {
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

    toast({
      title: "No participants",
      description: "This task has no other chat participants yet.",
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

  const visibleTasks = useMemo(() => {
    return baseVisibleTasks.filter((task) => {
      const assignedToIds = getAssignedToIds(task);
      const normalizedSearch = searchQuery.trim().toLowerCase();
      const taskText = `${task.title} ${task.description || ""}`.toLowerCase();

      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const dueDate = task.dueDate ? new Date(task.dueDate as any) : null;
      const hasDueDate = !!dueDate && !Number.isNaN(dueDate.getTime());
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
        if (!hasDueDate || dueTime === null || dueTime >= startOfTodayTime) return false;
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

  const tasksByStatus = visibleTasks.reduce((acc, task) => {
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
    <div className="h-full pb-4">
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
            className="h-10 rounded-md border border-input bg-background px-3 text-sm w-full"
          >
            <option value="all">All priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <select
            value={ownershipFilter}
            onChange={(e) => setOwnershipFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm w-full"
          >
            <option value="all">All relations</option>
            <option value="created_by_me">Created by me</option>
            <option value="assigned_to_me">Assigned to me</option>
          </select>

          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm w-full"
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
            className="h-10 rounded-md border border-input bg-background px-3 text-sm w-full"
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
            Showing {visibleTasks.length} of {baseVisibleTasks.length} tasks
          </p>
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-2">
            <RotateCcw className="h-3.5 w-3.5" />
            Reset filters
          </Button>
        </div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 h-full">
          {COLUMNS.map((column) => (
            <div key={column.id} className="flex-1 flex flex-col min-w-0 lg:min-w-[300px]">
              <div className="flex items-center justify-between mb-4 px-1">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${column.color}`} />
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
                    {column.title}
                  </h3>
                  <span className="bg-muted text-muted-foreground text-xs px-2 py-0.5 rounded-full font-medium">
                    {tasksByStatus[column.id]?.length || 0}
                  </span>
                </div>
              </div>

              <div className="flex-1 bg-muted/30 rounded-xl p-3 border border-border/50">
                <Droppable droppableId={column.id}>
                  {(provided, snapshot) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className={`h-full transition-colors ${snapshot.isDraggingOver ? "bg-muted/50 rounded-lg" : ""}`}
                    >
                      {tasksByStatus[column.id]?.map((task, index) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          index={index}
                          canEdit={!!user?.id && task.createdById === user.id}
                          canMove={!!user?.id && (
                            user.role === "admin" ||
                            task.createdById === user.id ||
                            getAssignedToIds(task).includes(user.id)
                          )}
                          onEdit={handleEdit}
                          onDelete={handleDelete}
                          onView={handleView}
                          onMessage={(task) => {
                            void handleMessage(task);
                          }}
                        />
                      ))}
                      {provided.placeholder}

                      {!!user?.id && (
                        <button
                          onClick={() => {
                            setEditingTask(null);
                            setIsDialogOpen(true);
                          }}
                          className="w-full py-2.5 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:bg-background/80 hover:text-foreground rounded-lg border border-dashed border-border/60 hover:border-primary/50 transition-all mt-2"
                        >
                          <Plus className="w-4 h-4" />
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
      />
    </div>
  );
}
