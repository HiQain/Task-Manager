import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useEffect } from "react";
import {
  getLocalNotificationUnreadCount,
  LOCAL_NOTIFICATIONS_CHANGED_EVENT,
  readLocalNotifications,
} from "@/lib/local-notifications";

async function readJsonOrThrow(res: Response, fallbackMessage: string) {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(fallbackMessage);
  }
  const body = await res.json();
  if (!res.ok) throw new Error(body?.message || fallbackMessage);
  return body;
}

function markNotificationListItemRead(items: any[] | undefined, id: number, timestamp: string) {
  if (!Array.isArray(items)) return { nextItems: items, unreadDelta: 0 };
  let unreadDelta = 0;
  const nextItems = items.map((item) => {
    if (item?.id !== id || item?.readAt) return item;
    unreadDelta = 1;
    return { ...item, readAt: timestamp };
  });
  return { nextItems, unreadDelta };
}

function markAllNotificationListItemsRead(items: any[] | undefined, timestamp: string) {
  if (!Array.isArray(items)) return items;
  return items.map((item) => (item?.readAt ? item : { ...item, readAt: timestamp }));
}

function removeNotificationListItem(items: any[] | undefined, id: number) {
  if (!Array.isArray(items)) return { nextItems: items, unreadDelta: 0 };
  let unreadDelta = 0;
  const nextItems = items.filter((item) => {
    if (item?.id !== id) return true;
    unreadDelta = item?.readAt ? 0 : 1;
    return false;
  });
  return { nextItems, unreadDelta };
}

export function useNotifications() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: [api.notifications.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.notifications.unread.path] });
    };
    window.addEventListener(LOCAL_NOTIFICATIONS_CHANGED_EVENT, invalidate);
    window.addEventListener("storage", invalidate);
    return () => {
      window.removeEventListener(LOCAL_NOTIFICATIONS_CHANGED_EVENT, invalidate);
      window.removeEventListener("storage", invalidate);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: [api.notifications.list.path],
    queryFn: async () => {
      const res = await fetch(api.notifications.list.path, { credentials: "include" });
      const body = await readJsonOrThrow(res, "Failed to fetch notifications");
      const serverNotifications = api.notifications.list.responses[200].parse(body);
      const localNotifications = readLocalNotifications();
      return [...serverNotifications, ...localNotifications].sort((a: any, b: any) => {
        const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });
    },
    refetchInterval: false,
  });
}

export function useNotificationUnreadCount() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: [api.notifications.unread.path] });
    };
    window.addEventListener(LOCAL_NOTIFICATIONS_CHANGED_EVENT, invalidate);
    window.addEventListener("storage", invalidate);
    return () => {
      window.removeEventListener(LOCAL_NOTIFICATIONS_CHANGED_EVENT, invalidate);
      window.removeEventListener("storage", invalidate);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: [api.notifications.unread.path],
    queryFn: async () => {
      const res = await fetch(api.notifications.unread.path, { credentials: "include" });
      const body = await readJsonOrThrow(res, "Failed to fetch notification unread count");
      const parsed = api.notifications.unread.responses[200].parse(body);
      return { count: parsed.count + getLocalNotificationUnreadCount() };
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
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: [api.notifications.list.path] });
      await queryClient.cancelQueries({ queryKey: [api.notifications.unread.path] });

      const previousList = queryClient.getQueryData<any[]>([api.notifications.list.path]);
      const previousUnread = queryClient.getQueryData<{ count: number }>([api.notifications.unread.path]);
      const timestamp = new Date().toISOString();
      const { nextItems, unreadDelta } = markNotificationListItemRead(previousList, id, timestamp);

      queryClient.setQueryData([api.notifications.list.path], nextItems);
      if (unreadDelta > 0) {
        queryClient.setQueryData([api.notifications.unread.path], {
          count: Math.max(0, Number(previousUnread?.count || 0) - unreadDelta),
        });
      }

      return { previousList, previousUnread };
    },
    onError: (_error, _id, context) => {
      if (context?.previousList) {
        queryClient.setQueryData([api.notifications.list.path], context.previousList);
      }
      if (context?.previousUnread) {
        queryClient.setQueryData([api.notifications.unread.path], context.previousUnread);
      }
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
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: [api.notifications.list.path] });
      await queryClient.cancelQueries({ queryKey: [api.notifications.unread.path] });

      const previousList = queryClient.getQueryData<any[]>([api.notifications.list.path]);
      const previousUnread = queryClient.getQueryData<{ count: number }>([api.notifications.unread.path]);
      const timestamp = new Date().toISOString();

      queryClient.setQueryData(
        [api.notifications.list.path],
        markAllNotificationListItemsRead(previousList, timestamp),
      );
      queryClient.setQueryData([api.notifications.unread.path], { count: 0 });

      return { previousList, previousUnread };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousList) {
        queryClient.setQueryData([api.notifications.list.path], context.previousList);
      }
      if (context?.previousUnread) {
        queryClient.setQueryData([api.notifications.unread.path], context.previousUnread);
      }
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
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: [api.notifications.list.path] });
      await queryClient.cancelQueries({ queryKey: [api.notifications.unread.path] });

      const previousList = queryClient.getQueryData<any[]>([api.notifications.list.path]);
      const previousUnread = queryClient.getQueryData<{ count: number }>([api.notifications.unread.path]);
      const { nextItems, unreadDelta } = removeNotificationListItem(previousList, id);

      queryClient.setQueryData([api.notifications.list.path], nextItems);
      if (unreadDelta > 0) {
        queryClient.setQueryData([api.notifications.unread.path], {
          count: Math.max(0, Number(previousUnread?.count || 0) - unreadDelta),
        });
      }

      return { previousList, previousUnread };
    },
    onError: (_error, _id, context) => {
      if (context?.previousList) {
        queryClient.setQueryData([api.notifications.list.path], context.previousList);
      }
      if (context?.previousUnread) {
        queryClient.setQueryData([api.notifications.unread.path], context.previousUnread);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.notifications.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.notifications.unread.path] });
    },
  });
}
