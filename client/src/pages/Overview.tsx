import { useTasks, useUpdateTask } from "@/hooks/use-tasks";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Clock, ListTodo, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { useQueryClient } from "@tanstack/react-query";

export default function Overview() {
  const { data: tasks, isLoading } = useTasks();
  const { user } = useAuth();
  const updateTask = useUpdateTask();
  const queryClient = useQueryClient();

  if (isLoading) return null;

  // ===== USER VIEW: Simple Kanban Board with Drag & Drop (Assigned Tasks Only) =====
  if (user?.role !== "admin") {
    // Filter tasks assigned to current user only
    const assignedTasks = tasks?.filter(t => t.assignedToId === user?.id) || [];
    const todoTasks = assignedTasks.filter(t => t.status === 'todo');
    const inProgressTasks = assignedTasks.filter(t => t.status === 'in_progress');
    const doneTasks = assignedTasks.filter(t => t.status === 'done');

    const onDragEnd = async (result: DropResult) => {
      const { source, destination, draggableId } = result;

      if (!destination) return;
      if (source.droppableId === destination.droppableId && source.index === destination.index) {
        return;
      }

      const taskId = parseInt(draggableId);
      const newStatus = destination.droppableId;

      updateTask.mutate({ id: taskId, status: newStatus });
    };

    return (
      <div className="space-y-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Tasks</h2>
          <p className="text-muted-foreground">Manage your assigned tasks - drag and drop to update status</p>
        </div>
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* To Do */}
            <div className="rounded-lg border bg-slate-50/50 dark:bg-slate-900/50">
              <div className="p-4 border-b">
                <h3 className="font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4 text-orange-500" />
                  To Do ({todoTasks.length})
                </h3>
              </div>
              <Droppable droppableId="todo">
                {(provided, snapshot) => (
                  <div
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                    className={`p-4 min-h-96 space-y-3 transition-colors ${snapshot.isDraggingOver ? 'bg-orange-50 dark:bg-orange-900/20' : ''
                      }`}
                  >
                    {todoTasks.map((task, index) => (
                      <Draggable key={task.id} draggableId={String(task.id)} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={`p-3 rounded-lg border bg-white shadow-sm cursor-move transition-all ${snapshot.isDragging ? 'shadow-lg ring-2 ring-orange-500' : ''
                              }`}
                          >
                            <p className="font-medium text-sm">{task.title}</p>
                            <p className="text-xs text-muted-foreground mt-1">{task.description}</p>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>

            {/* In Progress */}
            <div className="rounded-lg border bg-blue-50/50 dark:bg-blue-900/50">
              <div className="p-4 border-b">
                <h3 className="font-semibold flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-blue-500" />
                  In Progress ({inProgressTasks.length})
                </h3>
              </div>
              <Droppable droppableId="in_progress">
                {(provided, snapshot) => (
                  <div
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                    className={`p-4 min-h-96 space-y-3 transition-colors ${snapshot.isDraggingOver ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                      }`}
                  >
                    {inProgressTasks.map((task, index) => (
                      <Draggable key={task.id} draggableId={String(task.id)} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={`p-3 rounded-lg border bg-white shadow-sm cursor-move transition-all ${snapshot.isDragging ? 'shadow-lg ring-2 ring-blue-500' : ''
                              }`}
                          >
                            <p className="font-medium text-sm">{task.title}</p>
                            <p className="text-xs text-muted-foreground mt-1">{task.description}</p>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>

            {/* Done */}
            <div className="rounded-lg border bg-green-50/50 dark:bg-green-900/50">
              <div className="p-4 border-b">
                <h3 className="font-semibold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Done ({doneTasks.length})
                </h3>
              </div>
              <Droppable droppableId="done">
                {(provided, snapshot) => (
                  <div
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                    className={`p-4 min-h-96 space-y-3 transition-colors ${snapshot.isDraggingOver ? 'bg-green-50 dark:bg-green-900/20' : ''
                      }`}
                  >
                    {doneTasks.map((task, index) => (
                      <Draggable key={task.id} draggableId={String(task.id)} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={`p-3 rounded-lg border bg-white shadow-sm cursor-move transition-all opacity-75 ${snapshot.isDragging ? 'shadow-lg ring-2 ring-green-500' : ''
                              }`}
                          >
                            <p className="font-medium text-sm line-through">{task.title}</p>
                            <p className="text-xs text-muted-foreground mt-1">{task.description}</p>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          </div>
        </DragDropContext>
      </div>
    );
  }

  // ===== ADMIN VIEW: Full Dashboard with Statistics & User Management =====
  const total = tasks?.length || 0;
  const completed = tasks?.filter(t => t.status === 'done').length || 0;
  const inProgress = tasks?.filter(t => t.status === 'in_progress').length || 0;
  const todo = tasks?.filter(t => t.status === 'todo').length || 0;
  const highPriority = tasks?.filter(t => t.priority === 'high' && t.status !== 'done').length || 0;

  const data = [
    { name: 'Done', value: completed, color: 'hsl(142.1 76.2% 36.3%)' },
    { name: 'In Progress', value: inProgress, color: 'hsl(221.2 83.2% 53.3%)' },
    { name: 'To Do', value: todo, color: 'hsl(215.4 16.3% 46.9%)' },
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-6 animate-in">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tasks</CardTitle>
            <ListTodo className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
            <p className="text-xs text-muted-foreground">Across all projects</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completed}</div>
            <p className="text-xs text-muted-foreground">
              {total > 0 ? Math.round((completed / total) * 100) : 0}% completion rate
            </p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <Clock className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inProgress}</div>
            <p className="text-xs text-muted-foreground">Active tasks</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow border-l-4 border-l-orange-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">High Priority</CardTitle>
            <AlertCircle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{highPriority}</div>
            <p className="text-xs text-muted-foreground">Needs attention</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts and Activity */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4 shadow-md">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {tasks?.slice(0, 5).map((task) => (
                <div key={task.id} className="flex items-center">
                  <div className={`w-2 h-2 rounded-full mr-4 ${task.status === 'done' ? 'bg-green-500' :
                    task.status === 'in_progress' ? 'bg-blue-500' : 'bg-slate-300'
                    }`} />
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {task.createdAt ? format(new Date(task.createdAt), "PPP p") : "Just now"}
                    </p>
                  </div>
                  <div className="ml-auto text-xs text-muted-foreground capitalize">
                    {task.status.replace('_', ' ')}
                  </div>
                </div>
              ))}
              {(!tasks || tasks.length === 0) && (
                <div className="text-center py-8 text-muted-foreground">No recent activity</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-3 shadow-md">
          <CardHeader>
            <CardTitle>Status Distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-[200px]">
            {data.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {data.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                No data to display
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}