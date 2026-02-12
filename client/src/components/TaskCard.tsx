import { Draggable } from "@hello-pangea/dnd";
import { type Task } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, GripVertical, MoreHorizontal, User as UserIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { useUsers } from "@/hooks/use-users";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/use-auth";

interface TaskCardProps {
  task: Task;
  index: number;
  onEdit: (task: Task) => void;
  onDelete: (id: number) => void;
  onView?: (task: Task) => void;
}

const priorityColors = {
  low: "bg-slate-100 text-slate-600 border-slate-200",
  medium: "bg-blue-50 text-blue-600 border-blue-200",
  high: "bg-orange-50 text-orange-600 border-orange-200",
};

export function TaskCard({ task, index, onEdit, onDelete, onView }: TaskCardProps) {
  const { data: users } = useUsers();
  const assignedUser = users?.find(u => u.id === task.assignedToId);
  const { user } = useAuth();

  return (
    <Draggable draggableId={String(task.id)} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          style={provided.draggableProps.style}
          className="mb-3 group"
          onClick={() => onView && onView(task)}
        >
          <Card
            className={`
              border-border/60 shadow-sm hover:shadow-md transition-all duration-200 cursor-grab active:cursor-grabbing
              ${snapshot.isDragging ? "shadow-xl ring-2 ring-primary/20 rotate-2" : ""}
            `}
          >
            <CardContent className="p-4">
              <div className="flex justify-between items-start mb-2">
                <Badge variant="outline" className={`capitalize font-medium ${priorityColors[task.priority as keyof typeof priorityColors]}`}>
                  {task.priority}
                </Badge>

                <DropdownMenu>
                  {user?.role === "admin" && (
                    <DropdownMenuTrigger
                      className="opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100 outline-none"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                    </DropdownMenuTrigger>
                  )}
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(task);
                      }}
                    >
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(task.id);
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <h4 className="font-semibold text-sm mb-1 line-clamp-2">{task.title}</h4>
              <p className="text-xs text-muted-foreground line-clamp-2 mb-3 min-h-[1.5em]">
                {task.description || "No description provided."}
              </p>

              {/* Attachments preview */}
              {(() => {
                const raw = (task as any).attachments;
                let attachments: any[] = [];
                if (Array.isArray(raw)) attachments = raw;
                else if (typeof raw === 'string') {
                  try { attachments = JSON.parse(raw || '[]'); } catch { attachments = []; }
                }
                if (!attachments || attachments.length === 0) return null;
                return (
                  <div className="flex gap-2 mb-3">
                    {attachments.slice(0, 4).map((a: any, i: number) => (
                      <div key={i} className="w-12 h-12 border rounded overflow-hidden bg-white flex items-center justify-center">
                        {typeof a === 'string' ? (
                          a.startsWith('data:image') ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={a} alt={`attachment-${i}`} className="object-cover w-full h-full" />
                          ) : (
                            <a href={a} className="text-xs p-1">Open</a>
                          )
                        ) : a?.type?.startsWith('image/') ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.data} alt={a.name} className="object-cover w-full h-full" />
                        ) : (
                          <a href={a.data} download={a.name} className="text-xs p-1">{a.name}</a>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}

              <div className="flex items-center text-xs text-muted-foreground pt-3 border-t border-border/50 mt-auto">
                {assignedUser ? (
                  <div className="flex items-center gap-1.5">
                    <Avatar className="h-5 w-5 border border-primary/10">
                      <AvatarFallback className="text-[10px] bg-primary/5 text-primary">
                        {assignedUser.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate max-w-[80px]">{assignedUser.name}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <UserIcon className="w-3 h-3" />
                    <span>Unassigned</span>
                  </div>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <div className="flex items-center">
                    <Clock className="w-3 h-3 mr-1" />
                    <span>{new Date(task.dueDate!).toLocaleDateString()}</span>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <GripVertical className="w-4 h-4 text-muted-foreground/50" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </Draggable>
  );
}
