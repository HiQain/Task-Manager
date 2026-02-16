import { useState } from "react";
import { useTasks, useDeleteTask } from "@/hooks/use-tasks";
import { useUsers } from "@/hooks/use-users";
import { TaskDialog } from "@/components/TaskDialog";
import { type Task } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Pencil, Trash2, CalendarDays, User as UserIcon } from "lucide-react";
import { format } from "date-fns";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/use-auth";

export default function ListView() {
  const { data: tasks, isLoading } = useTasks();
  const { data: users } = useUsers();
  const { user } = useAuth();
  const deleteTask = useDeleteTask();
  const { toast } = useToast();
  
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

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

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const visibleTasks = (tasks || []).filter((task) => {
    if (user?.role === "admin") return true;
    if (!user?.id) return false;
    if (task.createdById === user.id) return true;

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
    return assignedToIds.includes(user.id);
  });

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
      <Table>
        <TableHeader className="bg-muted/30">
          <TableRow>
            <TableHead className="min-w-[220px]">Task Details</TableHead>
            <TableHead className="min-w-[170px]">Assigned To</TableHead>
            <TableHead className="min-w-[120px]">Status</TableHead>
            <TableHead className="hidden md:table-cell min-w-[110px]">Priority</TableHead>
            <TableHead className="hidden lg:table-cell min-w-[140px]">Due Date</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleTasks.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="h-48 text-center text-muted-foreground">
                No tasks found. Create one to get started!
              </TableCell>
            </TableRow>
          ) : (
            visibleTasks.map((task) => {
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
              return (
                <TableRow key={task.id} className="group hover:bg-muted/20">
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-foreground">{task.title}</span>
                      {task.description && (
                        <span className="text-xs text-muted-foreground line-clamp-1 max-w-[300px]">
                          {task.description}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`capitalize font-medium ${getStatusColor(task.status)}`}>
                      {task.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge variant="outline" className={`capitalize font-medium ${getPriorityColor(task.priority)}`}>
                      {task.priority}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div className="flex items-center text-xs text-muted-foreground">
                      <CalendarDays className="w-3 h-3 mr-1.5" />
                      {task.createdAt ? format(new Date(task.createdAt), "MMM d, yyyy") : "-"}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
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
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
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
  );
}
