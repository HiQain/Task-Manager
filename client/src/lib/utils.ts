import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { extractTextFromTaskDescription } from "@/lib/task-description";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function stripHtml(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function formatTaskDescriptionFallback(input: string): string {
  return extractTextFromTaskDescription(input);
}

export function formatTaskDescription(input: string | null | undefined): string {
  return extractTextFromTaskDescription(input) || formatTaskDescriptionFallback(input || "");
}

export function parseDateOnly(value?: string | Date | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
      return new Date(year, month - 1, day);
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }
  return null;
}

export function isTaskOverdue(
  status?: string | null,
  dueDate?: string | Date | null,
  referenceDate: Date = new Date(),
): boolean {
  if (status === "done" || status === "trash") return false;
  const parsedDueDate = parseDateOnly(dueDate);
  if (!parsedDueDate) return false;

  const startOfToday = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );

  return parsedDueDate.getTime() < startOfToday.getTime();
}

export function formatShortDate(value?: Date | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  }).format(value);
}
