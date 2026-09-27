import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BookOpen, HandHeart, Keyboard, NotebookPen, PanelRightOpen, Play, Search, SunMoon } from "lucide-react";
import { useUI } from "@/store/ui";
import { formatReference, parseReference } from "@/lib/reference";
import { refLabel } from "@/lib/osis";
import { useChapterNav } from "@/lib/useChapterNav";
import { isTypingTarget, MOD_K, overlayOpen } from "@/lib/shortcuts";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { NAV } from "./nav";

interface Command {
  id: string;
  label: string;
  group: "Go to" | "Actions" | "Pages" | "Search";
  icon: ReactNode;
  /** Extra words that should match ("home" for Dashboard). */
  keywords?: string;
  hint?: string;
  run: () => void;
}


const PAGES = NAV.map((n) => ({ path: n.to, label: n.label, icon: <n.icon size={16} />, keywords: n.keywords }));

/**
 * App-wide keyboard layer, mounted once in AppShell:
 *   Ctrl/⌘+K   command palette (go to a reference, pages, actions)
 *   ← → or [ ] previous / next chapter (Bible page)
 *   /          search
 *   ?          this list of shortcuts
 * Single-key shortcuts never fire while typing (inputs, the journal editor) or under
 * an open dialog; see src/lib/shortcuts.ts.
 */
export function KeyboardLayer() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { step } = useChapterNav();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);

  // Latest values for the one window listener.
  const live = useRef({ pathname, step, palette });
  live.current = { pathname, step, palette };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { pathname, step, palette } = live.current;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        // Leave the journal editor its own keys.
        if ((e.target as HTMLElement | null)?.closest?.(".ProseMirror, [contenteditable='true']")) return;
        e.preventDefault();
        setHelp(false);
        setPalette((o) => !o);
        return;
      }
      if (palette || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (isTypingTarget(e.target) || overlayOpen()) return;

      if (e.key === "?") {
        e.preventDefault();
        setHelp(true);
      } else if (e.key === "/") {
        e.preventDefault();
        if (pathname === "/search") document.getElementById("search-input")?.focus();
        else navigate("/search");
      } else if (pathname === "/bible" && !e.shiftKey) {
        if (e.key === "ArrowLeft" || e.key === "[") {
          e.preventDefault();
          step(-1);
        } else if (e.key === "ArrowRight" || e.key === "]") {
          e.preventDefault();
          step(1);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <>
      <CommandPalette open={palette} onOpenChange={setPalette} onHelp={() => setHelp(true)} />
      <ShortcutHelp open={help} onOpenChange={setHelp} />
    </>
  );
}

function CommandPalette({
  open,
  onOpenChange,
  onHelp,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onHelp: () => void;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const { activePlanId, readingPos, resolvedTheme, toggleTheme, toggleRail } = useUI();

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const q = query.trim();
  const commands = useMemo((): Command[] => {
    const go = (fn: () => void) => () => {
      onOpenChange(false);
      fn();
    };
    const out: Command[] = [];
    const ref = q ? parseReference(q) : null;
    if (ref) {
      out.push({
        id: "goto",
        group: "Go to",
        label: `Go to ${formatReference(ref)}`,
        icon: <BookOpen size={16} />,
        hint: "Enter",
        run: go(() => {
          const s = useUI.getState();
          s.setReturnTo(null);
          s.goTo(ref.ho, ref.chapter, ref.verse ?? null);
          navigate("/bible");
        }),
      });
    }
    const actions: Command[] = [
      ...(activePlanId
        ? [{ id: "today", group: "Actions" as const, label: "Start today's reading", icon: <Play size={16} />, keywords: "plan guided", run: go(() => navigate("/read-today")) }]
        : []),
      ...(readingPos
        ? [
            {
              id: "continue",
              group: "Actions" as const,
              label: `Continue reading ${refLabel(readingPos.ho, readingPos.chapter, readingPos.verse > 1 ? readingPos.verse : undefined)}`,
              icon: <BookOpen size={16} />,
              keywords: "resume bible",
              run: go(() => {
                const s = useUI.getState();
                s.setReturnTo(null);
                s.goTo(readingPos.ho, readingPos.chapter, readingPos.verse, { flash: false });
                navigate("/bible");
              }),
            },
          ]
        : []),
      { id: "new-prayer", group: "Actions", label: "New prayer", icon: <HandHeart size={16} />, keywords: "add pray request", run: go(() => navigate("/prayers?new=1")) },
      { id: "new-journal", group: "Actions", label: "New journal entry", icon: <NotebookPen size={16} />, keywords: "add write", run: go(() => navigate("/journal?new=1")) },
      {
        id: "theme",
        group: "Actions",
        label: resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        icon: <SunMoon size={16} />,
        keywords: "toggle theme dark light mode",
        run: go(toggleTheme),
      },
      ...(pathname === "/bible" || pathname.startsWith("/guided")
        ? [{ id: "rail", group: "Actions" as const, label: "Toggle study panel", icon: <PanelRightOpen size={16} />, keywords: "commentary cross references strongs rail", run: go(toggleRail) }]
        : []),
      { id: "help", group: "Actions", label: "Keyboard shortcuts", icon: <Keyboard size={16} />, hint: "?", keywords: "help keys", run: go(onHelp) },
    ];
    const pages: Command[] = PAGES.map((p) => ({
      id: `page:${p.path}`,
      group: "Pages",
      label: p.label,
      icon: p.icon,
      keywords: p.keywords,
      run: go(() => navigate(p.path)),
    }));
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (c: Command) => {
      const hay = `${c.label} ${c.keywords ?? ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    };
    // A bare book name ("pr" is Proverbs) still lets "Prayers" match below it.
    out.push(...[...actions, ...pages].filter((c) => !q || ((!ref || ref.bookOnly) && matches(c))));
    if (q.length >= 2 && !(ref && !ref.bookOnly)) {
      out.push({
        id: "search",
        group: "Search",
        label: `Search the Bible for “${q}”`,
        icon: <Search size={16} />,
        run: go(() => navigate(`/search?${new URLSearchParams({ q })}`)),
      });
    }
    return out;
  }, [q, activePlanId, readingPos, resolvedTheme, pathname, navigate, onOpenChange, onHelp, toggleTheme, toggleRail]);

  useEffect(() => setActive(0), [q]);
  const current = Math.min(active, Math.max(0, commands.length - 1));

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((current + 1) % Math.max(1, commands.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((current - 1 + commands.length) % Math.max(1, commands.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commands[current]?.run();
    }
  }

  let lastGroup = "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[12vh] max-w-xl -translate-y-0 gap-0 overflow-hidden p-0" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-4 pr-12">
          <Search size={18} className="shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Go to a reference (jn 3 16), a page or an action…"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={commands[current] ? `palette-${commands[current].id}` : undefined}
            aria-label="Command"
            className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div ref={listRef} id="palette-list" role="listbox" aria-label="Commands" className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
          {commands.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches.</p>}
          {commands.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && (
                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{header}</div>
                )}
                <div
                  id={`palette-${c.id}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === current}
                  onMouseMove={() => setActive(i)}
                  onClick={() => c.run()}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-sm",
                    i === current ? "bg-accent text-accent-foreground" : "text-foreground/90",
                  )}
                >
                  <span className="shrink-0 text-muted-foreground">{c.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.hint && <kbd className="shrink-0 rounded border border-border px-1.5 text-[11px] text-muted-foreground">{c.hint}</kbd>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <span>↑↓ to move</span>
          <span>Enter to open</span>
          <span>Esc to close</span>
          <span className="ml-auto">{MOD_K}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const SHORTCUTS: [string, string][] = [
  [MOD_K, "Command palette: go to a reference, a page or an action"],
  ["← / →", "Previous / next chapter (Bible)"],
  ["[ / ]", "Previous / next chapter (Bible)"],
  ["↑ / ↓", "Previous / next verse, once a verse has focus"],
  ["Enter / Space", "Open the actions for the focused verse"],
  ["/", "Search"],
  ["?", "Show these shortcuts"],
  ["Esc", "Close a dialog, panel or selection"],
];

function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>They pause while you are typing, so the journal and search boxes keep every key.</DialogDescription>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="whitespace-nowrap rounded border border-border bg-muted px-2 py-0.5 font-sans text-xs">{k}</kbd>
              </dt>
              <dd className="text-muted-foreground">{d}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
