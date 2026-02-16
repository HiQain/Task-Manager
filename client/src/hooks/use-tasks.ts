import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type TaskInput } from "@shared/routes";

export function useTasks() {
  return useQuery({
    queryKey: [api.tasks.list.path],
    queryFn: async () => {
      const res = await fetch(api.tasks.list.path, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch tasks");
      return api.tasks.list.responses[200].parse(await res.json());
    },
  });
}

export function useTask(id: number) {
  return useQuery({
    queryKey: [api.tasks.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.tasks.get.path, { id });
      const res = await fetch(url, {
        credentials: "include",
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch task");
      return api.tasks.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: TaskInput) => {
      const validated = api.tasks.create.input.parse(data);
      const res = await fetch(api.tasks.create.path, {
        method: api.tasks.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 400) {
           const error = api.tasks.create.responses[400].parse(await res.json());
           throw new Error(error.message);
        }
        throw new Error("Failed to create task");
      }
      return api.tasks.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.tasks.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.chats.groups.path] });
      queryClient.invalidateQueries({ queryKey: [api.chats.groupsUnread.path] });
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    onMutate: async ({ id, ...updates }: { id: number } & Partial<TaskInput>) => {
      await queryClient.cancelQueries({ queryKey: [api.tasks.list.path] });
      const previousTasks = queryClient.getQueryData<any[]>([api.tasks.list.path]);

      if (previousTasks) {
        queryClient.setQueryData([api.tasks.list.path], previousTasks.map((task) => {
          if (task.id !== id) return task;
          return { ...task, ...updates };
        }));
      }

      return { previousTasks };
    },
    mutationFn: async ({ id, ...updates }: { id: number } & Partial<TaskInput>) => {
      const validated = api.tasks.update.input.parse(updates);
      const url = buildUrl(api.tasks.update.path, { id });
      const res = await fetch(url, {
        method: api.tasks.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update task");
      return api.tasks.update.responses[200].parse(await res.json());
    },
    onError: (_err, _variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData([api.tasks.list.path], context.previousTasks);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.tasks.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.chats.groups.path] });
      queryClient.invalidateQueries({ queryKey: [api.chats.groupsUnread.path] });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.tasks.delete.path, { id });
      const res = await fetch(url, {
        method: api.tasks.delete.method,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete task");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.tasks.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.chats.groups.path] });
      queryClient.invalidateQueries({ queryKey: [api.chats.groupsUnread.path] });
    },
  });
}
