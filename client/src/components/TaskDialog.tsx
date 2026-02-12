import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertTaskSchema, type InsertTask } from "@shared/schema";
import { useCreateTask, useUpdateTask } from "@/hooks/use-tasks";
import { useUsers } from "@/hooks/use-users";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, User as UserIcon, Send } from "lucide-react";

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: { id: number } & InsertTask;
}

export function TaskDialog({ open, onOpenChange, task }: TaskDialogProps) {
  const { toast } = useToast();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const { data: users } = useUsers();

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const form = useForm<InsertTask>({
    resolver: zodResolver(insertTaskSchema),
    defaultValues: {
      title: "",
      description: "",
      priority: "medium",
      status: "todo",
      completed: false,
      assignedToId: undefined,
      attachments: undefined,
      dueDate: undefined,
    },
  });

  const attachments = form.watch("attachments") || [];
  const dueDate = form.watch("dueDate");

  useEffect(() => {
    if (task) {
      const formattedDueDate = task.dueDate
        ? new Date(task.dueDate).toISOString().split("T")[0]
        : undefined;
      form.reset({
        title: task.title,
        description: task.description || "",
        priority: task.priority,
        status: task.status,
        completed: task.completed,
        assignedToId: task.assignedToId || undefined,
        attachments: (task.attachments || []).map((a: any) => ({ ...(typeof a === 'string' ? { name: a, data: a, type: a.startsWith('data:image') ? 'image' : 'file' } : a), reason: (a as any)?.reason || "" })),
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
        attachments: undefined,
        dueDate: undefined,
      });
    }
  }, [task, open, form]);

  const isPending = createTask.isPending || updateTask.isPending;

  async function onSubmit(data: InsertTask) {
    try {
      if (task) {
        await updateTask.mutateAsync({ id: task.id, ...data });
        toast({ title: "Task updated", description: "Changes saved successfully." });
      } else {
        await createTask.mutateAsync(data);
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
                    name="assignedToId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <UserIcon className="w-3 h-3" />
                          Assigned To
                        </FormLabel>
                        <Select
                          onValueChange={(val) => field.onChange(val === "none" ? undefined : parseInt(val))}
                          value={field.value?.toString() || "none"}
                        >
                          <FormControl>
                            <SelectTrigger className="h-11">
                              <SelectValue placeholder="Unassigned" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="none">Unassigned</SelectItem>
                            {users?.filter(user => user.role !== 'admin').map(user => (
                              <SelectItem key={user.id} value={user.id.toString()}>
                                {user.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
