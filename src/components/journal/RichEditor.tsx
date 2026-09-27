import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading2, Heading3, Italic, List, ListOrdered, Quote } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A small Tiptap rich-text editor for journal entries. Stores/returns HTML. */
export function RichEditor({
  value,
  onChange,
  label = "Entry text",
}: {
  value: string;
  onChange: (html: string) => void;
  /** Accessible name for the writing area. */
  label?: string;
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: "prose-journal min-h-[180px] max-h-[45vh] overflow-y-auto focus:outline-none",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
      },
    },
  });
  if (!editor) return null;

  const Btn = ({ on, active, label, children }: { on: () => void; active: boolean; label: string; children: ReactNode }) => (
    <button
      type="button"
      onClick={on}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded hover:bg-accent [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
        active ? "bg-accent text-primary-700 dark:text-primary-400" : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
  const c = () => editor.chain().focus();

  return (
    <div className="rounded-md border border-input">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border p-1">
        <Btn label="Bold" on={() => c().toggleBold().run()} active={editor.isActive("bold")}>
          <Bold size={15} />
        </Btn>
        <Btn label="Italic" on={() => c().toggleItalic().run()} active={editor.isActive("italic")}>
          <Italic size={15} />
        </Btn>
        <div className="mx-0.5 h-5 w-px bg-border" />
        <Btn label="Heading" on={() => c().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })}>
          <Heading2 size={16} />
        </Btn>
        <Btn label="Subheading" on={() => c().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })}>
          <Heading3 size={16} />
        </Btn>
        <div className="mx-0.5 h-5 w-px bg-border" />
        <Btn label="Bullet list" on={() => c().toggleBulletList().run()} active={editor.isActive("bulletList")}>
          <List size={16} />
        </Btn>
        <Btn label="Numbered list" on={() => c().toggleOrderedList().run()} active={editor.isActive("orderedList")}>
          <ListOrdered size={16} />
        </Btn>
        <Btn label="Quote" on={() => c().toggleBlockquote().run()} active={editor.isActive("blockquote")}>
          <Quote size={15} />
        </Btn>
      </div>
      <EditorContent editor={editor} className="px-3 py-2 text-sm" />
    </div>
  );
}
