import { lazy, Suspense, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, KeyRound, Lock } from "lucide-react";
import { FREE_TRANSLATIONS, translationById, type Translation } from "@/data/bible";
import { ESV_TRANSLATION, NLT_TRANSLATION, licensedTranslations } from "@/data/licensed";
import { AMP_NOTE, NASB_NOTE } from "@/data/licensed/catalog";
import { useUI } from "@/store/ui";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { SetupProvider } from "@/data/licensed/setupGuide";

// The guided key setup, loaded only when a locked row is tapped.
const KeySetupDialog = lazy(() => import("@/components/settings/KeySetupDialog").then((m) => ({ default: m.KeySetupDialog })));

/** The link that opens Settings at the Bible translations card. */
export const TRANSLATION_SETTINGS = "/settings?section=translations";

export function TranslationPicker() {
  const { translation, setTranslation } = useUI();
  // Re-render when a key or the API.Bible list changes.
  useUI((s) => s.bibleKeys);
  useUI((s) => s.apiBibleBibles);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [setup, setSetup] = useState<SetupProvider | null>(null);
  const current = translationById(translation) ?? FREE_TRANSLATIONS[0];
  const licensed = licensedTranslations();
  const hasEsv = licensed.some((t) => t.id === ESV_TRANSLATION.id);
  const hasNlt = licensed.some((t) => t.id === NLT_TRANSLATION.id);
  const hasNasb = licensed.some((t) => /^NASB/i.test(t.short));
  const hasAmp = licensed.some((t) => /^AMP/i.test(t.short));

  const pick = (t: Translation) => {
    setTranslation(t.id);
    setOpen(false);
  };
  const toSettings = () => {
    setOpen(false);
    navigate(TRANSLATION_SETTINGS);
  };
  const startSetup = (p: SetupProvider) => {
    setOpen(false);
    setSetup(p);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 font-semibold" aria-label={`Translation: ${current.name}`}>
          {current.short}
          <ChevronDown size={14} className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[min(70vh,34rem)] w-80 overflow-y-auto p-1">
        <GroupLabel>Free to read</GroupLabel>
        {FREE_TRANSLATIONS.map((t) => (
          <Row key={t.id} t={t} selected={t.id === translation} onPick={() => pick(t)}>
            {t.bundled && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">offline</span>
            )}
          </Row>
        ))}

        <GroupLabel>With your own key</GroupLabel>
        {licensed.map((t) => (
          <Row key={t.id} t={t} selected={t.id === translation} onPick={() => pick(t)}>
            <KeyRound size={12} className="text-muted-foreground" aria-label="Uses your key" />
          </Row>
        ))}
        {!hasEsv && (
          <LockedRow short="ESV" name="English Standard Version" note="Get a free ESV key: we’ll walk you through it" onClick={() => startSetup("esv")} />
        )}
        {!hasNlt && (
          <LockedRow short="NLT" name="New Living Translation" note="Get a free NLT key: we’ll walk you through it" onClick={() => startSetup("nlt")} />
        )}
        {!hasNasb && (
          <LockedRow short="NASB" name="New American Standard Bible" note={NASB_NOTE} onClick={() => startSetup("apiBible")} />
        )}
        {!hasAmp && (
          <LockedRow short="AMP" name="Amplified Bible" note={AMP_NOTE} onClick={() => startSetup("apiBible")} />
        )}
        <button
          onClick={toSettings}
          className="mt-1 w-full rounded-md px-2 py-2 text-left text-xs text-primary-700 hover:bg-accent dark:text-primary-400"
        >
          Manage keys and licensed translations…
        </button>
      </PopoverContent>
      {setup && (
        <Suspense fallback={null}>
          <KeySetupDialog provider={setup} open onOpenChange={(o) => !o && setSetup(null)} />
        </Suspense>
      )}
    </Popover>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1 border-t border-border px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground first:mt-0 first:border-t-0 first:pt-1">
      {children}
    </div>
  );
}

function Row({ t, selected, onPick, children }: { t: Translation; selected: boolean; onPick: () => void; children?: ReactNode }) {
  return (
    <button
      onClick={onPick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
        selected && "bg-accent",
      )}
    >
      <span className="w-11 shrink-0 truncate text-xs font-semibold text-primary-700 dark:text-primary-400">{t.short}</span>
      <span className="flex-1">
        {t.name}
        {t.scope && <span className="text-xs text-muted-foreground"> · {t.scope}</span>}
      </span>
      {children}
      {selected && <Check size={15} className="text-primary-700 dark:text-primary-400" />}
    </button>
  );
}

function LockedRow({ short, name, note, onClick }: { short: string; name: string; note: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
    >
      <span className="w-11 shrink-0 pt-0.5 text-xs font-semibold text-muted-foreground">{short}</span>
      <span className="flex-1">
        <span className="text-muted-foreground">{name}</span>
        <span className="block text-xs text-muted-foreground/80">{note}</span>
      </span>
      <Lock size={13} className="mt-1 text-muted-foreground" />
    </button>
  );
}
