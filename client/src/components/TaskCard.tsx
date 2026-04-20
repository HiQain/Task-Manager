import { Draggable } from "@hello-pangea/dnd";
import { type Task } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, GripVertical, MessageSquare, MoreHorizontal, User as UserIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { useUsers } from "@/hooks/use-users";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/use-auth";
import { getNonInlineTaskAttachments } from "@/lib/task-description";
import { cn, formatTaskDescription, formatShortDate, isTaskOverdue, parseDateOnly } from "@/lib/utils";

interface TaskCardProps {
  task: Task;
  index: number;
  canEdit: boolean;
  canMove: boolean;
  onEdit: (task: Task) => void;
  onDelete: (id: number) => void;
  onRestore?: (task: Task) => void;
  onPermanentDelete?: (task: Task) => void;
  onView?: (task: Task) => void;
  onMessage?: (task: Task) => void;
}

const priorityColors = {
  low: "bg-slate-100 text-slate-600 border-slate-200",
  medium: "bg-blue-50 text-blue-600 border-blue-200",
  high: "bg-orange-50 text-orange-600 border-orange-200",
};

const statusBorderColors = {
  todo: "border-slate-200",
  in_progress: "border-blue-200",
  done: "border-green-200",
  trash: "border-rose-200 bg-rose-50/40",
};

function formatDueDate(value?: string | Date | null): string {
  if (!value) return "-";
  const date = parseDateOnly(value);
  return formatShortDate(date);
}

function getAttachmentMeta(attachment: any, index: number) {
  if (typeof attachment === "string") {
    const rawName = attachment.split("/").pop() || `Attachment ${index + 1}`;
    const name = rawName.split("?")[0];
    const extension = name.includes(".") ? name.split(".").pop()?.toUpperCase() || "FILE" : "FILE";
    return { isImage: attachment.startsWith("data:image"), name, extension, href: attachment };
  }

  const name = attachment?.name || `Attachment ${index + 1}`;
  const extension = name.includes(".") ? name.split(".").pop()?.toUpperCase() || "FILE" : "FILE";
  return {
    isImage: attachment?.type?.startsWith("image/"),
    name,
    extension,
    href: attachment?.data,
  };
}

export function TaskCard({ task, index, canEdit, canMove, onEdit, onDelete, onRestore, onPermanentDelete, onView, onMessage }: TaskCardProps) {
  const { data: users } = useUsers();
  const { user } = useAuth();
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
  const assignedUsers = users?.filter((u) => assignedToIds.includes(u.id)) || [];
  const createdByUser = users?.find((u) => u.id === task.createdById);
  const isCreatedByMe = !!user?.id && task.createdById === user.id;
  const isAssignedToMe = !!user?.id && assignedToIds.includes(user.id);
  const assignedByLabel = createdByUser
    ? `${createdByUser.role === "admin" ? "Admin" : createdByUser.name} assigned to you`
    : "Assigned to you";
  const relationLabel = isCreatedByMe ? "Created by you" : isAssignedToMe ? assignedByLabel : null;
  const relationClass = isCreatedByMe
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-amber-50 text-amber-700 border-amber-200";
  const adminAssignmentText = (() => {
    if (user?.role !== "admin" || !createdByUser || assignedUsers.length === 0) return null;
    const assignedNames = assignedUsers.map((u) => u.name).join(", ");
    return `${createdByUser.name} assigned to ${assignedNames}`;
  })();
  const canOpenChat = (() => {
    if (task.status === "done") return false;
    if (task.status === "trash") return false;
    if (!user?.id) return false;
    const participantIds = new Set<number>(
      [task.createdById, ...assignedToIds].filter((id): id is number => typeof id === "number" && Number.isFinite(id))
    );
    participantIds.delete(user.id);
    return participantIds.size > 0;
  })();
  const isOverdue = isTaskOverdue(task.status, task.dueDate as any);
  const statusBorderClass = statusBorderColors[task.status as keyof typeof statusBorderColors] || "border-border/60";

  return (
    <Draggable draggableId={String(task.id)} index={index} isDragDisabled={!canMove}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...(canMove ? provided.dragHandleProps : {})}
          style={provided.draggableProps.style}
          className="mb-3 group"
          onClick={() => onView && onView(task)}
        >
          <Card
            className={cn(
              "shadow-sm hover:shadow-md transition-all duration-200",
              statusBorderClass,
              canMove ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
              isOverdue && "border-red-200 bg-red-50/40",
              snapshot.isDragging && "shadow-xl ring-2 ring-primary/20 rotate-2",
            )}
          >
            <CardContent className="flex h-full flex-col p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={`capitalize font-medium ${priorityColors[task.priority as keyof typeof priorityColors]}`}>
                    {task.priority}
                  </Badge>
                  {isOverdue && (
                    <Badge variant="outline" className="font-medium text-red-700 border-red-200 bg-red-100">
                      Overdue
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {canOpenChat && onMessage && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onMessage(task);
                      }}
                      className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity focus:opacity-100 outline-none p-1 rounded hover:bg-muted"
                      aria-label="Open task chat"
                    >
                      <MessageSquare className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                    </button>
                  )}

                  {canEdit && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity focus:opacity-100 outline-none"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {task.status === "trash" ? (
                          <>
                            {onRestore && (
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRestore(task);
                                }}
                              >
                                Restore to To Do
                              </DropdownMenuItem>
                            )}
                            {onPermanentDelete && (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onPermanentDelete(task);
                                }}
                              >
                                Delete permanently
                              </DropdownMenuItem>
                            )}
                          </>
                        ) : (
                          <>
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
                              Move to trash
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>

              <h4 className="font-semibold text-sm mb-1 line-clamp-2">{task.title}</h4>
              {relationLabel && (
                <Badge variant="outline" className={`mb-2 self-start w-fit max-w-[210px] overflow-hidden ${relationClass}`}>
                  <span className="block truncate text-[10px] font-medium" title={relationLabel}>
                    {relationLabel}
                  </span>
                </Badge>
              )}
              {adminAssignmentText && (
                <Badge
                  variant="outline"
                  className="mb-2 self-start w-fit max-w-[210px] overflow-hidden bg-sky-50 text-sky-700 border-sky-200"
                >
                  <span className="block truncate text-[10px] font-medium" title={adminAssignmentText}>
                    {adminAssignmentText}
                  </span>
                </Badge>
              )}
              {formatTaskDescription(task.description) && (
                <p className="text-xs text-muted-foreground line-clamp-2 mb-3 min-h-[1.5em] whitespace-pre-line break-words">
                  {formatTaskDescription(task.description)}
                </p>
              )}

              {/* Attachments preview */}
              {(() => {
                const attachments = getNonInlineTaskAttachments((task as any).attachments);
                if (!attachments || attachments.length === 0) return null;
                return (
                  <div className="flex gap-2 mb-3">
                    {attachments.slice(0, 4).map((a: any, i: number) => {
                      const meta = getAttachmentMeta(a, i);
                      return (
                        <div key={i} className="w-12 h-12 border rounded overflow-hidden bg-white flex items-center justify-center">
                          {meta.isImage ? (
                            typeof a === 'string' ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={a} alt={`attachment-${i}`} className="object-cover w-full h-full" />
                            ) : (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={a.data} alt={a.name} className="object-cover w-full h-full" />
                            )
                          ) : (
                            <a
                              href={meta.href}
                              download={typeof a === "string" ? undefined : meta.name}
                              className="flex h-full w-full items-center justify-center p-1 text-[10px] font-semibold text-slate-600"
                              title={meta.name}
                            >
                              {meta.extension}
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              <div className="mt-auto flex items-center gap-2 border-t border-border/50 pt-3 text-xs text-muted-foreground">
                {assignedUsers.length > 0 ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <div className="flex -space-x-1">
                      {assignedUsers.slice(0, 2).map((assignedUser) => (
                        <Avatar key={assignedUser.id} className="h-5 w-5 border border-primary/10">
                          <AvatarFallback className="text-[10px] bg-primary/5 text-primary">
                            {assignedUser.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      ))}
                    </div>
                    <span className="truncate max-w-full">
                      {assignedUsers[0].name}
                      {assignedUsers.length > 1 ? ` +${assignedUsers.length - 1}` : ""}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <UserIcon className="w-3 h-3" />
                    <span>Unassigned</span>
                  </div>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <div className={cn("flex items-center", isOverdue && "text-red-700 font-medium")}>
                    <Clock className="w-3 h-3 mr-1" />
                    <span>{formatDueDate(task.dueDate as any)}</span>
                  </div>
                  {canMove && (
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <GripVertical className="w-4 h-4 text-muted-foreground/50" />
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </Draggable>
  );
}
