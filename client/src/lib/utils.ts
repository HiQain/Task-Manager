import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function stripHtml(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

export function formatTaskDescription(input: string | null | undefined): string {
  if (!input) return "";
  let text = input;
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n");
  text = text.replace(/<li>/gi, "\n• ");
  text = text.replace(/<\/li>/gi, "");
  text = text.replace(/<\/(ul|ol)>/gi, "\n");
  text = text.replace(/<[^>]*>/g, "");
  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}
