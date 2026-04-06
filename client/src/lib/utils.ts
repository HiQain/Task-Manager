import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function stripHtml(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function formatTaskDescriptionFallback(input: string): string {
  let text = input;
  text = text.replace(/<img\b[^>]*>/gi, "\n[Image]\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n");
  text = text.replace(/<li>/gi, "\n• ");
  text = text.replace(/<\/li>/gi, "");
  text = text.replace(/<\/(ul|ol|div)>/gi, "\n");
  text = text.replace(/<[^>]*>/g, "");
  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

export function formatTaskDescription(input: string | null | undefined): string {
  if (!input) return "";
  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") {
    return formatTaskDescriptionFallback(input);
  }

  const parser = new window.DOMParser();
  const doc = parser.parseFromString(input, "text/html");
  const extractText = (node: Node, context?: { listType?: "ul" | "ol"; index?: number }): string => {
    if (node.nodeType === window.Node.TEXT_NODE) {
      return node.textContent || "";
    }

    if (node.nodeType !== window.Node.ELEMENT_NODE) return "";

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === "img") return "[Image]";
    if (tag === "br") return "\n";

    if (tag === "ol" || tag === "ul") {
      const items = Array.from(el.children)
        .map((child, index) => extractText(child, { listType: tag as "ul" | "ol", index: index + 1 }))
        .filter(Boolean)
        .join("\n");
      return items ? `${items}\n` : "";
    }

    if (tag === "li") {
      const content = Array.from(el.childNodes)
        .map((child) => extractText(child))
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (!content) return "";
      const prefix = context?.listType === "ol" ? `${context.index}. ` : "• ";
      return `${prefix}${content}`;
    }

    const content = Array.from(el.childNodes)
      .map((child) => extractText(child))
      .join("");
    const isBlock = ["p", "div", "section", "article", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6"].includes(tag);

    if (!isBlock) return content;
    const normalized = content.replace(/\s+/g, " ").trim();
    return normalized ? `${normalized}\n` : "";
  };

  const text = Array.from(doc.body.childNodes)
    .map((node) => extractText(node))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text || formatTaskDescriptionFallback(input);
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

export function formatShortDate(value?: Date | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  }).format(value);
}
