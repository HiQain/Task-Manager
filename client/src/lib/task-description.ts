export type TaskAttachmentRecord = {
  id?: string;
  name: string;
  data: string;
  type: string;
  reason?: string;
  inline?: boolean;
};

const INLINE_IMAGE_ATTR = "data-task-inline-image";
const INLINE_ATTACHMENT_ID_ATTR = "data-attachment-id";
const INLINE_IMAGE_SELECTOR = `[${INLINE_IMAGE_ATTR}="true"]`;

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "section",
  "article",
  "blockquote",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

const INLINE_TAGS = new Map<string, string>([
  ["b", "strong"],
  ["strong", "strong"],
  ["i", "em"],
  ["em", "em"],
  ["u", "u"],
]);

const EMPTY_PARAGRAPH = "<p><br></p>";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeEscapedHtml(value: string): string {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return value;
  }
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function normalizeTextNodeValue(value: string): string {
  return escapeHtml(value.replace(/\u00a0/g, " "));
}

function sanitizeLinkHref(href: string | null): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#") || trimmed.startsWith("/")) return trimmed;

  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://localhost";
    const url = new URL(trimmed, base);
    if (["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) {
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("mailto:") || trimmed.startsWith("tel:")) {
        return trimmed;
      }
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    return null;
  }

  return null;
}

function sanitizeImageSrc(src: string | null): string | null {
  if (!src) return null;
  const trimmed = src.trim();
  if (!trimmed) return null;

  if (
    trimmed.startsWith("data:image/") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("/")
  ) {
    return trimmed;
  }

  return null;
}

function isInlineImagePlaceholder(element: HTMLElement): boolean {
  return element.getAttribute(INLINE_IMAGE_ATTR) === "true";
}

function getInlineAttachmentId(element: HTMLElement): string | null {
  const id = element.getAttribute(INLINE_ATTACHMENT_ID_ATTR)?.trim();
  return id || null;
}

function getAttachmentMap(attachments: TaskAttachmentRecord[]): Map<string, TaskAttachmentRecord> {
  return new Map(
    attachments
      .filter((attachment) => typeof attachment.id === "string" && attachment.id.trim())
      .map((attachment) => [attachment.id!.trim(), attachment]),
  );
}

function htmlContainsContent(html: string): boolean {
  const stripped = html
    .replace(/<br\s*\/?>/gi, "")
    .replace(/<p>\s*<\/p>/gi, "")
    .replace(/<p>\s*<br>\s*<\/p>/gi, "")
    .replace(/\s+/g, "");
  return stripped.length > 0;
}

function buildInlineImageHtml(attachment: TaskAttachmentRecord, editable: boolean): string {
  const id = attachment.id?.trim();
  const data = sanitizeImageSrc(attachment.data) || attachment.data;
  if (!id || !data) return "";

  return [
    `<figure class="task-inline-image${editable ? " task-inline-image--editable" : ""}" ${INLINE_IMAGE_ATTR}="true" ${INLINE_ATTACHMENT_ID_ATTR}="${escapeHtml(id)}"${editable ? ' contenteditable="false"' : ""}>`,
    editable
      ? '<button type="button" class="task-inline-image__remove" data-task-inline-image-remove="true" aria-label="Remove pasted image" title="Remove image">&times;</button>'
      : "",
    `<img src="${escapeHtml(data)}" alt="${escapeHtml(attachment.name || "Pasted image")}" class="task-inline-image__img" draggable="false" />`,
    "</figure>",
  ].join("");
}

type RenderMode = "editor" | "display";

function renderRichTextNode(
  node: Node,
  mode: RenderMode,
  attachmentsById: Map<string, TaskAttachmentRecord>,
): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeTextNodeValue(node.textContent || "");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();

  if (isInlineImagePlaceholder(element)) {
    const attachmentId = getInlineAttachmentId(element);
    if (!attachmentId) return "";
    const attachment = attachmentsById.get(attachmentId);
    if (!attachment) return "";
    return buildInlineImageHtml(attachment, mode === "editor");
  }

  if (tag === "img") {
    const safeSrc = sanitizeImageSrc(element.getAttribute("src"));
    if (!safeSrc) return "";
    return `<img src="${escapeHtml(safeSrc)}" alt="${escapeHtml(element.getAttribute("alt") || "Image")}" class="task-description-embedded-image" />`;
  }

  if (tag === "br") return "<br>";

  if (tag === "a") {
    const safeHref = sanitizeLinkHref(element.getAttribute("href"));
    const children = Array.from(element.childNodes)
      .map((child) => renderRichTextNode(child, mode, attachmentsById))
      .join("");
    if (!children) return "";
    if (!safeHref) return children;
    return `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer noopener">${children}</a>`;
  }

  if (tag === "ul" || tag === "ol") {
    const items = Array.from(element.children)
      .map((child) => renderRichTextNode(child, mode, attachmentsById))
      .filter(Boolean)
      .join("");
    return items ? `<${tag}>${items}</${tag}>` : "";
  }

  if (tag === "li") {
    const children = Array.from(element.childNodes)
      .map((child) => renderRichTextNode(child, mode, attachmentsById))
      .join("");
    return children ? `<li>${children}</li>` : "";
  }

  const inlineTag = INLINE_TAGS.get(tag);
  if (inlineTag) {
    const children = Array.from(element.childNodes)
      .map((child) => renderRichTextNode(child, mode, attachmentsById))
      .join("");
    return children ? `<${inlineTag}>${children}</${inlineTag}>` : "";
  }

  const children = Array.from(element.childNodes)
    .map((child) => renderRichTextNode(child, mode, attachmentsById))
    .join("");

  if (BLOCK_TAGS.has(tag)) {
    if (!htmlContainsContent(children)) {
      return mode === "editor" ? EMPTY_PARAGRAPH : "";
    }
    return `<p>${children}</p>`;
  }

  return children;
}

function serializeStorageNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeTextNodeValue(node.textContent || "");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();

  if (isInlineImagePlaceholder(element)) {
    const attachmentId = getInlineAttachmentId(element);
    return attachmentId
      ? `<figure ${INLINE_IMAGE_ATTR}="true" ${INLINE_ATTACHMENT_ID_ATTR}="${escapeHtml(attachmentId)}"></figure>`
      : "";
  }

  if (tag === "img") {
    const safeSrc = sanitizeImageSrc(element.getAttribute("src"));
    if (!safeSrc) return "";
    return `<img src="${escapeHtml(safeSrc)}" alt="${escapeHtml(element.getAttribute("alt") || "Image")}" />`;
  }

  if (tag === "br") return "<br>";

  if (tag === "a") {
    const safeHref = sanitizeLinkHref(element.getAttribute("href"));
    const children = Array.from(element.childNodes).map(serializeStorageNode).join("");
    if (!children) return "";
    if (!safeHref) return children;
    return `<a href="${escapeHtml(safeHref)}">${children}</a>`;
  }

  if (tag === "ul" || tag === "ol") {
    const items = Array.from(element.children).map(serializeStorageNode).filter(Boolean).join("");
    return items ? `<${tag}>${items}</${tag}>` : "";
  }

  if (tag === "li") {
    const children = Array.from(element.childNodes).map(serializeStorageNode).join("");
    return children ? `<li>${children}</li>` : "";
  }

  const inlineTag = INLINE_TAGS.get(tag);
  if (inlineTag) {
    const children = Array.from(element.childNodes).map(serializeStorageNode).join("");
    return children ? `<${inlineTag}>${children}</${inlineTag}>` : "";
  }

  const children = Array.from(element.childNodes).map(serializeStorageNode).join("");

  if (BLOCK_TAGS.has(tag)) {
    return htmlContainsContent(children) ? `<p>${children}</p>` : EMPTY_PARAGRAPH;
  }

  return children;
}

export function createTaskAttachmentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `task-attachment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeTaskAttachments(raw: unknown): TaskAttachmentRecord[] {
  const parsed = (() => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const value = JSON.parse(raw);
        return Array.isArray(value) ? value : [];
      } catch {
        return [];
      }
    }
    return [];
  })();

  const normalized: TaskAttachmentRecord[] = [];

  parsed.forEach((item, index) => {
    if (typeof item === "string") {
      const rawName = item.split("/").pop() || `Attachment ${index + 1}`;
      const name = decodeEscapedHtml(rawName.split("?")[0]);
      normalized.push({
        name,
        data: item,
        type: item.startsWith("data:image") ? "image/*" : "application/octet-stream",
        inline: false,
      });
      return;
    }

    if (!item || typeof item !== "object") return;

    const record = item as Partial<TaskAttachmentRecord>;
    if (typeof record.data !== "string" || typeof record.name !== "string" || typeof record.type !== "string") {
      return;
    }

    normalized.push({
      id: typeof record.id === "string" ? record.id : undefined,
      name: record.name,
      data: record.data,
      type: record.type,
      reason: typeof record.reason === "string" ? record.reason : "",
      inline: Boolean(record.inline),
    });
  });

  return normalized;
}

export function getNonInlineTaskAttachments(raw: unknown): TaskAttachmentRecord[] {
  return normalizeTaskAttachments(raw).filter((attachment) => !attachment.inline);
}

export function buildTaskDescriptionEditorHtml(
  value: string | null | undefined,
  attachments: TaskAttachmentRecord[] = [],
): string {
  if (!value) return "";
  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") {
    return value;
  }

  const parser = new window.DOMParser();
  const doc = parser.parseFromString(value, "text/html");
  const attachmentMap = getAttachmentMap(attachments);

  return Array.from(doc.body.childNodes)
    .map((node) => renderRichTextNode(node, "editor", attachmentMap))
    .join("")
    .trim();
}

export function buildTaskDescriptionDisplayHtml(
  value: string | null | undefined,
  attachments: TaskAttachmentRecord[] = [],
): string {
  if (!value) return "";
  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") {
    return value;
  }

  const parser = new window.DOMParser();
  const doc = parser.parseFromString(value, "text/html");
  const attachmentMap = getAttachmentMap(attachments);

  return Array.from(doc.body.childNodes)
    .map((node) => renderRichTextNode(node, "display", attachmentMap))
    .join("")
    .trim();
}

export function serializeTaskDescriptionEditorHtml(root: HTMLElement): string {
  return Array.from(root.childNodes)
    .map(serializeStorageNode)
    .join("")
    .replace(/(?:<p><br><\/p>)+$/g, "")
    .trim();
}

export function extractTextFromTaskDescription(input: string | null | undefined): string {
  if (!input) return "";

  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") {
    let text = input;
    text = text.replace(/<figure\b[^>]*data-task-inline-image="true"[^>]*><\/figure>/gi, "\n[Image]\n");
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
    return decodeEscapedHtml(text.trim());
  }

  const parser = new window.DOMParser();
  const doc = parser.parseFromString(input, "text/html");

  const extractNode = (
    node: Node,
    context?: { listType?: "ul" | "ol"; index?: number },
  ): string => {
    if (node.nodeType === window.Node.TEXT_NODE) {
      return node.textContent || "";
    }

    if (node.nodeType !== window.Node.ELEMENT_NODE) return "";

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();

    if (isInlineImagePlaceholder(element) || tag === "img") return "[Image]";
    if (tag === "br") return "\n";

    if (tag === "ol" || tag === "ul") {
      const items = Array.from(element.children)
        .map((child, index) => extractNode(child, { listType: tag as "ul" | "ol", index: index + 1 }))
        .filter(Boolean)
        .join("\n");
      return items ? `${items}\n` : "";
    }

    if (tag === "li") {
      const content = Array.from(element.childNodes)
        .map((child) => extractNode(child))
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (!content) return "";
      const prefix = context?.listType === "ol" ? `${context.index}. ` : "• ";
      return `${prefix}${content}`;
    }

    const content = Array.from(element.childNodes)
      .map((child) => extractNode(child))
      .join("");

    if (!BLOCK_TAGS.has(tag)) return content;

    const normalized = content.replace(/\s+/g, " ").trim();
    return normalized ? `${normalized}\n` : "";
  };

  const text = Array.from(doc.body.childNodes)
    .map((node) => extractNode(node))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return decodeEscapedHtml(text);
}

export function pruneInlineTaskAttachments(
  descriptionHtml: string | null | undefined,
  attachments: TaskAttachmentRecord[],
): TaskAttachmentRecord[] {
  if (!descriptionHtml) {
    return attachments.filter((attachment) => !attachment.inline);
  }

  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") {
    return attachments;
  }

  const parser = new window.DOMParser();
  const doc = parser.parseFromString(descriptionHtml, "text/html");
  const usedAttachmentIds = new Set(
    Array.from(doc.body.querySelectorAll<HTMLElement>(INLINE_IMAGE_SELECTOR))
      .map((element) => getInlineAttachmentId(element))
      .filter((value): value is string => Boolean(value)),
  );

  return attachments.filter((attachment) => {
    if (!attachment.inline) return true;
    if (!attachment.id) return false;
    return usedAttachmentIds.has(attachment.id);
  });
}

export function hasEditorTaskDescriptionContent(root: HTMLElement | null): boolean {
  if (!root) return false;
  const text = root.textContent?.replace(/\u00a0/g, " ").trim();
  if (text) return true;
  return Boolean(root.querySelector(`${INLINE_IMAGE_SELECTOR}, img`));
}

export function createInlineTaskAttachment(file: File, data: string): TaskAttachmentRecord {
  const extension = file.type.split("/")[1] || "png";
  const fallbackName = `Pasted image ${new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}.${extension}`;

  return {
    id: createTaskAttachmentId(),
    name: file.name || fallbackName,
    data,
    type: file.type || "image/png",
    inline: true,
    reason: "",
  };
}

export { buildInlineImageHtml };
