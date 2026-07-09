import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { TRANSLATIONS } from "@/data/bible";
import { useUI } from "@/store/ui";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@/components/ui";
import { cn } from "@/lib/cn";

export function TranslationPicker() {
  const { translation, setTranslation } = useUI();
  const [open, setOpen] = useState(false);
  const current = TRANSLATIONS.find((t) => t.id === translation) ?? TRANSLATIONS[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 font-semibold">
          {current.short}
          <ChevronDown style={{ width: 14, height: 14 }} className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        {TRANSLATIONS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTranslation(t.id);
              setOpen(false);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
              t.id === translation && "bg-accent",
            )}
          >
            <span className="w-10 shrink-0 text-xs font-semibold text-primary-600">{t.short}</span>
            <span className="flex-1">{t.name}</span>
            {t.bundled && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">offline</span>
            )}
            {t.id === translation && <Check style={{ width: 15, height: 15 }} className="text-primary-600" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
