import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";

async function readJsonOrThrow(res: Response, fallbackMessage: string) {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(fallbackMessage);
  }
  const body = await res.json();
  if (!res.ok) throw new Error(body?.message || fallbackMessage);
  return body;
}

export function useNotifications() {
  return useQuery({
    queryKey: [api.notifications.list.path],
    queryFn: async () => {
      const res = await fetch(api.notifications.list.path, { credentials: "include" });
      const body = await readJsonOrThrow(res, "Failed to fetch notifications");
      return api.notifications.list.responses[200].parse(body);
    },
    refetchInterval: false,
  });
}

export function useNotificationUnreadCount() {
  return useQuery({
    queryKey: [api.notifications.unread.path],
    queryFn: async () => {
      const res = await fetch(api.notifications.unread.path, { credentials: "include" });
      const body = await readJsonOrThrow(res, "Failed to fetch notification unread count");
      return api.notifications.unread.responses[200].parse(body);
    },
    refetchInterval: false,
    staleTime: 0,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(buildUrl(api.notifications.markRead.path, { id }), {
        method: api.notifications.markRead.method,
        credentials: "include",
      });
      await readJsonOrThrow(res, "Failed to mark notification as read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.notifications.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.notifications.unread.path] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(api.notifications.markAllRead.path, {
        method: api.notifications.markAllRead.method,
        credentials: "include",
      });
      await readJsonOrThrow(res, "Failed to mark all notifications as read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.notifications.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.notifications.unread.path] });
    },
  });
}

export function useDeleteNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(buildUrl(api.notifications.delete.path, { id }), {
        method: api.notifications.delete.method,
        credentials: "include",
      });
      await readJsonOrThrow(res, "Failed to delete notification");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.notifications.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.notifications.unread.path] });
    },
  });
}
