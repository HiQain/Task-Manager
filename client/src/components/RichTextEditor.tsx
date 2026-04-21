import { useLayoutEffect, useRef, useState, type ClipboardEvent, type MouseEvent } from "react";
import { Bold, Italic, Link as LinkIcon, List, ListOrdered, Underline } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildInlineImageHtml,
  buildTaskDescriptionEditorHtml,
  createInlineTaskAttachment,
  hasEditorTaskDescriptionContent,
  pruneInlineTaskAttachments,
  serializeTaskDescriptionEditorHtml,
  type TaskAttachmentRecord,
} from "@/lib/task-description";
import { cn } from "@/lib/utils";

type RichTextEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onAttachmentsChange?: (attachments: TaskAttachmentRecord[]) => void;
  attachments?: TaskAttachmentRecord[];
  placeholder?: string;
  className?: string;
  editorClassName?: string;
  minHeight?: string;
};

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function RichTextEditor({
  value,
  onChange,
  onAttachmentsChange,
  attachments = [],
  placeholder = "Write something...",
  className,
  editorClassName,
  minHeight = "120px",
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastLocalValueRef = useRef("");
  const lastLocalAttachmentsSignatureRef = useRef("");
  const [isFocused, setIsFocused] = useState(false);
  const [isEmpty, setIsEmpty] = useState(!value);

  const getAttachmentsSignature = (items: TaskAttachmentRecord[]) =>
    items
      .map((item) =>
        [
          item.id || "",
          item.name,
          item.type,
          item.reason || "",
          item.inline ? "1" : "0",
          String(item.data.length),
        ].join(":"),
      )
      .join("|");

  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    const nextAttachmentsSignature = getAttachmentsSignature(attachments);
    const nextHtml = buildTaskDescriptionEditorHtml(value || "", attachments);

    const isLocalEditorUpdate =
      value === lastLocalValueRef.current &&
      nextAttachmentsSignature === lastLocalAttachmentsSignatureRef.current;

    if (!isLocalEditorUpdate && el.innerHTML !== nextHtml) {
      el.innerHTML = nextHtml;
    }

    lastLocalValueRef.current = value || "";
    lastLocalAttachmentsSignatureRef.current = nextAttachmentsSignature;
    setIsEmpty(!hasEditorTaskDescriptionContent(el));
  }, [attachments, value]);

  const syncEditorState = (attachmentSource: TaskAttachmentRecord[] = attachments) => {
    const el = editorRef.current;
    if (!el) return;

    const nextValue = serializeTaskDescriptionEditorHtml(el);
    const nextAttachments = pruneInlineTaskAttachments(nextValue, attachmentSource);
    lastLocalValueRef.current = nextValue;
    lastLocalAttachmentsSignatureRef.current = getAttachmentsSignature(nextAttachments);
    onChange(nextValue);
    onAttachmentsChange?.(nextAttachments);
    setIsEmpty(!hasEditorTaskDescriptionContent(el));
  };

  const placeCaretAtEnd = (el: HTMLElement) => {
    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const insertHtmlAtCursor = (html: string) => {
    const el = editorRef.current;
    if (!el) return;

    el.focus();

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      el.insertAdjacentHTML("beforeend", html);
      placeCaretAtEnd(el);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) {
      el.insertAdjacentHTML("beforeend", html);
      placeCaretAtEnd(el);
      return;
    }

    range.deleteContents();
    const temp = document.createElement("div");
    temp.innerHTML = html;
    const fragment = document.createDocumentFragment();
    let lastNode: Node | null = null;

    while (temp.firstChild) {
      lastNode = fragment.appendChild(temp.firstChild);
    }

    range.insertNode(fragment);

    if (!lastNode) return;

    const nextRange = document.createRange();
    if (lastNode.nodeType === Node.ELEMENT_NODE && (lastNode as HTMLElement).tagName === "P") {
      nextRange.selectNodeContents(lastNode);
      nextRange.collapse(false);
    } else {
      nextRange.setStartAfter(lastNode);
      nextRange.collapse(true);
    }
    selection.removeAllRanges();
    selection.addRange(nextRange);
  };

  const exec = (command: string, commandValue?: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();

    if (command === "createLink") {
      const url = commandValue || window.prompt("Enter link URL");
      if (!url) return;
      document.execCommand(command, false, url);
    } else {
      document.execCommand(command, false, commandValue);
    }

    syncEditorState();
  };

  const handleInput = () => {
    syncEditorState();
  };

  const handlePasteImages = async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    const createdAttachments: TaskAttachmentRecord[] = [];
    const fragments: string[] = [];

    for (const file of imageFiles) {
      const data = await readFileAsDataUrl(file);
      const attachment = createInlineTaskAttachment(file, data);
      createdAttachments.push(attachment);
      fragments.push(buildInlineImageHtml(attachment, true));
    }

    const nextAttachments = [...attachments, ...createdAttachments];
    onAttachmentsChange?.(nextAttachments);
    insertHtmlAtCursor(fragments.join(""));
    syncEditorState(nextAttachments);
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.clipboardData?.items || []);
    const imageFiles = items
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (imageFiles.length > 0) {
      event.preventDefault();
      void handlePasteImages(imageFiles);
      return;
    }

    const html = event.clipboardData?.getData("text/html") || "";
    if (html) {
      event.preventDefault();
      const sanitizedHtml = buildTaskDescriptionEditorHtml(html, attachments);
      if (sanitizedHtml) {
        insertHtmlAtCursor(sanitizedHtml);
        syncEditorState();
      }
    }
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const removeButton = target.closest("[data-task-inline-image-remove='true']");
    if (!removeButton) return;

    event.preventDefault();
    event.stopPropagation();

    const inlineImage = removeButton.closest("[data-task-inline-image='true']");
    if (inlineImage instanceof HTMLElement) {
      inlineImage.remove();
      syncEditorState();
      editorRef.current?.focus();
    }
  };

  return (
    <div className={cn("rounded-md border border-input bg-background", className)}>
      <div className="flex flex-wrap items-center gap-1 border-b border-border/70 p-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => exec("bold")}>
          <Bold className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => exec("italic")}>
          <Italic className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => exec("underline")}>
          <Underline className="h-4 w-4" />
        </Button>
        <div className="mx-1 h-4 w-px bg-border" />
        <Button type="button" variant="ghost" size="sm" onClick={() => exec("insertUnorderedList")}>
          <List className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => exec("insertOrderedList")}>
          <ListOrdered className="h-4 w-4" />
        </Button>
        <div className="mx-1 h-4 w-px bg-border" />
        <Button type="button" variant="ghost" size="sm" onClick={() => exec("createLink")}>
          <LinkIcon className="h-4 w-4" />
        </Button>
      </div>
      <div className="relative">
        {isEmpty && !isFocused ? (
          <div className="pointer-events-none absolute left-3 top-3 text-sm text-muted-foreground">
            {placeholder}
          </div>
        ) : null}
        <div
          ref={editorRef}
          className={cn(
            "task-description-content task-description-editor min-h-[120px] p-3 text-sm",
            editorClassName,
          )}
          style={{ minHeight }}
          contentEditable
          onClick={handleClick}
          onInput={handleInput}
          onPaste={handlePaste}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          suppressContentEditableWarning
        />
      </div>
    </div>
  );
}
