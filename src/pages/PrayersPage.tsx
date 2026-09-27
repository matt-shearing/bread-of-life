import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellRing,
  Check,
  CheckCircle2,
  HandHeart,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { db, type JournalEntry, type Prayer, type PrayerCategory } from "@/db";
import {
  addCustomPrayerCategory,
  addPrayer,
  archivePrayer,
  deletePrayer,
  getCustomPrayerCategories,
  linkJournalPrayer,
  markAnswered,
  prayedFor,
  removeCustomPrayerCategory,
  reopenPrayer,
  restorePrayer,
  toggleRemind,
  unlinkJournalPrayer,
  updatePrayer,
} from "@/db/repos";
import { syncNow, getSyncStatus } from "@/db/sync";
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Textarea,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { localDayKey } from "@/lib/day";
import { COARSE_H, showUndoToast, useConfirm } from "@/components/confirm";
import { PrayThroughButton } from "@/components/prayers/PrayThrough";

type Tab = "active" | "answered" | "archived";

/** Touch screens get 44px targets; mouse users keep the compact size. */
const CHIP_TOUCH = "[@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:px-3.5";

function prayedToday(p: Prayer) {
  return !!p.lastPrayedAt && localDayKey(p.lastPrayedAt) === localDayKey();
}

const BUILTIN_CATEGORIES: { key: string; label: string }[] = [
  { key: "personal", label: "Personal" },
  { key: "family", label: "Family" },
  { key: "community", label: "Community" },
  { key: "thanksgiving", label: "Thanksgiving" },
  { key: "world", label: "World" },
];

const CAT_COLOR: Record<string, string> = {
  personal: "border-primary/40 text-primary-700 dark:text-primary-300",
  family: "border-rose-300 text-rose-600",
  community: "border-sky-300 text-sky-600",
  thanksgiving: "border-emerald-300 text-emerald-600",
  world: "border-violet-300 text-violet-600",
};

/** Built-ins get their signature colour; custom categories fall back to a warm neutral. */
function catColor(category: string): string {
  return CAT_COLOR[category] ?? "border-amber-300 text-amber-700 dark:text-amber-300";
}

/** Title-case a raw category key for display (custom ones are stored as typed). */
function catLabel(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function daysSince(ts: number) {
  return Math.max(1, Math.round((Date.now() - ts) / 86_400_000));
}

const PULL_THRESHOLD = 64; // px pulled before a release triggers a sync
const PULL_MAX = 96;

export function PrayersPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("active");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Prayer | null>(null);
  const [answering, setAnswering] = useState<Prayer | null>(null);
  const { confirm, confirmElement } = useConfirm();
  // Guards against a double tap counting twice before the first write lands.
  const lastPrayedTap = useRef<Record<string, number>>({});
  const [params, setParams] = useSearchParams();
  const [focusId, setFocusId] = useState<string | null>(null);

  // Lightweight touch pull-to-refresh (mobile): pull down at the top to force a sync.
  const scrollRef = useRef<HTMLDivElement>(null);
  const pullStartY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onTouchStart = (e: React.TouchEvent) => {
    const el = scrollRef.current;
    if (!el || el.scrollTop > 0 || refreshing) {
      pullStartY.current = null;
      return;
    }
    pullStartY.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (pullStartY.current == null) return;
    const dy = e.touches[0].clientY - pullStartY.current;
    setPull(dy > 0 ? Math.min(PULL_MAX, dy * 0.5) : 0);
  };
  const onTouchEnd = async () => {
    if (pullStartY.current == null) return;
    pullStartY.current = null;
    if (pull >= PULL_THRESHOLD && !refreshing) {
      // Local-only (not signed in): there's nothing to pull, so don't flash a
      // spinner that does nothing — just release the pull.
      if ((await getSyncStatus()).mode === "off") {
        setPull(0);
        return;
      }
      setRefreshing(true);
      setPull(PULL_THRESHOLD);
      try {
        await syncNow();
      } finally {
        setRefreshing(false);
        setPull(0);
      }
    } else {
      setPull(0);
    }
  };

  const prayers = useLiveQuery(() => db.prayers.orderBy("createdAt").reverse().toArray(), [], []);

  // Deep-link: /prayers?focus=<id> scrolls to and highlights that prayer (used by
  // cross-references from journal entries and the Bible study rail).
  useEffect(() => {
    const focus = params.get("focus");
    if (!focus) return;
    const target = prayers?.find((p) => p.id === focus);
    if (!target) return; // wait until prayers load
    setTab(target.status === "answered" ? "answered" : target.status === "archived" ? "archived" : "active");
    setFocusId(focus);
    params.delete("focus");
    setParams(params, { replace: true });
    const t = setTimeout(() => {
      document.getElementById(`prayer-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    return () => clearTimeout(t);
  }, [params, prayers, setParams]);

  // Fade the highlight ring a couple of seconds after it appears.
  useEffect(() => {
    if (!focusId) return;
    const clear = setTimeout(() => setFocusId(null), 2400);
    return () => clearTimeout(clear);
  }, [focusId]);

  const stats = useMemo(() => {
    const all = prayers ?? [];
    const answered = all.filter((p) => p.status === "answered");
    const active = all.filter((p) => p.status === "active");
    const archived = all.filter((p) => p.status === "archived");
    const earliest = all.length ? Math.min(...all.map((p) => p.createdAt)) : Date.now();
    return {
      active: active.length,
      answered: answered.length,
      archived: archived.length,
      daysPraying: daysSince(earliest),
      answeredRate: all.length ? Math.round((answered.length / (active.length + answered.length || 1)) * 100) : 0,
    };
  }, [prayers]);

  // Leave the Archived tab once the last archived prayer is restored or deleted.
  useEffect(() => {
    if (tab === "archived" && prayers && stats.archived === 0) setTab("active");
  }, [tab, prayers, stats.archived]);

  const list = (prayers ?? []).filter((p) => p.status === tab);

  async function onPrayed(p: Prayer) {
    const now = Date.now();
    if (now - (lastPrayedTap.current[p.id] ?? 0) < 1500) return; // an accidental double tap
    lastPrayedTap.current[p.id] = now;
    const again = prayedToday(p);
    const previous = await prayedFor(p.id);
    if (!previous) return;
    const count = previous.prayedCount + 1;
    showUndoToast({
      message: again
        ? `Prayed again — ${count} times in all`
        : `Prayed for “${p.title}” · ${count} ${count === 1 ? "time" : "times"}`,
      onUndo: () => updatePrayer(p.id, previous),
    });
  }

  async function onArchive(p: Prayer) {
    await archivePrayer(p.id);
    showUndoToast({
      message: `Archived “${p.title}”. Find it under Archived.`,
      onUndo: () => updatePrayer(p.id, { status: "active" }),
    });
  }

  async function onRestore(p: Prayer) {
    await updatePrayer(p.id, { status: "active" });
    showUndoToast({
      message: `“${p.title}” is back in your active prayers`,
      onUndo: () => updatePrayer(p.id, { status: "archived" }),
    });
  }

  async function onReopen(p: Prayer) {
    const previous = { status: p.status, answeredAt: p.answeredAt, answerNote: p.answerNote };
    await reopenPrayer(p.id);
    showUndoToast({
      message: `“${p.title}” is active again`,
      onUndo: () => updatePrayer(p.id, previous),
    });
  }

  async function onDelete(p: Prayer) {
    const canArchive = p.status === "active";
    const choice = await confirm({
      title: "Delete this prayer?",
      description: canArchive
        ? "It will be removed along with its history. To keep it but put it out of sight, archive it instead."
        : p.status === "answered"
          ? "It will be removed from your answered-prayer log along with how God answered it."
          : "It will be removed along with its history.",
      confirmLabel: "Delete",
      destructive: true,
      extraLabel: canArchive ? "Archive instead" : undefined,
    });
    if (choice === "extra") return onArchive(p);
    if (choice !== "confirm") return;
    const snapshot = (await db.prayers.get(p.id)) ?? p;
    await deletePrayer(p.id);
    showUndoToast({ message: "Prayer deleted", onUndo: () => restorePrayer(snapshot) });
  }

  return (
    <div
      ref={scrollRef}
      className="relative h-full overflow-y-auto"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={() => void onTouchEnd()}
    >
      {/* pull-to-refresh indicator */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center overflow-hidden"
        style={{ height: pull }}
      >
        <div className="flex items-end pb-1 text-muted-foreground">
          <RotateCcw
            style={{ width: 18, height: 18, transform: `rotate(${pull * 3}deg)` }}
            className={cn(refreshing && "animate-spin", pull >= PULL_THRESHOLD && "text-primary")}
          />
        </div>
      </div>
      <div
        className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8"
        style={{
          transform: pull ? `translateY(${pull}px)` : undefined,
          transition: refreshing || pull === 0 ? "transform 0.2s ease" : undefined,
        }}
      >
        <div className="mb-6 flex items-center gap-3">
          <div>
            <h1 className="font-serif text-3xl font-bold">Prayers</h1>
            <p className="text-sm text-muted-foreground">
              Bring your requests to God — and look back on what He has done.
            </p>
          </div>
          <Button className="ml-auto shrink-0 whitespace-nowrap" onClick={() => setAdding(true)}>
            <Plus style={{ width: 16, height: 16 }} /> New prayer
          </Button>
        </div>

        {/* stats — only once there is something to count */}
        {stats.active + stats.answered > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="prayer-stats">
            <Stat label="Active" value={stats.active} />
            <Stat label="Answered" value={stats.answered} accent />
            <Stat label="Days praying" value={stats.daysPraying} />
            <Stat label="Answered %" value={`${stats.answeredRate}%`} />
          </div>
        )}

        <PrayThroughButton className="mb-4" />

        {/* tabs */}
        <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Prayer lists">
          <TabBtn active={tab === "active"} onClick={() => setTab("active")}>
            <HandHeart style={{ width: 16, height: 16 }} className="hidden min-[400px]:block" /> Active ({stats.active})
          </TabBtn>
          <TabBtn active={tab === "answered"} onClick={() => setTab("answered")}>
            <Sparkles style={{ width: 16, height: 16 }} className="hidden min-[400px]:block" /> Answered ({stats.answered})
          </TabBtn>
          {(stats.archived > 0 || tab === "archived") && (
            <TabBtn active={tab === "archived"} onClick={() => setTab("archived")}>
              <Archive style={{ width: 16, height: 16 }} className="hidden min-[400px]:block" /> Archived ({stats.archived})
            </TabBtn>
          )}
        </div>

        {tab === "answered" && stats.answered > 0 && (
          <button
            onClick={() => navigate("/faithfulness")}
            className="mb-4 flex w-full items-center gap-2 rounded-lg border border-success/30 bg-success/5 px-4 py-2.5 text-sm font-medium text-success hover:bg-success/10"
          >
            <Sparkles style={{ width: 16, height: 16 }} />
            Faithfulness review — look back over how God has answered
            <span className="ml-auto shrink-0 text-xs opacity-70">Open →</span>
          </button>
        )}

        {list.length === 0 ? (
          <EmptyState tab={tab} onAdd={() => setAdding(true)} />
        ) : (
          <div className="space-y-3">
            {list.map((p) => (
              <PrayerCard
                key={p.id}
                p={p}
                focused={focusId === p.id}
                onPrayed={() => void onPrayed(p)}
                onAnswer={() => setAnswering(p)}
                onReopen={() => void onReopen(p)}
                onArchive={() => void onArchive(p)}
                onRestore={() => void onRestore(p)}
                onEdit={() => setEditing(p)}
                onDelete={() => void onDelete(p)}
              />
            ))}
          </div>
        )}
      </div>

      {adding && <PrayerDialog onClose={() => setAdding(false)} />}
      {editing && <PrayerDialog prayer={editing} onClose={() => setEditing(null)} />}
      {confirmElement}
      {answering && <AnswerDialog prayer={answering} onClose={() => setAnswering(null)} />}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <Card className={cn("p-4", accent && "border-success/40 bg-success/5")}>
      <div className={cn("text-2xl font-bold", accent && "text-success")}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex min-h-[40px] min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-2 text-sm font-medium transition-colors [@media(pointer:coarse)]:min-h-[44px]",
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function PrayerCard({
  p,
  focused,
  onPrayed,
  onAnswer,
  onReopen,
  onArchive,
  onRestore,
  onEdit,
  onDelete,
}: {
  p: Prayer;
  focused?: boolean;
  onPrayed: () => void;
  onAnswer: () => void;
  onReopen: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const navigate = useNavigate();
  const [linking, setLinking] = useState(false);
  const answered = p.status === "answered";
  const archived = p.status === "archived";
  const active = p.status === "active";
  const doneToday = active && prayedToday(p);
  const linkedJournals = useLiveQuery(
    () =>
      p.linkedJournalIds?.length
        ? db.journal.where("id").anyOf(p.linkedJournalIds).toArray()
        : Promise.resolve([] as JournalEntry[]),
    [p.linkedJournalIds?.join(",")],
    [] as JournalEntry[],
  );

  return (
    <Card
      id={`prayer-${p.id}`}
      data-testid="prayer-card"
      className={cn(
        "p-4 transition-shadow",
        answered && "border-success/30 bg-success/5",
        archived && "bg-muted/40",
        focused && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 break-words font-semibold">{p.title}</h3>
            <Badge className={cn("bg-transparent", catColor(p.category))}>{catLabel(p.category)}</Badge>
          </div>
        </div>
        {active && (
          <button
            type="button"
            onClick={() => toggleRemind(p.id, !p.remind)}
            aria-label={p.remind ? `Daily reminder on for ${p.title}. Turn off` : `Remind me daily about ${p.title}`}
            aria-pressed={!!p.remind}
            title={p.remind ? "Daily reminder on" : "Remind me daily"}
            className="-my-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          >
            {p.remind ? (
              <BellRing style={{ width: 16, height: 16 }} className="text-primary-600" />
            ) : (
              <Bell style={{ width: 16, height: 16 }} className="text-muted-foreground" />
            )}
          </button>
        )}
        <PrayerMenu
          p={p}
          onEdit={onEdit}
          onArchive={onArchive}
          onReopen={onReopen}
          onRestore={onRestore}
          onDelete={onDelete}
        />
      </div>

      {p.body && <p className="mt-1 whitespace-pre-line break-words text-sm text-muted-foreground">{p.body}</p>}

      {answered ? (
        <div className="mt-3 rounded-md border border-success/30 bg-success/10 p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-success">
            <Sparkles style={{ width: 14, height: 14 }} /> Answered · {new Date(p.answeredAt!).toLocaleDateString()}
          </div>
          {p.answerNote && <p className="mt-1 whitespace-pre-line text-sm">{p.answerNote}</p>}
        </div>
      ) : (
        <div className="mt-2 text-xs text-muted-foreground" data-testid="prayed-count">
          {archived && "Archived · "}
          Prayed {p.prayedCount} {p.prayedCount === 1 ? "time" : "times"}
          {p.lastPrayedAt ? ` · last ${new Date(p.lastPrayedAt).toLocaleDateString()}` : ""}
        </div>
      )}

      {/* journal cross-references */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {(linkedJournals ?? []).map((j: JournalEntry) => (
          <button
            key={j.id}
            type="button"
            onClick={() => navigate(`/journal?open=${j.id}`)}
            className={cn(
              "inline-flex min-h-[28px] max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs text-primary-700 hover:bg-primary/10 dark:text-primary-300",
              CHIP_TOUCH,
            )}
          >
            <NotebookPen style={{ width: 11, height: 11 }} className="shrink-0" />
            <span className="truncate">{j.title.trim() || "Untitled entry"}</span>
          </button>
        ))}
        {!archived && (
          <button
            type="button"
            onClick={() => setLinking(true)}
            className={cn(
              "inline-flex min-h-[28px] items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent",
              CHIP_TOUCH,
            )}
          >
            <Plus style={{ width: 11, height: 11 }} /> Link a journal entry
          </button>
        )}
      </div>

      {/* actions — a row under the text, so the title keeps the card's full width */}
      {!answered && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          {active ? (
            <>
              <Button
                size="sm"
                variant={doneToday ? "outline" : "secondary"}
                className={cn(COARSE_H, doneToday && "border-success/40 text-success")}
                onClick={onPrayed}
                data-testid="prayed-button"
                aria-label={doneToday ? `Prayed today for ${p.title}. Pray again` : `Prayed for ${p.title}`}
              >
                {doneToday ? (
                  <>
                    <Check style={{ width: 14, height: 14 }} /> Prayed today
                  </>
                ) : (
                  <>
                    <HandHeart style={{ width: 14, height: 14 }} /> Prayed
                  </>
                )}
              </Button>
              <Button size="sm" variant="success" className={COARSE_H} onClick={onAnswer}>
                <CheckCircle2 style={{ width: 14, height: 14 }} /> Answered
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" className={COARSE_H} onClick={onRestore} data-testid="restore-button">
              <ArchiveRestore style={{ width: 14, height: 14 }} /> Restore
            </Button>
          )}
        </div>
      )}

      {linking && (
        <JournalLinkPicker
          prayerId={p.id}
          linkedIds={p.linkedJournalIds ?? []}
          onClose={() => setLinking(false)}
        />
      )}
    </Card>
  );
}

const MENU_ITEM =
  "flex cursor-pointer select-none items-center gap-2 rounded-sm px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent [@media(pointer:coarse)]:min-h-[44px]";

function PrayerMenu({
  p,
  onEdit,
  onArchive,
  onReopen,
  onRestore,
  onDelete,
}: {
  p: Prayer;
  onEdit: () => void;
  onArchive: () => void;
  onReopen: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    // Non-modal so a dialog opened from an item gets focus and pointer events cleanly.
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        aria-label={`More actions for ${p.title}`}
        data-testid="prayer-menu"
        className="-my-1 -mr-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
      >
        <MoreHorizontal style={{ width: 18, height: 18 }} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-[11rem] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg animate-fade-in"
        >
          <DropdownMenu.Item className={MENU_ITEM} onSelect={onEdit}>
            <Pencil style={{ width: 15, height: 15 }} /> Edit
          </DropdownMenu.Item>
          {p.status === "active" && (
            <DropdownMenu.Item className={MENU_ITEM} onSelect={onArchive}>
              <Archive style={{ width: 15, height: 15 }} /> Archive
            </DropdownMenu.Item>
          )}
          {p.status === "answered" && (
            <DropdownMenu.Item className={MENU_ITEM} onSelect={onReopen}>
              <RotateCcw style={{ width: 15, height: 15 }} /> Reopen as active
            </DropdownMenu.Item>
          )}
          {p.status === "archived" && (
            <DropdownMenu.Item className={MENU_ITEM} onSelect={onRestore}>
              <ArchiveRestore style={{ width: 15, height: 15 }} /> Restore
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className={cn(MENU_ITEM, "text-destructive")} onSelect={onDelete}>
            <Trash2 style={{ width: 15, height: 15 }} /> Delete…
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function JournalLinkPicker({
  prayerId,
  linkedIds,
  onClose,
}: {
  prayerId: string;
  linkedIds: string[];
  onClose: () => void;
}) {
  const entries = useLiveQuery(() => db.journal.orderBy("updatedAt").reverse().toArray(), [], []);
  const linked = new Set(linkedIds);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>Link a journal entry</DialogTitle>
        {(entries ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">You have no journal entries yet.</p>
        ) : (
          <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
            {(entries ?? []).map((j) => {
              const on = linked.has(j.id);
              return (
                <button
                  key={j.id}
                  onClick={() =>
                    on ? unlinkJournalPrayer(j.id, prayerId) : linkJournalPrayer(j.id, prayerId)
                  }
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md border p-2.5 text-left transition-colors",
                    on ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
                  )}
                >
                  <NotebookPen
                    style={{ width: 15, height: 15 }}
                    className={on ? "text-primary-600" : "text-muted-foreground"}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{j.title}</span>
                  {on && <span className="text-xs text-primary-600">Linked</span>}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ tab, onAdd }: { tab: Tab; onAdd: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-3 p-10 text-center">
      {tab === "active" ? (
        <>
          <HandHeart style={{ width: 32, height: 32 }} className="text-primary-500" />
          <p className="text-muted-foreground">No active prayers yet.</p>
          <Button onClick={onAdd}>
            <Plus style={{ width: 16, height: 16 }} /> Add your first prayer
          </Button>
        </>
      ) : tab === "archived" ? (
        <>
          <Archive style={{ width: 32, height: 32 }} className="text-muted-foreground" />
          <p className="text-muted-foreground">Nothing archived.</p>
        </>
      ) : (
        <>
          <Sparkles style={{ width: 32, height: 32 }} className="text-success" />
          <p className="text-muted-foreground">
            When God answers a prayer, mark it answered — this is where you’ll see what He has done.
          </p>
        </>
      )}
    </Card>
  );
}

/** New prayer, or edit an existing one when `prayer` is given. */
function PrayerDialog({ prayer, onClose }: { prayer?: Prayer; onClose: () => void }) {
  const editing = !!prayer;
  const [title, setTitle] = useState(prayer?.title ?? "");
  const [body, setBody] = useState(prayer?.body ?? "");
  const [category, setCategory] = useState<PrayerCategory>(prayer?.category ?? "personal");
  const [remind, setRemind] = useState(prayer?.remind ?? false);
  const [answerNote, setAnswerNote] = useState(prayer?.answerNote ?? "");
  const [saving, setSaving] = useState(false);
  const titleId = useId();
  const bodyId = useId();
  const noteId = useId();
  const [addingCat, setAddingCat] = useState(false);
  const [newCat, setNewCat] = useState("");
  const newCatRef = useRef<HTMLInputElement>(null);

  const customCategories = useLiveQuery(() => getCustomPrayerCategories(), [], []);
  const categories: { key: string; label: string; custom: boolean }[] = [
    ...BUILTIN_CATEGORIES.map((c) => ({ ...c, custom: false })),
    ...(customCategories ?? []).map((c) => ({ key: c, label: catLabel(c), custom: true })),
  ];
  // A prayer can carry a custom category that has since been removed from the list.
  if (!categories.some((c) => c.key === category)) {
    categories.push({ key: category, label: catLabel(category), custom: false });
  }

  async function submit() {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      if (prayer) {
        await updatePrayer(prayer.id, {
          title: title.trim(),
          body: body.trim(),
          category,
          remind,
          ...(prayer.status === "answered" ? { answerNote: answerNote.trim() || null } : {}),
        });
        showUndoToast({ message: "Prayer updated" });
      } else {
        await addPrayer({ title, body, category, remind });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (addingCat) newCatRef.current?.focus();
  }, [addingCat]);

  const commitNewCat = async () => {
    const name = newCat.trim();
    if (!name) {
      setAddingCat(false);
      return;
    }
    const next = await addCustomPrayerCategory(name);
    const match = next.find((c) => c.toLowerCase() === name.toLowerCase());
    if (match) setCategory(match);
    setNewCat("");
    setAddingCat(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>{editing ? "Edit prayer" : "New prayer"}</DialogTitle>
        <DialogDescription>
          {editing ? "Change the wording, category or reminder." : "What would you like to bring before God?"}
        </DialogDescription>
        <div className="grid gap-1.5">
          <label htmlFor={titleId} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Prayer
          </label>
          <Input
            id={titleId}
            autoFocus
            placeholder="What are you praying for?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={bodyId} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Details <span className="font-normal normal-case">(optional)</span>
          </label>
          <Textarea id={bodyId} value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
        </div>
        {prayer?.status === "answered" && (
          <div className="grid gap-1.5">
            <label htmlFor={noteId} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              How God answered
            </label>
            <Textarea id={noteId} value={answerNote} onChange={(e) => setAnswerNote(e.target.value)} rows={3} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Category">
          {categories.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={category === c.key}
              onClick={() => setCategory(c.key)}
              className={cn(
                "group inline-flex min-h-[28px] items-center gap-1 rounded-full border px-3 py-1 text-xs",
                CHIP_TOUCH,
                category === c.key ? "border-primary bg-primary/10 text-primary-700 dark:text-primary-300" : "border-border text-muted-foreground",
              )}
            >
              {c.label}
              {c.custom && (
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`Remove ${c.label} category`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    await removeCustomPrayerCategory(c.key);
                    if (category === c.key) setCategory("personal");
                  }}
                  className="rounded-full opacity-50 hover:opacity-100"
                >
                  <X style={{ width: 12, height: 12 }} />
                </span>
              )}
            </button>
          ))}
          {addingCat ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-primary px-2 py-0.5">
              <input
                ref={newCatRef}
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitNewCat();
                  if (e.key === "Escape") {
                    setNewCat("");
                    setAddingCat(false);
                  }
                }}
                onBlur={() => void commitNewCat()}
                placeholder="New category"
                aria-label="New category name"
                maxLength={24}
                className="w-24 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              />
              <button type="button" aria-label="Add category" onClick={() => void commitNewCat()} className="text-primary">
                <Check style={{ width: 12, height: 12 }} />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setAddingCat(true)}
              className={cn(
                "inline-flex min-h-[28px] items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary",
                CHIP_TOUCH,
              )}
            >
              <Plus style={{ width: 12, height: 12 }} /> Add
            </button>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={remind}
          onClick={() => setRemind((r) => !r)}
          className="flex min-h-[36px] items-center gap-2 text-left text-sm text-muted-foreground [@media(pointer:coarse)]:min-h-[44px]"
        >
          {remind ? (
            <BellRing style={{ width: 16, height: 16 }} className="text-primary-600" />
          ) : (
            <Bell style={{ width: 16, height: 16 }} />
          )}
          Remind me daily until answered
        </button>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className={COARSE_H} onClick={onClose}>
            Cancel
          </Button>
          <Button className={COARSE_H} disabled={!title.trim() || saving} onClick={() => void submit()}>
            {editing ? "Save changes" : "Add prayer"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AnswerDialog({ prayer, onClose }: { prayer: Prayer; onClose: () => void }) {
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>God answered “{prayer.title}”</DialogTitle>
        <DialogDescription>
          Record how He answered — so you can look back and remember what He has done.
        </DialogDescription>
        <Textarea
          autoFocus
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="How did God answer this prayer?"
          aria-label="How did God answer this prayer?"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="success"
            onClick={async () => {
              await markAnswered(prayer.id, note);
              onClose();
            }}
          >
            <CheckCircle2 style={{ width: 16, height: 16 }} /> Mark answered
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
