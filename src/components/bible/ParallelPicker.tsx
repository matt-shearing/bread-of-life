import { useState } from "react";
import { Check, Columns2 } from "lucide-react";
import { AVAILABLE_TRANSLATIONS, translationById } from "@/data/bible";
import { useUI } from "@/store/ui";
import { Button, Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";

export function ParallelPicker() {
  const { translation, parallel, setParallel } = useUI();
  const [open, setOpen] = useState(false);
  const active = !!parallel;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip label="Compare translations">
        <PopoverTrigger asChild>
          <Button
            variant={active ? "secondary" : "ghost"}
            size="sm"
            className="gap-1"
            aria-label="Compare translations"
          >
            <Columns2 style={{ width: 16, height: 16 }} />
            {active && <span className="text-xs font-semibold">{translationById(parallel)?.short}</span>}
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-64 p-1">
        <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Compare with
        </div>
        <button
          onClick={() => {
            setParallel(null);
            setOpen(false);
          }}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
            !parallel && "bg-accent",
          )}
        >
          <span className="flex-1 text-muted-foreground">Off (single column)</span>
          {!parallel && <Check style={{ width: 15, height: 15 }} className="text-primary-600" />}
        </button>
        {AVAILABLE_TRANSLATIONS.filter((t) => t.id !== translation).map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setParallel(t.id);
              setOpen(false);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
              t.id === parallel && "bg-accent",
            )}
          >
            <span className="w-10 shrink-0 text-xs font-semibold text-primary-600">{t.short}</span>
            <span className="flex-1">{t.name}</span>
            {t.id === parallel && <Check style={{ width: 15, height: 15 }} className="text-primary-600" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
