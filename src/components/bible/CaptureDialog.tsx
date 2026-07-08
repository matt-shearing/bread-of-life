import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Textarea,
} from "@/components/ui";
import { addJournalEntry } from "@/db/repos";
import { addPrayer } from "@/db/repos";
import { toOsis } from "@/lib/osis";

interface Props {
  mode: "journal" | "prayer" | null;
  ho: string;
  chapter: number;
  verse: number;
  verseText: string;
  label: string; // "John 3:16"
  onClose: () => void;
}

/** Universal capture: turn a verse into a journal entry or a prayer. This is the
 *  cross-module connective tissue the "homebase" idea is built on. */
export function CaptureDialog({ mode, ho, chapter, verse, verseText, label, onClose }: Props) {
  const [title, setTitle] = useState(mode === "journal" ? `Reflection on ${label}` : "");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const osis = toOsis(ho, chapter, verse);

  async function submit() {
    setBusy(true);
    if (mode === "journal") {
      await addJournalEntry({
        title,
        body,
        linkedOsis: [osis],
        tags: ["scripture"],
        source: "bible",
      });
    } else if (mode === "prayer") {
      await addPrayer({ title: title || label, body, linkedOsis: [osis], category: "personal" });
    }
    setBusy(false);
    onClose();
  }

  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>{mode === "journal" ? "New journal entry" : "Pray about this"}</DialogTitle>
        <DialogDescription>
          Linked to <span className="font-medium text-foreground">{label}</span> (BSB)
        </DialogDescription>

        <blockquote className="rounded-md border-l-2 border-primary bg-primary-50 px-3 py-2 font-serif text-sm italic text-foreground dark:bg-primary/10">
          “{verseText}”
        </blockquote>

        <div className="space-y-2">
          <Input
            placeholder={mode === "journal" ? "Title" : "What are you praying for?"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea
            placeholder={mode === "journal" ? "Write your reflection…" : "Add any details (optional)"}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || (mode === "prayer" && !title.trim())}>
            {mode === "journal" ? "Save entry" : "Add prayer"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
