import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertTaskSchema, type InsertTask, type Task } from "@shared/schema";
import { useCreateTask, useUpdateTask } from "@/hooks/use-tasks";
import { useUsers } from "@/hooks/use-users";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, User as UserIcon } from "lucide-react";

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
}

export function TaskDialog({ open, onOpenChange, task }: TaskDialogProps) {
  const { toast } = useToast();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const { data: users } = useUsers();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [assigneeSearch, setAssigneeSearch] = useState("");

  const form = useForm<InsertTask>({
    resolver: zodResolver(insertTaskSchema),
    defaultValues: {
      title: "",
      description: "",
      priority: "medium",
      status: "todo",
      completed: false,
      assignedToId: undefined,
      assignedToIds: [],
      attachments: undefined,
      dueDate: undefined,
    },
  });

  const attachments = form.watch("attachments") || [];
  const dueDate = form.watch("dueDate");
  const assignedToIds = form.watch("assignedToIds") || [];

  const parseAttachments = (raw: unknown): any[] => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const parseAssignedToIds = (rawIds: unknown, rawId: unknown): number[] => {
    const uniq = (arr: number[]) => Array.from(new Set(arr));
    if (Array.isArray(rawIds)) return uniq(rawIds.map((v) => Number(v)).filter(Number.isFinite));
    if (typeof rawIds === "string") {
      const trimmed = rawIds.trim();
      if (!trimmed) return typeof rawId === "number" ? [rawId] : [];
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return uniq(parsed.map((v) => Number(v)).filter(Number.isFinite));
        if (typeof parsed === "number" && Number.isFinite(parsed)) return [parsed];
        if (typeof parsed === "string") {
          return uniq(
            parsed
              .replace(/[\[\]]/g, "")
              .split(",")
              .map((v) => Number(v.trim()))
              .filter(Number.isFinite)
          );
        }
      } catch {
        return uniq(
          trimmed
            .replace(/[\[\]]/g, "")
            .split(",")
            .map((v) => Number(v.trim()))
            .filter(Number.isFinite)
        );
      }
    }
    if (typeof rawId === "number") return [rawId];
    return [];
  };

  const assigneeUsers = useMemo(
    () => (users || []).filter((user) => user.role !== "admin"),
    [users]
  );

  const filteredAssigneeUsers = useMemo(() => {
    const q = assigneeSearch.trim().toLowerCase();
    if (!q) return assigneeUsers;
    return assigneeUsers.filter((u) =>
      `${u.name} ${u.email}`.toLowerCase().includes(q)
    );
  }, [assigneeUsers, assigneeSearch]);

  const displayedAssigneeUsers = useMemo(() => {
    if (assigneeSearch.trim()) return filteredAssigneeUsers;

    const selectedUsers = assigneeUsers.filter((u) => assignedToIds.includes(u.id));
    const topUsers = assigneeUsers.filter((u) => !assignedToIds.includes(u.id)).slice(0, 5);
    const combined = [...selectedUsers, ...topUsers];
    const seen = new Set<number>();
    return combined.filter((u) => {
      if (seen.has(u.id)) return false;
      seen.add(u.id);
      return true;
    });
  }, [assigneeSearch, filteredAssigneeUsers, assigneeUsers, assignedToIds]);

  useEffect(() => {
    if (task) {
      const formattedDueDate = task.dueDate ? new Date(task.dueDate).toISOString().split("T")[0] : undefined;
      const normalizedAttachments = parseAttachments(task.attachments).map((a: any) => ({
        ...(typeof a === "string"
          ? { name: a, data: a, type: a.startsWith("data:image") ? "image/*" : "file" }
          : a),
        reason: (a as any)?.reason || "",
      }));
      form.reset({
        title: task.title,
        description: task.description || "",
        priority: task.priority,
        status: task.status,
        completed: task.completed,
        assignedToId: task.assignedToId || undefined,
        assignedToIds: parseAssignedToIds((task as any).assignedToIds, task.assignedToId),
        attachments: normalizedAttachments,
        dueDate: formattedDueDate,
      });
    } else {
      form.reset({
        title: "",
        description: "",
        priority: "medium",
        status: "todo",
        completed: false,
        assignedToId: undefined,
        assignedToIds: [],
        attachments: undefined,
        dueDate: undefined,
      });
    }
  }, [task, open, form]);

  const isPending = createTask.isPending || updateTask.isPending;

  async function onSubmit(data: InsertTask) {
    const currentAssignedToIds = form.getValues("assignedToIds");
    const normalizedAssignedToIds = Array.isArray(currentAssignedToIds)
      ? Array.from(new Set(currentAssignedToIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))))
      : (data.assignedToId ? [data.assignedToId] : []);
    const payload: InsertTask = {
      ...data,
      assignedToIds: normalizedAssignedToIds,
      assignedToId: normalizedAssignedToIds.length > 0 ? normalizedAssignedToIds[0] : undefined,
    };
    try {
      if (task) {
        await updateTask.mutateAsync({ id: task.id, ...payload });
        toast({ title: "Task updated", description: "Changes saved successfully." });
      } else {
        await createTask.mutateAsync(payload);
        toast({ title: "Task created", description: "New task added to your board." });
      }
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive"
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden border-none shadow-2xl bg-transparent !top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2 fixed">
        <DialogDescription className="sr-only">
          Task editing form
        </DialogDescription>
        <div className="bg-background rounded-lg shadow-lg flex flex-col max-h-[85vh] w-full border border-border">
          <DialogHeader className="p-6 border-b shrink-0">
            <DialogTitle className="text-xl font-display font-semibold">
              {task ? "Edit Task" : "Create New Task"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-6 min-h-0">
            <Form {...form}>
              <form id="task-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pb-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter task title..." {...field} className="h-11" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Add details about this task..."
                          className="resize-none min-h-[100px]"
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="h-11">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="todo">To Do</SelectItem>
                            <SelectItem value="in_progress">In Progress</SelectItem>
                            <SelectItem value="done">Done</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Priority</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="h-11">
                              <SelectValue placeholder="Select priority" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <FormField
                    control={form.control}
                    name="assignedToIds"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <UserIcon className="w-3 h-3" />
                          Assigned To (Multiple)
                        </FormLabel>
                        <Input
                          value={assigneeSearch}
                          onChange={(e) => setAssigneeSearch(e.target.value)}
                          placeholder="Search user..."
                          className="h-9"
                        />
                        <div className="rounded-md border p-3 space-y-2 max-h-44 overflow-y-auto">
                          {displayedAssigneeUsers.map((user) => {
                            const checked = (field.value || []).includes(user.id);
                            return (
                              <label key={user.id} className="flex items-center gap-2 text-sm cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const current = field.value || [];
                                    const next = e.target.checked
                                      ? Array.from(new Set([...current, user.id]))
                                      : current.filter((id) => id !== user.id);
                                    form.setValue("assignedToIds", next, {
                                      shouldDirty: true,
                                      shouldTouch: true,
                                    });
                                    field.onChange(next);
                                    form.setValue("assignedToId", next.length > 0 ? next[0] : undefined, {
                                      shouldDirty: true,
                                      shouldTouch: true,
                                    });
                                  }}
                                  className="h-4 w-4"
                                />
                                <span>{user.name}</span>
                              </label>
                            );
                          })}
                          {displayedAssigneeUsers.length === 0 && (
                            <p className="text-xs text-muted-foreground">
                              {assigneeSearch.trim() ? "No user found." : "No users available."}
                            </p>
                          )}
                        </div>
                        {!assigneeSearch.trim() && filteredAssigneeUsers.length > 5 && (
                          <p className="text-[11px] text-muted-foreground">
                            Selected users stay visible. Other users are limited to first 5; use search to find more.
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-2">
                  <FormLabel>Attachments</FormLabel>
                  {/* Hidden single-file input; use button to trigger for one-at-a-time selection */}
                  <input
                    type="file"
                    accept="image/*,application/*"
                    className="hidden"
                    ref={(el) => (fileInputRef.current = el)}
                    onChange={async (e) => {
                      const file = e.target.files && e.target.files[0];
                      if (!file) return;
                      const readFile = (file: File) => new Promise<{ name: string; data: string; type: string; reason?: string }>((res, rej) => {
                        const reader = new FileReader();
                        reader.onload = () => res({ name: file.name, data: String(reader.result), type: file.type, reason: "" });
                        reader.onerror = rej;
                        reader.readAsDataURL(file);
                      });
                      try {
                        const item = await readFile(file);
                        const current = (form.getValues("attachments") as any[]) || [];
                        form.setValue("attachments" as any, [...current, item] as any);
                      } finally {
                        // reset input so same file can be selected again if needed
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} className="h-9">
                      Add attachment
                    </Button>
                    <Button type="button" variant="ghost" className="h-9" onClick={() => fileInputRef.current?.click()}>
                      Add more
                    </Button>
                  </div>

                  {/* Previews */}
                  <div className="space-y-3">
                    {attachments.map((a: any, idx: number) => (
                      <div key={idx} className="w-full flex flex-col gap-2">
                        <div className="w-24 h-24 border rounded overflow-hidden flex items-center justify-center bg-white">
                          {a.type.startsWith("image/") ? (
                            <img src={a.data} alt={a.name} className="object-cover w-full h-full" />
                          ) : (
                            <a href={a.data} download={a.name} className="text-xs p-2 text-center">
                              {a.name}
                            </a>
                          )}
                        </div>

                        <input
                          placeholder="Type Message For Image..."
                          value={a.reason || ""}
                          onChange={(e) => {
                            const updated = [...attachments];
                            updated[idx] = { ...updated[idx], reason: e.target.value };

                            form.setValue("attachments" as any, updated as any, {
                              shouldDirty: true,
                              shouldTouch: true,
                            });
                          }}
                          className="h-10 rounded-md border px-2 w-full"
                        />
                      </div>
                    ))}
                  </div>

                </div>

                <div>
                  <FormLabel>Due Date</FormLabel>
                  <input
                    type="date"
                    value={dueDate || ""}
                    onChange={(e) => form.setValue("dueDate" as any, e.target.value || undefined)}
                    className="h-10 rounded-md border px-2 w-full"
                  />
                </div>
              </form>
            </Form>
          </div>
          <div className="p-6 border-t flex justify-end gap-2 bg-muted/10 shrink-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="h-11">
              Cancel
            </Button>
            <Button
              form="task-form"
              type="submit"
              disabled={isPending}
              className="h-11 min-w-[100px]"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : task ? "Save Changes" : "Create Task"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
