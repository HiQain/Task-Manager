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

export function useSendAnyMessage() {
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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.chats.list.path, variables.toUserId] });
      queryClient.invalidateQueries({ queryKey: [api.chats.unread.path] });
    },
  });
}

export function useUpdateMessage(activeUserId?: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { messageId: number; content: string }) => {
      const validated = api.chats.update.input.parse({ content: payload.content });
      const res = await fetch(buildUrl(api.chats.update.path, { messageId: payload.messageId }), {
        method: api.chats.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      const body = await readJsonOrThrow(res, "Failed to update message");
      return api.chats.update.responses[200].parse(body);
    },
    onSuccess: () => {
      if (activeUserId) {
        queryClient.invalidateQueries({ queryKey: [api.chats.list.path, activeUserId] });
      }
    },
  });
}

export function useDeleteMessage(activeUserId?: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (messageId: number) => {
      const res = await fetch(buildUrl(api.chats.delete.path, { messageId }), {
        method: api.chats.delete.method,
        credentials: "include",
      });
      const body = await readJsonOrThrow(res, "Failed to delete message");
      return api.chats.delete.responses[200].parse(body);
    },
    onSuccess: () => {
      if (activeUserId) {
        queryClient.invalidateQueries({ queryKey: [api.chats.list.path, activeUserId] });
      }
      queryClient.invalidateQueries({ queryKey: [api.chats.unread.path] });
    },
  });
}

export function useClearConversation(activeUserId?: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetch(buildUrl(api.chats.clear.path, { userId }), {
        method: api.chats.clear.method,
        credentials: "include",
      });
      const body = await readJsonOrThrow(res, "Failed to clear conversation");
      return api.chats.clear.responses[200].parse(body);
    },
    onSuccess: (_data, userId) => {
      if (activeUserId || userId) {
        queryClient.invalidateQueries({ queryKey: [api.chats.list.path, activeUserId || userId] });
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

export function useTaskGroupMessages(taskId?: number) {
  return useQuery({
    queryKey: ["chat", "task-group", taskId],
    queryFn: async () => {
      const res = await fetch(buildUrl(api.chats.groupList.path, { taskId: taskId! }), {
        credentials: "include",
      });
      const body = await readJsonOrThrow(res, "Failed to fetch task group messages");
      return api.chats.groupList.responses[200].parse(body);
    },
    enabled: !!taskId,
    refetchInterval: false,
  });
}

export function useTaskGroups() {
  return useQuery({
    queryKey: [api.chats.groups.path],
    queryFn: async () => {
      const res = await fetch(api.chats.groups.path, { credentials: "include" });
      const body = await readJsonOrThrow(res, "Failed to fetch task groups");
      return api.chats.groups.responses[200].parse(body);
    },
    refetchInterval: false,
  });
}

export function useTaskGroupUnreadCounts() {
  return useQuery({
    queryKey: [api.chats.groupsUnread.path],
    queryFn: async () => {
      const res = await fetch(api.chats.groupsUnread.path, { credentials: "include" });
      const body = await readJsonOrThrow(res, "Failed to fetch task group unread counts");
      return api.chats.groupsUnread.responses[200].parse(body);
    },
    refetchInterval: false,
    staleTime: 0,
  });
}

export function useEnsureTaskGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskId: number) => {
      const res = await fetch(buildUrl(api.chats.groupCreate.path, { taskId }), {
        method: api.chats.groupCreate.method,
        credentials: "include",
      });
      const body = await readJsonOrThrow(res, "Failed to create task group");
      return api.chats.groupCreate.responses[201].parse(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.chats.groups.path] });
    },
  });
}

export function useMarkTaskGroupRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskId: number) => {
      const res = await fetch(buildUrl(api.chats.groupMarkRead.path, { taskId }), {
        method: api.chats.groupMarkRead.method,
        credentials: "include",
      });
      await readJsonOrThrow(res, "Failed to mark task group as read");
    },
    onSuccess: (_data, taskId) => {
      queryClient.setQueryData([api.chats.groupsUnread.path], (prev: any) => {
        if (!prev || typeof prev !== "object") return prev;
        const byTask = { ...(prev.byTask || {}) };
        const current = Number(byTask[String(taskId)] || 0);
        byTask[String(taskId)] = 0;
        return {
          ...prev,
          total: Math.max(0, Number(prev.total || 0) - current),
          byTask,
        };
      });
      queryClient.invalidateQueries({ queryKey: [api.chats.groupsUnread.path] });
    },
  });
}

export function useSendTaskGroupMessage(taskId?: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { content: string }) => {
      const validated = api.chats.groupSend.input.parse(payload);
      const res = await fetch(buildUrl(api.chats.groupSend.path, { taskId: taskId! }), {
        method: api.chats.groupSend.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      const body = await readJsonOrThrow(res, "Failed to send task group message");
      return api.chats.groupSend.responses[201].parse(body);
    },
    onSuccess: () => {
      if (taskId) {
        queryClient.invalidateQueries({ queryKey: ["chat", "task-group", taskId] });
      }
      queryClient.invalidateQueries({ queryKey: [api.chats.groupsUnread.path] });
    },
  });
}

export function useSendTaskGroupMessageToTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { taskId: number; content: string }) => {
      const validated = api.chats.groupSend.input.parse({ content: payload.content });
      const res = await fetch(buildUrl(api.chats.groupSend.path, { taskId: payload.taskId }), {
        method: api.chats.groupSend.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      const body = await readJsonOrThrow(res, "Failed to send task group message");
      return api.chats.groupSend.responses[201].parse(body);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["chat", "task-group", variables.taskId] });
      queryClient.invalidateQueries({ queryKey: [api.chats.groupsUnread.path] });
    },
  });
}

export function useUpdateTaskGroupMessage(taskId?: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { messageId: number; content: string }) => {
      const validated = api.chats.groupUpdate.input.parse({ content: payload.content });
      const res = await fetch(buildUrl(api.chats.groupUpdate.path, { taskId: taskId!, messageId: payload.messageId }), {
        method: api.chats.groupUpdate.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      const body = await readJsonOrThrow(res, "Failed to update task group message");
      return api.chats.groupUpdate.responses[200].parse(body);
    },
    onSuccess: () => {
      if (taskId) {
        queryClient.invalidateQueries({ queryKey: ["chat", "task-group", taskId] });
      }
    },
  });
}

export function useDeleteTaskGroupMessage(taskId?: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (messageId: number) => {
      const res = await fetch(buildUrl(api.chats.groupDelete.path, { taskId: taskId!, messageId }), {
        method: api.chats.groupDelete.method,
        credentials: "include",
      });
      const body = await readJsonOrThrow(res, "Failed to delete task group message");
      return api.chats.groupDelete.responses[200].parse(body);
    },
    onSuccess: () => {
      if (taskId) {
        queryClient.invalidateQueries({ queryKey: ["chat", "task-group", taskId] });
      }
      queryClient.invalidateQueries({ queryKey: [api.chats.groupsUnread.path] });
    },
  });
}
