import { useEffect, useRef, useState } from "react";
import { Bold, Italic, Underline, List, ListOrdered, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RichTextEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  editorClassName?: string;
  minHeight?: string;
};

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Write something...",
  className,
  editorClassName,
  minHeight = "120px",
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isEmpty, setIsEmpty] = useState(!value);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (el.innerHTML !== value) {
      el.innerHTML = value || "";
    }
    setIsEmpty(!el.textContent?.trim());
  }, [value]);

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
    onChange(el.innerHTML);
    setIsEmpty(!el.textContent?.trim());
  };

  const handleInput = () => {
    const el = editorRef.current;
    if (!el) return;
    onChange(el.innerHTML);
    setIsEmpty(!el.textContent?.trim());
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
            "min-h-[120px] p-3 text-sm outline-none prose prose-sm max-w-none",
            editorClassName,
          )}
          style={{ minHeight }}
          contentEditable
          onInput={handleInput}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          suppressContentEditableWarning
        />
      </div>
    </div>
  );
}
