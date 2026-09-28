import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { SyncSettings } from "@/components/settings/SyncSettings";
import { E2ESettings } from "@/components/settings/E2ESettings";
import { MisslerSettings } from "@/components/settings/MisslerSettings";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { CommentarySettings } from "@/components/settings/CommentarySettings";
import { ReminderSettings } from "@/components/settings/ReminderSettings";
import { AISettings } from "@/components/settings/AISettings";
import { BibleKeysSettings } from "@/components/settings/BibleKeysSettings";
import { AboutSettings, FeedbackSettings } from "@/components/settings/FeedbackSettings";
import { DataSettings } from "@/components/settings/DataSettings";
import { PageHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

/** The sections, in page order; the index beside (or above) them jumps to each. */
const SECTIONS = [
  { id: "appearance", label: "Appearance" },
  { id: "translations", label: "Bible translations" },
  { id: "commentary", label: "Commentary" },
  { id: "reminders", label: "Reminders" },
  { id: "companion", label: "AI companion" },
  { id: "missler", label: "MI library" },
  { id: "sync", label: "Sync" },
  { id: "encryption", label: "Encryption" },
  { id: "data", label: "Your data" },
  { id: "feedback", label: "Feedback" },
  { id: "about", label: "About" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsPage() {
  const [active, pick] = useActiveSection();
  // `?section=translations` (from the translation picker) opens at that card.
  const [params] = useSearchParams();
  const wanted = params.get("section");
  useEffect(() => {
    const s = SECTIONS.find((x) => x.id === wanted);
    if (!s) return;
    pick(s.id);
    const raf = window.requestAnimationFrame(() => jumpTo(s.id));
    return () => window.cancelAnimationFrame(raf);
  }, [wanted, pick]);

  return (
    <div id="settings-scroll" className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-6 md:grid md:max-w-5xl md:grid-cols-[10.5rem_minmax(0,42rem)] md:gap-8 md:px-8 md:py-8">
        <div className="md:col-span-2">
          <PageHeader title="Settings" />
        </div>

        <SectionIndex active={active} onPick={pick} />

        <div className="space-y-4">
          <Section id="appearance">
            <AppearanceSettings />
          </Section>
          <Section id="translations">
            <BibleKeysSettings />
          </Section>
          <Section id="commentary">
            <CommentarySettings />
          </Section>
          <Section id="reminders">
            <ReminderSettings />
          </Section>
          <Section id="companion">
            <AISettings />
          </Section>
          <Section id="missler">
            <MisslerSettings />
          </Section>
          <Section id="sync">
            <SyncSettings />
          </Section>
          <Section id="encryption">
            <E2ESettings />
          </Section>

          <Section id="data">
            <DataSettings />
          </Section>

          <Section id="feedback">
            <FeedbackSettings />
          </Section>
          <Section id="about">
            <AboutSettings />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  return (
    <section id={`settings-${id}`} data-settings-section={id} tabIndex={-1} className="scroll-mt-4 md:scroll-mt-8">
      {children}
    </section>
  );
}

function jumpTo(id: SectionId) {
  const el = document.getElementById(`settings-${id}`);
  if (!el) return;
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  el.focus({ preventScroll: true });
}

/** A list of the sections: a sticky column beside them on the Fold and desktop, a
 *  scrolling row of chips above them on a phone. */
function SectionIndex({ active, onPick }: { active: SectionId; onPick: (id: SectionId) => void }) {
  return (
    <nav aria-label="Settings sections" className="mb-4 md:mb-0">
      <ul className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:sticky md:top-8 md:mx-0 md:flex-col md:gap-0.5 md:overflow-visible md:px-0">
        {SECTIONS.map((s) => (
          <li key={s.id} className="shrink-0">
            <button
              type="button"
              onClick={() => {
                onPick(s.id);
                jumpTo(s.id);
              }}
              aria-current={active === s.id ? "true" : undefined}
              className={cn(
                "whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors md:w-full md:rounded-md md:border-transparent md:px-3 md:py-2 md:text-left [@media(pointer:coarse)]:min-h-11",
                active === s.id
                  ? "border-primary/40 bg-primary/10 font-medium text-primary-700 dark:text-primary-300"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The section nearest the top of the scroller, for the index's highlight. A picked
 *  section stays highlighted while the jump scrolls (short last sections never reach
 *  the top). */
function useActiveSection(): [SectionId, (id: SectionId) => void] {
  const [active, setActive] = useState<SectionId>("appearance");
  const pickedAt = useRef(0);
  useEffect(() => {
    const root = document.getElementById("settings-scroll");
    if (!root) return;
    const onScroll = () => {
      if (Date.now() - pickedAt.current < 1000) return;
      const top = root.getBoundingClientRect().top;
      let current: SectionId = SECTIONS[0].id;
      for (const el of root.querySelectorAll<HTMLElement>("[data-settings-section]")) {
        if (el.getBoundingClientRect().top - top <= 96) current = el.dataset.settingsSection as SectionId;
      }
      setActive(current);
    };
    onScroll();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, []);
  const pick = useCallback((id: SectionId) => {
    pickedAt.current = Date.now();
    setActive(id);
  }, []);
  return [active, pick];
}
