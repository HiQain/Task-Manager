import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { type User, type InsertUser } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

export function useUsers() {
  return useQuery<User[]>({
    queryKey: [api.users.list.path],
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (user: InsertUser) => {
      const res = await apiRequest("POST", api.users.create.path, user);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.users.list.path] });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", buildUrl(api.users.delete.path, { id }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.users.list.path] });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<InsertUser> }) => {
      const res = await apiRequest("PATCH", buildUrl(api.users.update.path, { id }), data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.users.list.path] });
    },
  });
}
