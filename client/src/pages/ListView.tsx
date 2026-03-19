import { useEffect, useMemo, useState } from "react";
import { DragDropContext, Droppable, Draggable, type DropResult, type DroppableProps } from "@hello-pangea/dnd";
import { useTasks, useDeleteTask, useUpdateTask } from "@/hooks/use-tasks";
import { useUsers } from "@/hooks/use-users";
import { TaskDialog } from "@/components/TaskDialog";
import { type Task } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Pencil, RotateCcw, Trash2, CalendarDays, GripVertical, User as UserIcon } from "lucide-react";
import { formatShortDate, formatTaskDescription, parseDateOnly } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/use-auth";

function getAssignedToIds(task: Task): number[] {
  const rawAssignedToIds = (task as any).assignedToIds;
  let assignedToIds: number[] = [];
  if (Array.isArray(rawAssignedToIds)) {
    assignedToIds = rawAssignedToIds.map((id: unknown) => Number(id)).filter((id) => Number.isFinite(id));
  } else if (typeof rawAssignedToIds === "string") {
    try {
      const parsed = JSON.parse(rawAssignedToIds);
      if (Array.isArray(parsed)) {
        assignedToIds = parsed.map((id: unknown) => Number(id)).filter((id) => Number.isFinite(id));
      }
    } catch {
      assignedToIds = [];
    }
  }
  if (assignedToIds.length === 0 && task.assignedToId) assignedToIds = [task.assignedToId];
  return assignedToIds;
}

const StrictModeDroppable = ({ children, ...props }: DroppableProps) => {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const animation = requestAnimationFrame(() => setEnabled(true));
    return () => {
      cancelAnimationFrame(animation);
      setEnabled(false);
    };
  }, []);

  if (!enabled) return null;

  return <Droppable {...props}>{children}</Droppable>;
};

const moveItemInOrder = (
  order: number[],
  startIndex: number,
  endIndex: number,
) => {
  const next = [...order];
  const [removed] = next.splice(startIndex, 1);
  next.splice(endIndex, 0, removed);
  return next;
};

const areNumberArraysEqual = (a: number[], b: number[]) => (
  a.length === b.length && a.every((value, index) => value === b[index])
);

const getParentTaskId = (task: Task | null | undefined) => {
  const rawParentId = (task as any)?.parentTaskId;
  return typeof rawParentId === "number" && Number.isFinite(rawParentId) ? rawParentId : null;
};

const moveTaskAfterTarget = (order: number[], taskId: number, targetId: number) => {
  const next = order.filter((id) => id !== taskId);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex === -1) return [...next, taskId];
  next.splice(targetIndex + 1, 0, taskId);
  return next;
};

export default function ListView() {
  const { data: tasks, isLoading } = useTasks();
  const { data: users } = useUsers();
  const { user } = useAuth();
  const deleteTask = useDeleteTask();
  const updateTask = useUpdateTask();
  const { toast } = useToast();

  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [ownershipFilter, setOwnershipFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [dueFilter, setDueFilter] = useState("all");
  const [taskOrder, setTaskOrder] = useState<number[]>([]);

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this task?")) {
      deleteTask.mutate(id, {
        onSuccess: () => toast({ title: "Task deleted" }),
      });
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'text-orange-600 bg-orange-50 border-orange-100';
      case 'medium': return 'text-blue-600 bg-blue-50 border-blue-100';
      case 'low': return 'text-slate-600 bg-slate-50 border-slate-100';
      default: return 'text-muted-foreground bg-muted';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'done': return 'text-green-600 bg-green-50 border-green-100';
      case 'in_progress': return 'text-blue-600 bg-blue-50 border-blue-100';
      default: return 'text-slate-600 bg-slate-50 border-slate-100';
    }
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
      const taskPriority = typeof task.priority === "string" && task.priority.length > 0 ? task.priority : "medium";

      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const dueDate = parseDateOnly(task.dueDate as any);
      const hasDueDate = !!dueDate;
      const dueTime = hasDueDate ? dueDate.getTime() : null;
      const startOfTodayTime = startOfToday.getTime();
      const endOfTodayTime = endOfToday.getTime();

      if (normalizedSearch && !taskText.includes(normalizedSearch)) return false;
      if (priorityFilter !== "all" && taskPriority !== priorityFilter) return false;

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

  useEffect(() => {
    const visibleIds = visibleTasks.map((task) => task.id);
    setTaskOrder((prev) => {
      const prevVisibleIds = prev.filter((id) => visibleIds.includes(id));
      const missingIds = visibleIds.filter((id) => !prevVisibleIds.includes(id));
      const next = [...prevVisibleIds, ...missingIds];
      return areNumberArraysEqual(prev, next) ? prev : next;
    });
  }, [visibleTasks]);

  const resetFilters = () => {
    setSearchQuery("");
    setPriorityFilter("all");
    setOwnershipFilter("all");
    setAssigneeFilter("all");
    setDueFilter("all");
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const taskMap = new Map(visibleTasks.map((task) => [task.id, task]));
  const taskOrderIndex = new Map(taskOrder.map((id, index) => [id, index]));
  const childrenByParent = new Map<number | null, Task[]>();
  visibleTasks.forEach((task) => {
    const rawParentId = (task as any).parentTaskId;
    const parentId = typeof rawParentId === "number" && Number.isFinite(rawParentId) ? rawParentId : null;
    const normalizedParentId = parentId && taskMap.has(parentId) ? parentId : null;
    const list = childrenByParent.get(normalizedParentId) || [];
    list.push(task);
    childrenByParent.set(normalizedParentId, list);
  });
  childrenByParent.forEach((list) => {
    list.sort((a, b) => {
      const aIndex = taskOrderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = taskOrderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
  });

  const rootTasks = childrenByParent.get(null) || [];

  const isDescendant = (ancestorId: number, maybeDescendantId: number) => {
    const stack = [...(childrenByParent.get(ancestorId) || [])];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      if (current.id === maybeDescendantId) return true;
      const next = childrenByParent.get(current.id) || [];
      stack.push(...next);
    }
    return false;
  };

  const getDescendants = (ancestorId: number) => {
    const descendants: Task[] = [];
    const stack = [...(childrenByParent.get(ancestorId) || [])];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      descendants.push(current);
      const next = childrenByParent.get(current.id) || [];
      stack.push(...next);
    }
    return descendants;
  };

  const toggleCollapse = (taskId: number) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const orderedRows: Array<{ task: Task; depth: number }> = [];
  const buildRows = (task: Task, depth: number) => {
    orderedRows.push({ task, depth });
    if (collapsedIds.has(task.id)) return;
    const children = childrenByParent.get(task.id) || [];
    children.forEach((child) => buildRows(child, depth + 1));
  };
  rootTasks.forEach((task) => buildRows(task, 0));

  const onDragStart = () => {
    setIsDragging(true);
  };

  const onDragEnd = (result: DropResult) => {
    setIsDragging(false);

    const { destination, combine, draggableId, source } = result;
    if (!destination && !combine) return;

    const taskId = Number(draggableId.replace("task-", ""));
    if (!Number.isFinite(taskId)) return;

    let nextParentId: number | null = null;
    let nextOrder = taskOrder;

    if (combine) {
      const combineTaskId = Number(combine.draggableId.replace("task-", ""));
      if (!Number.isFinite(combineTaskId)) return;
      nextParentId = combineTaskId;
      nextOrder = moveTaskAfterTarget(taskOrder, taskId, combineTaskId);
    } else {
      if (!destination) return;
      nextOrder = moveItemInOrder(taskOrder, source.index, destination.index);

      if (destination.droppableId.startsWith("root-")) {
        nextParentId = null;
      } else {
        const reorderedRows = nextOrder
          .map((id) => taskMap.get(id))
          .filter((task): task is Task => !!task);
        const targetTask = reorderedRows[destination.index];
        const targetParentId = typeof (targetTask as any)?.parentTaskId === "number"
          ? (targetTask as any).parentTaskId
          : null;
        nextParentId = targetParentId;
      }
    }

    if (nextParentId === taskId) return;
    if (nextParentId !== null && !Number.isFinite(nextParentId)) return;
    if (nextParentId !== null && isDescendant(taskId, nextParentId)) {
      toast({
        title: "Invalid move",
        description: "You cannot move a task into its own sub-task.",
        variant: "destructive",
      });
      return;
    }

    const draggedTask = taskMap.get(taskId);
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

    const currentParentId = typeof (draggedTask as any)?.parentTaskId === "number"
      ? (draggedTask as any).parentTaskId
      : null;

    setTaskOrder(nextOrder);

    if (
      currentParentId === nextParentId &&
      (!destination || (source.droppableId === destination.droppableId && source.index === destination.index))
    ) return;

    const nextParentByTaskId = new Map<number, number | null>();
    visibleTasks.forEach((task) => {
      nextParentByTaskId.set(task.id, getParentTaskId(task));
    });
    nextParentByTaskId.set(taskId, nextParentId);

    const changedParentIds = Array.from(new Set([currentParentId, nextParentId]));
    const updatesToPersist = new Map<number, { id: number; parentTaskId?: number | null; sortOrder?: number }>();

    changedParentIds.forEach((parentId) => {
      const siblingIds = nextOrder.filter((id) => nextParentByTaskId.get(id) === parentId);
      siblingIds.forEach((siblingId, index) => {
        const existingTask = taskMap.get(siblingId);
        if (!existingTask) return;
        const desiredSortOrder = (index + 1) * 1024;
        const existingSortOrder = typeof (existingTask as any).sortOrder === "number"
          ? (existingTask as any).sortOrder
          : 0;
        const existingParentId = getParentTaskId(existingTask);

        if (existingSortOrder !== desiredSortOrder || existingParentId !== parentId) {
          const prev = updatesToPersist.get(siblingId) || { id: siblingId };
          updatesToPersist.set(siblingId, {
            ...prev,
            parentTaskId: parentId,
            sortOrder: desiredSortOrder,
          });
        }
      });
    });

    if (updatesToPersist.size === 0) return;

    updatesToPersist.forEach((payload) => {
      updateTask.mutate(payload);
    });

    if (nextParentId === null) {
      const descendants = getDescendants(taskId);
      descendants.forEach((child) => {
        updateTask.mutate({
          id: child.id,
          parentTaskId: null,
        });
      });
    }
  };

  const renderRowContent = (
    task: Task,
    depth: number,
    assignedUsers: Array<{ id: number; name: string }>,
    hasChildren: boolean,
    isCollapsed: boolean,
    statusLabel: string,
    priorityLabel: string,
    canEdit: boolean,
  ) => (
    <>
      <div className="flex items-start gap-2 min-w-0" style={{ paddingLeft: `${depth * 16}px` }}>
        <span className="mt-0.5 text-muted-foreground/60">
          <GripVertical className="w-4 h-4" />
        </span>
        {hasChildren && (
          <button
            type="button"
            onClick={() => toggleCollapse(task.id)}
            className="mt-0.5 h-5 w-5 rounded border border-border/60 text-xs text-muted-foreground hover:bg-muted transition-colors"
            aria-label={isCollapsed ? "Expand sub tasks" : "Collapse sub tasks"}
          >
            {isCollapsed ? "+" : "–"}
          </button>
        )}
        {!hasChildren && <span className="w-5" />}
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-medium text-foreground">{task.title}</span>
          {formatTaskDescription(task.description) && (
            <span className="text-xs text-muted-foreground line-clamp-1 max-w-[300px] whitespace-pre-line break-words">
              {formatTaskDescription(task.description)}
            </span>
          )}
        </div>
      </div>
      <div>
        {assignedUsers.length > 0 ? (
          <div className="flex items-center gap-2">
            <div className="flex -space-x-1">
              {assignedUsers.slice(0, 3).map((assignedUser) => (
                <Avatar key={assignedUser.id} className="h-6 w-6 border border-primary/10">
                  <AvatarFallback className="text-[10px] bg-primary/5 text-primary">
                    {assignedUser.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              ))}
            </div>
            <span className="text-sm">
              {assignedUsers[0].name}
              {assignedUsers.length > 1 ? ` +${assignedUsers.length - 1}` : ""}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <UserIcon className="w-4 h-4" />
            <span className="text-sm">Unassigned</span>
          </div>
        )}
      </div>
      <div>
        <Badge variant="outline" className={`capitalize font-medium ${getStatusColor(task.status || "todo")}`}>
          {statusLabel}
        </Badge>
      </div>
      <div>
        <Badge variant="outline" className={`capitalize font-medium ${getPriorityColor(priorityLabel)}`}>
          {priorityLabel}
        </Badge>
      </div>
      <div>
        <div className="flex items-center text-xs text-muted-foreground">
          <CalendarDays className="w-3 h-3 mr-1.5" />
          {(() => {
            const parsedDueDate = parseDateOnly(task.dueDate as any);
            return parsedDueDate ? formatShortDate(parsedDueDate) : "-";
          })()}
        </div>
      </div>
      <div className="text-right">
        {canEdit ? (
          <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-primary"
              onClick={() => {
                setEditingTask(task);
                setIsDialogOpen(true);
              }}
            >
              <Pencil className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => handleDelete(task.id)}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">View only</span>
        )}
      </div>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="mb-0 rounded-xl border border-border/60 bg-card p-3">
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

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div className="grid grid-cols-[minmax(220px,1.6fr)_minmax(170px,1fr)_minmax(120px,0.7fr)_minmax(110px,0.6fr)_minmax(140px,0.7fr)_minmax(120px,0.5fr)] gap-3 border-b bg-muted/30 px-4 py-3 text-sm font-medium text-muted-foreground">
              <div>Task Details</div>
              <div>Assigned To</div>
              <div>Status</div>
              <div>Priority</div>
              <div>Due Date</div>
              <div className="text-right">Actions</div>
            </div>

            {visibleTasks.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground">
                No tasks found. Create one to get started!
              </div>
            ) : (
              <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
                <StrictModeDroppable droppableId="root-top" type="TASK">
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`border-b px-4 py-2 text-xs transition-colors ${isDragging ? "pointer-events-auto" : "pointer-events-none"} ${snapshot.isDraggingOver
                        ? "bg-primary/10 text-muted-foreground"
                        : "text-transparent"
                        }`}
                    >
                      Drop here to make it a top-level task
                      {provided.placeholder}
                    </div>
                  )}
                </StrictModeDroppable>

                <StrictModeDroppable droppableId="task-list" type="TASK" isCombineEnabled>
                  {(listProvided) => (
                    <div ref={listProvided.innerRef} {...listProvided.droppableProps}>
                      {orderedRows.map(({ task, depth }, index) => {
                        const canEdit = !!user?.id && task.createdById === user.id;
                        const rawAssignedToIds = (task as any).assignedToIds;
                        let assignedToIds: number[] = [];
                        if (Array.isArray(rawAssignedToIds)) {
                          assignedToIds = rawAssignedToIds.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id));
                        } else if (typeof rawAssignedToIds === "string") {
                          try {
                            const parsed = JSON.parse(rawAssignedToIds);
                            if (Array.isArray(parsed)) {
                              assignedToIds = parsed.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id));
                            }
                          } catch {
                            assignedToIds = [];
                          }
                        }
                        if (assignedToIds.length === 0 && task.assignedToId) assignedToIds = [task.assignedToId];
                        const assignedUsers = users?.filter(u => assignedToIds.includes(u.id)) || [];
                        const children = childrenByParent.get(task.id) || [];
                        const isCollapsed = collapsedIds.has(task.id);
                        const statusLabel = typeof task.status === "string" && task.status.length > 0
                          ? task.status.replace("_", " ")
                          : "todo";
                        const priorityLabel = typeof task.priority === "string" && task.priority.length > 0
                          ? task.priority
                          : "medium";
                        const rowId = `task-${task.id}`;

                        return (
                          <Draggable draggableId={rowId} index={index} key={task.id}>
                            {(provided, snapshot) => (
                              <div ref={provided.innerRef} style={provided.draggableProps.style} className="relative">
                                <div
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className={`group grid grid-cols-[minmax(220px,1.6fr)_minmax(170px,1fr)_minmax(120px,0.7fr)_minmax(110px,0.6fr)_minmax(140px,0.7fr)_minmax(120px,0.5fr)] items-center gap-3 border-b px-4 py-3 transition-colors ${snapshot.isDragging
                                    ? "bg-muted/40 shadow-lg"
                                    : "hover:bg-muted/20"
                                    } ${snapshot.combineTargetFor
                                      ? "bg-primary/10"
                                      : ""
                                    }`}
                                >
                                  {renderRowContent(
                                    task,
                                    depth,
                                    assignedUsers,
                                    children.length > 0,
                                    isCollapsed,
                                    statusLabel,
                                    priorityLabel,
                                    canEdit,
                                  )}
                                </div>

                                {snapshot.combineTargetFor && !snapshot.isDragging && (
                                  <div className="pointer-events-none absolute inset-x-0 top-1/2 z-30 flex -translate-y-1/2 justify-center px-4">
                                    <span className="rounded bg-background px-2 py-1 text-[11px] font-medium text-primary shadow-sm">
                                      Drop to make sub-task
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {listProvided.placeholder}
                    </div>
                  )}
                </StrictModeDroppable>

                <StrictModeDroppable droppableId="root-bottom" type="TASK">
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`px-4 py-2 text-xs transition-colors ${isDragging && orderedRows.length > 0 ? "pointer-events-auto" : "pointer-events-none"} ${snapshot.isDraggingOver
                        ? "bg-primary/10 text-muted-foreground"
                        : "text-transparent"
                        }`}
                    >
                      Drop here to make it a top-level task
                      {provided.placeholder}
                    </div>
                  )}
                </StrictModeDroppable>
              </DragDropContext>
            )}
          </div>
        </div>

        <TaskDialog
          open={isDialogOpen}
          onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) setEditingTask(null);
          }}
          task={editingTask || undefined}
        />
      </div>
    </div>
  );
}
