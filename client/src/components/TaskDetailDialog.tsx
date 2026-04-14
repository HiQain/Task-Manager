import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { type Task } from "@shared/schema";
import { Clock, User as UserIcon, CalendarClock } from "lucide-react";
import { useUsers } from "@/hooks/use-users";
import { useCreateTaskComment, useTaskComments } from "@/hooks/use-task-comments";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { cn, formatTaskDescription, formatShortDate, isTaskOverdue, parseDateOnly } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
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
    reason: typeof attachment?.reason === "string" ? attachment.reason.trim() : "",
  };
}

export function TaskDetailDialog({ open, onOpenChange, task }: Props) {
  const { data: users } = useUsers();
  const { user } = useAuth();
  const [commentText, setCommentText] = useState("");
  const [commentSearch, setCommentSearch] = useState("");
  const [mentionQuery, setMentionQuery] = useState("");
  const [isMentionOpen, setIsMentionOpen] = useState(false);
  const taskId = task?.id ?? 0;

  const { data: comments, isLoading: commentsLoading } = useTaskComments(taskId, open && !!taskId, 5000);
  const createComment = useCreateTaskComment(taskId);

  useEffect(() => {
    if (!open) {
      setCommentText("");
      setCommentSearch("");
      setMentionQuery("");
      setIsMentionOpen(false);
    }
  }, [open, task?.id]);

  const filteredComments = useMemo(() => {
    if (!comments || comments.length === 0) return [];
    const normalized = commentSearch.trim().toLowerCase();
    if (!normalized) return comments;
    return comments.filter((comment) => {
      const author = users?.find((u) => u.id === comment.userId);
      const authorText = `${author?.name || ""} ${author?.email || ""}`.toLowerCase();
      const contentText = String(comment.content || "").toLowerCase();
      return `${authorText} ${contentText}`.includes(normalized);
    });
  }, [commentSearch, comments, users]);

  if (!task) return null;

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
  const createdByUser = users?.find((u) => u.id === task.createdById) || null;
  const adminUsers = (users || []).filter((u) => String(u.role || "").toLowerCase() === "admin");
  const mentionableUsers = Array.from(
    new Map(
      [...assignedUsers, ...(createdByUser ? [createdByUser] : []), ...adminUsers]
        .filter((member) => member.id !== user?.id)
        .map((member) => [member.id, member]),
    ).values(),
  );
  const attachments = Array.isArray((task as any).attachments)
    ? (task as any).attachments
    : (() => {
      try {
        return JSON.parse((task as any).attachments || "[]");
      } catch {
        return [];
      }
    })();

  const statusLabel =
    task.status === "in_progress" ? "In Progress" : task.status === "done" ? "Done" : "To Do";

  const priorityClass =
    task.priority === "high"
      ? "bg-orange-50 text-orange-600 border-orange-200"
      : task.priority === "low"
        ? "bg-slate-100 text-slate-600 border-slate-200"
      : "bg-blue-50 text-blue-600 border-blue-200";

  const isCreatedByMe = !!user?.id && task.createdById === user.id;
  const isAssignedToMe = !!user?.id && assignedToIds.includes(user.id);
  const canComment = !!user?.id && (isCreatedByMe || isAssignedToMe || user?.role === "admin");
  const parsedDueDate = parseDateOnly(task.dueDate as any);
  const isOverdue = isTaskOverdue(task.status, task.dueDate as any);
  const handleAddComment = async () => {
    const trimmed = commentText.trim();
    if (!trimmed) return;
    try {
      await createComment.mutateAsync(trimmed);
      setCommentText("");
    } catch {
      // handled by toast elsewhere if needed
    }
  };

  const getMentionToken = (value: string) => {
    const match = value.match(/(?:^|\s)@([a-z0-9._-]*)$/i);
    return match ? match[1] : null;
  };

  const getMentionLabel = (member: { name?: string | null; email?: string | null }) => {
    const name = String(member.name || "").trim();
    if (name) {
      return name.split(/\s+/)[0];
    }
    const email = String(member.email || "").trim();
    if (email) return email.split("@")[0] || email;
    return "user";
  };

  const mentionCandidates = mentionableUsers
    .filter((member) => {
      if (!mentionQuery) return true;
      const token = mentionQuery.toLowerCase();
      const name = String(member.name || "").toLowerCase();
      const email = String(member.email || "").toLowerCase();
      return name.includes(token) || email.includes(token);
    })
    .slice(0, 6);

  const insertMention = (label: string) => {
    setCommentText((prev) =>
      prev.replace(/(^|\s)@([a-z0-9._-]*)$/i, `$1@${label} `),
    );
    setMentionQuery("");
    setIsMentionOpen(false);
  };

  const renderCommentText = (text: string) => {
    const parts = text.split(/(\s+)/);
    return parts.map((part, idx) => {
      if (part.startsWith("#")) {
        return (
          <span key={`${part}-${idx}`} className="text-indigo-600 font-medium">
            {part}
          </span>
        );
      }
      if (part.startsWith("@")) {
        return (
          <span key={`${part}-${idx}`} className="text-emerald-600 font-medium">
            {part}
          </span>
        );
      }
      return <span key={`${part}-${idx}`}>{part}</span>;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full sm:max-w-[1100px] max-h-[92vh] p-0 overflow-hidden border-border fixed !top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2">
        <DialogHeader>
          <div className="p-5 sm:p-6 border-b bg-muted/10">
            <DialogTitle className="text-xl font-display">{task.title}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="p-5 sm:p-6 h-[calc(92vh-80px)] overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 min-h-0 h-full">
            <div className="space-y-4 overflow-y-auto pr-1 lg:pr-3 h-full">
              {formatTaskDescription(task.description) && (
                <div>
                  <p className="text-sm whitespace-pre-line break-words">
                    {formatTaskDescription(task.description)}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3 bg-muted/10">
                  <p className="text-xs text-muted-foreground mb-2">Status</p>
                  <Badge variant="outline">{statusLabel}</Badge>
                </div>
                <div className="rounded-lg border p-3 bg-muted/10">
                  <p className="text-xs text-muted-foreground mb-2">Priority</p>
                  <Badge variant="outline" className={`capitalize ${priorityClass}`}>
                    {task.priority}
                  </Badge>
                </div>
              </div>

              <div className="rounded-lg border p-3 bg-muted/10">
                <p className="text-xs text-muted-foreground mb-2">Assigned To</p>
                {assignedUsers.length > 0 ? (
                  <div className="space-y-2">
                    {assignedUsers.map((assignedUser) => (
                      <div key={assignedUser.id} className="flex items-center gap-2">
                        <Avatar className="h-7 w-7 border border-primary/10">
                          <AvatarFallback className="text-[11px] bg-primary/5 text-primary">
                            {assignedUser.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium">{assignedUser.name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <UserIcon className="w-4 h-4" />
                    <span>Unassigned</span>
                  </div>
                )}
              </div>

              {attachments.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Attachments</p>
                  <div className="grid grid-cols-2 gap-3">
                    {attachments.map((a: any, i: number) => {
                      const meta = getAttachmentMeta(a, i);
                      return (
                      <div key={i} className="border rounded-lg p-3 bg-background">
                        {meta.isImage ? (
                          typeof a === "string" ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={a} alt={`att-${i}`} className="object-cover w-full h-24 rounded border" />
                          ) : (
                            <img src={a.data} alt={a.name} className="object-cover w-full h-24 rounded border" />
                          )
                        ) : (
                          <div className="flex items-center gap-3 rounded-md border bg-[#f8fafc] px-3 py-2">
                            <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-white text-xs font-semibold text-slate-600">
                              {meta.extension}
                            </div>
                            <a href={meta.href} download={typeof a === "string" ? undefined : meta.name} className="text-sm underline underline-offset-2 break-all">
                              {meta.name}
                            </a>
                          </div>
                        )}
                        {meta.reason && (
                          <div className="mt-2 text-xs text-muted-foreground">
                            {meta.reason}
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="text-xs text-muted-foreground flex items-center gap-4 flex-wrap pt-2 border-t">
                <div className="flex items-center gap-2">
                  <Clock className="w-3 h-3" />
                  <span>Created: {task.createdAt ? new Date(task.createdAt).toLocaleString() : "-"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <CalendarClock className="w-3 h-3" />
                  <span className={cn(isOverdue && "text-destructive font-medium")}>
                    Due: {parsedDueDate ? formatShortDate(parsedDueDate) : "Not set"}
                  </span>
                  {isOverdue && (
                    <Badge variant="outline" className="text-red-700 border-red-200 bg-red-100">
                      Overdue
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="lg:sticky lg:top-3 lg:self-start space-y-3 min-h-0">
              <div className="rounded-lg border bg-muted/10 p-3 min-h-0">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium">Comments</p>
                    <p className="text-xs text-muted-foreground">Use @ to mention users.</p>
                  </div>
                </div>
                <Input
                  value={commentSearch}
                  onChange={(e) => setCommentSearch(e.target.value)}
                  placeholder="Search comments..."
                  className="h-8 text-xs mb-3"
                />

                {commentsLoading ? (
                  <p className="text-xs text-muted-foreground">Loading comments...</p>
                ) : comments && comments.length > 0 ? (
                  <div className="space-y-2 max-h-[30vh] overflow-y-auto pr-1">
                    {filteredComments.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No matching comments.</p>
                    ) : filteredComments.map((comment) => {
                      const author = users?.find((u) => u.id === comment.userId);
                      return (
                        <div key={comment.id} className="rounded-md border border-border/60 p-3 bg-background">
                          <p className="text-[11px] font-medium text-foreground">
                            {author?.name || "User"}
                          </p>
                          <p className="text-[12px] text-muted-foreground break-words">
                            {renderCommentText(comment.content)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No comments yet.</p>
                )}

                {canComment ? (
                  <div className="mt-3 space-y-2 relative">
                    <div className="relative w-full">
                      <Input
                        value={commentText}
                        onChange={(e) => {
                          const next = e.target.value;
                          setCommentText(next);
                          const token = getMentionToken(next);
                          if (token !== null) {
                            setMentionQuery(token);
                            setIsMentionOpen(true);
                          } else {
                            setMentionQuery("");
                            setIsMentionOpen(false);
                          }
                        }}
                        placeholder="Write a comment... Use #tags and @mentions"
                        className="h-9 text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (isMentionOpen && mentionCandidates[0]) {
                              insertMention(getMentionLabel(mentionCandidates[0]));
                              return;
                            }
                            void handleAddComment();
                          }
                          if (e.key === "Escape") {
                            setIsMentionOpen(false);
                          }
                        }}
                      />
                      {isMentionOpen && (
                        <div className="absolute z-20 bottom-full mb-2 w-full rounded-md border bg-background shadow-md max-h-48 overflow-y-auto">
                          {mentionCandidates.length === 0 && (
                            <div className="px-3 py-2 text-xs text-muted-foreground">
                              No users available to mention.
                            </div>
                          )}
                          {mentionCandidates.map((member) => {
                            const label = getMentionLabel(member);
                            return (
                              <button
                                key={member.id}
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                                onClick={() => insertMention(label)}
                              >
                                <span className="font-medium">@{label}</span>
                                <span className="text-xs text-muted-foreground ml-2">
                                  {member.name || member.email}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <Button
                      type="button"
                      className="w-full"
                      onClick={() => void handleAddComment()}
                      disabled={createComment.isPending}
                    >
                      Send
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mt-3">
                    Only assigned users can comment.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t flex justify-end bg-muted/10">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
