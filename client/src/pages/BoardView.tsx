import { useState } from "react";
import { DragDropContext, Droppable, DropResult } from "@hello-pangea/dnd";
import { useTasks, useUpdateTask, useDeleteTask } from "@/hooks/use-tasks";
import { TaskCard } from "@/components/TaskCard";
import { TaskDialog } from "@/components/TaskDialog";
import { type Task } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const COLUMNS = [
  { id: "todo", title: "To Do", color: "bg-slate-500" },
  { id: "in_progress", title: "In Progress", color: "bg-blue-500" },
  { id: "done", title: "Done", color: "bg-green-500" },
];

export default function BoardView() {
  const { data: tasks, isLoading } = useTasks();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const { toast } = useToast();
  const { user } = useAuth();

  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const onDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;

    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const newStatus = destination.droppableId;

    // Optimistic update handled by React Query invalidation
    updateTask.mutate({
      id: parseInt(draggableId),
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

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const tasksByStatus = tasks?.reduce((acc, task) => {
    const status = task.status || "todo";
    if (!acc[status]) acc[status] = [];
    acc[status].push(task);
    return acc;
  }, {} as Record<string, Task[]>) || {};

  return (
    <div className="h-full overflow-x-auto pb-4">
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex gap-6 h-full min-w-[1000px]">
          {COLUMNS.map((column) => (
            <div key={column.id} className="flex-1 flex flex-col min-w-[300px]">
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
                          onEdit={handleEdit}
                          onDelete={handleDelete}
                        />
                      ))}
                      {provided.placeholder}

                      {user?.role === "admin" && (
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
    </div>
  );
}
