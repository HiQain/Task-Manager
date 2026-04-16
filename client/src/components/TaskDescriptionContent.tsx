import { buildTaskDescriptionDisplayHtml, type TaskAttachmentRecord } from "@/lib/task-description";
import { cn } from "@/lib/utils";

interface TaskDescriptionContentProps {
  value: string | null | undefined;
  attachments?: TaskAttachmentRecord[];
  className?: string;
}

export function TaskDescriptionContent({
  value,
  attachments = [],
  className,
}: TaskDescriptionContentProps) {
  const html = buildTaskDescriptionDisplayHtml(value, attachments);

  if (!html) return null;

  return (
    <div
      className={cn("task-description-content break-words text-sm", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
