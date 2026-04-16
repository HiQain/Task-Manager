import { buildTaskDescriptionDisplayHtml, type TaskAttachmentRecord } from "@/lib/task-description";
import { cn } from "@/lib/utils";
import type { MouseEvent } from "react";

interface TaskDescriptionContentProps {
  value: string | null | undefined;
  attachments?: TaskAttachmentRecord[];
  className?: string;
  onImageClick?: (image: { src: string; alt: string }) => void;
}

export function TaskDescriptionContent({
  value,
  attachments = [],
  className,
  onImageClick,
}: TaskDescriptionContentProps) {
  const html = buildTaskDescriptionDisplayHtml(value, attachments);

  if (!html) return null;

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onImageClick) return;

    const target = event.target as HTMLElement;
    const image = target.closest("img");
    if (!(image instanceof HTMLImageElement)) return;

    const src = image.getAttribute("src") || "";
    if (!src) return;

    onImageClick({
      src,
      alt: image.getAttribute("alt") || "Task image",
    });
  };

  return (
    <div
      className={cn("task-description-content break-words text-sm", className)}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
