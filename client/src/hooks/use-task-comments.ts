import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";

async function readJsonOrThrow(res: Response, fallbackMessage: string) {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(fallbackMessage);
  }
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.message || fallbackMessage);
  }
  return body;
}

export function useTaskComments(taskId?: number, enabled = true) {
  return useQuery({
    queryKey: ["tasks", taskId, "comments"],
    queryFn: async () => {
      const res = await fetch(buildUrl(api.tasks.comments.list.path, { id: taskId! }), {
        credentials: "include",
      });
      const body = await readJsonOrThrow(res, "Failed to fetch comments");
      return api.tasks.comments.list.responses[200].parse(body);
    },
    enabled: !!taskId && enabled,
  });
}

export function useCreateTaskComment(taskId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(buildUrl(api.tasks.comments.create.path, { id: taskId }), {
        method: api.tasks.comments.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        credentials: "include",
      });
      const body = await readJsonOrThrow(res, "Failed to add comment");
      return api.tasks.comments.create.responses[201].parse(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks", taskId, "comments"] });
    },
  });
}
