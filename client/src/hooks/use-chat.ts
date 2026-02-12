import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";

async function readJsonOrThrow(res: Response, fallbackMessage: string) {
  const contentType = res.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const text = await res.text();
    const preview = text.slice(0, 120).replace(/\s+/g, " ").trim();
    throw new Error(
      `Invalid API response (${res.status}). Expected JSON but got HTML/text: ${preview || fallbackMessage}`,
    );
  }

  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.message || fallbackMessage);
  }
  return body;
}

export function useChatUsers() {
  return useQuery({
    queryKey: [api.chats.users.path],
    queryFn: async () => {
      const res = await fetch(api.chats.users.path, { credentials: "include" });
      const body = await readJsonOrThrow(res, "Failed to fetch chat users");
      return api.chats.users.responses[200].parse(body);
    },
  });
}

export function useUnreadCounts() {
  return useQuery({
    queryKey: [api.chats.unread.path],
    queryFn: async () => {
      const res = await fetch(api.chats.unread.path, { credentials: "include" });
      const body = await readJsonOrThrow(res, "Failed to fetch unread counts");
      return api.chats.unread.responses[200].parse(body);
    },
    refetchInterval: false,
    staleTime: 0,
  });
}

export function useMessages(userId?: number) {
  return useQuery({
    queryKey: [api.chats.list.path, userId],
    queryFn: async () => {
      const res = await fetch(buildUrl(api.chats.list.path, { userId: userId! }), {
        credentials: "include",
      });
      const body = await readJsonOrThrow(res, "Failed to fetch messages");
      return api.chats.list.responses[200].parse(body);
    },
    enabled: !!userId,
    refetchInterval: false,
  });
}

export function useSendMessage(activeUserId?: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { toUserId: number; content: string }) => {
      const validated = api.chats.send.input.parse(payload);
      const res = await fetch(api.chats.send.path, {
        method: api.chats.send.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      const body = await readJsonOrThrow(res, "Failed to send message");
      return api.chats.send.responses[201].parse(body);
    },
    onSuccess: () => {
      if (activeUserId) {
        queryClient.invalidateQueries({ queryKey: [api.chats.list.path, activeUserId] });
      }
      queryClient.invalidateQueries({ queryKey: [api.chats.unread.path] });
    },
  });
}

export function useMarkChatRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetch(buildUrl(api.chats.markRead.path, { userId }), {
        method: api.chats.markRead.method,
        credentials: "include",
      });
      await readJsonOrThrow(res, "Failed to mark chat as read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.chats.unread.path] });
    },
  });
}
