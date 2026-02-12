import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { type Task } from "@shared/schema";
import { Clock, User as UserIcon, CalendarClock } from "lucide-react";
import { useUsers } from "@/hooks/use-users";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
}

export function TaskDetailDialog({ open, onOpenChange, task }: Props) {
  const { data: users } = useUsers();
  if (!task) return null;

  const assignedUser = users?.find((u) => u.id === task.assignedToId);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-[700px] max-h-[85vh] p-0 overflow-hidden border-border fixed !top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2">
        <DialogHeader>
          <div className="p-6 border-b">
            <DialogTitle className="text-xl font-display">{task.title}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Description</p>
            <p className="text-sm">{task.description || "No description provided."}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border p-3 bg-muted/20">
              <p className="text-xs text-muted-foreground mb-2">Status</p>
              <Badge variant="outline">{statusLabel}</Badge>
            </div>
            <div className="rounded-lg border p-3 bg-muted/20">
              <p className="text-xs text-muted-foreground mb-2">Priority</p>
              <Badge variant="outline" className={`capitalize ${priorityClass}`}>
                {task.priority}
              </Badge>
            </div>
          </div>

          <div className="rounded-lg border p-3 bg-muted/20">
            <p className="text-xs text-muted-foreground mb-2">Assigned To</p>
            {assignedUser ? (
              <div className="flex items-center gap-2">
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
              <div className="space-y-3">
                {attachments.map((a: any, i: number) => (
                  <div key={i} className="border rounded-lg p-3 bg-background">
                    {typeof a === "string" ? (
                      a.startsWith("data:image") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a} alt={`att-${i}`} className="object-cover w-24 h-24 rounded border" />
                      ) : (
                        <a href={a} className="text-sm underline underline-offset-2">
                          Open
                        </a>
                      )
                    ) : a.type?.startsWith("image/") ? (
                      <div className="flex flex-col gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.data} alt={a.name} className="object-cover w-24 h-24 rounded border" />
                        <span className="text-xs text-muted-foreground">{a.name}</span>
                      </div>
                    ) : (
                      <a href={a.data} download={a.name} className="text-sm underline underline-offset-2">
                        {a.name}
                      </a>
                    )}
                    <div className="mt-2 text-xs text-muted-foreground">
                      Reason: {a?.reason?.trim() ? a.reason : "No reason provided"}
                    </div>
                  </div>
                ))}
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
              <span className={task.dueDate ? "text-destructive font-medium" : ""}>
                Due: {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "Not set"}
              </span>
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
