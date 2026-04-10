import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { apiRequest } from "@/lib/queryClient";

export function useTodoLists() {
  return useQuery({
    queryKey: [api.todos.list.path],
    queryFn: async () => {
      const res = await fetch(api.todos.list.path, { credentials: "include" });
      if (!res.ok) {
        throw new Error("Failed to fetch todo lists");
      }
      return api.todos.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateTodoList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { title: string }) => {
      const validated = api.todos.createList.input.parse(data);
      const res = await apiRequest(api.todos.createList.method, api.todos.createList.path, validated);
      return api.todos.createList.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.todos.list.path] });
    },
  });
}

export function useUpdateTodoList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { title: string } }) => {
      const validated = api.todos.updateList.input.parse(data);
      const res = await apiRequest(api.todos.updateList.method, buildUrl(api.todos.updateList.path, { id }), validated);
      return api.todos.updateList.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.todos.list.path] });
    },
  });
}

export function useDeleteTodoList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest(api.todos.deleteList.method, buildUrl(api.todos.deleteList.path, { id }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.todos.list.path] });
    },
  });
}

export function useCreateTodoItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ listId, data }: { listId: number; data: { content: string } }) => {
      const validated = api.todos.createItem.input.parse(data);
      const res = await apiRequest(api.todos.createItem.method, buildUrl(api.todos.createItem.path, { id: listId }), validated);
      return api.todos.createItem.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.todos.list.path] });
    },
  });
}

export function useUpdateTodoItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: { content?: string; completed?: boolean; sortOrder?: number };
    }) => {
      const validated = api.todos.updateItem.input.parse(data);
      const res = await apiRequest(api.todos.updateItem.method, buildUrl(api.todos.updateItem.path, { id }), validated);
      return api.todos.updateItem.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.todos.list.path] });
    },
  });
}

export function useDeleteTodoItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest(api.todos.deleteItem.method, buildUrl(api.todos.deleteItem.path, { id }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.todos.list.path] });
    },
  });
}
