import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Archive,
  Bell,
  BellRing,
  Check,
  CheckCircle2,
  HandHeart,
  NotebookPen,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { db, type JournalEntry, type Prayer, type PrayerCategory } from "@/db";
import {
  addCustomPrayerCategory,
  addPrayer,
  archivePrayer,
  getCustomPrayerCategories,
  linkJournalPrayer,
  markAnswered,
  prayedFor,
  removeCustomPrayerCategory,
  reopenPrayer,
  toggleRemind,
  unlinkJournalPrayer,
} from "@/db/repos";
import { syncNow } from "@/db/sync";
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
  const [tab, setTab] = useState<"active" | "answered">("active");
  const [adding, setAdding] = useState(false);
  const [answering, setAnswering] = useState<Prayer | null>(null);
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
    setTab(target.status === "answered" ? "answered" : "active");
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
    const earliest = all.length ? Math.min(...all.map((p) => p.createdAt)) : Date.now();
    return {
      active: active.length,
      answered: answered.length,
      daysPraying: daysSince(earliest),
      answeredRate: all.length ? Math.round((answered.length / (active.length + answered.length || 1)) * 100) : 0,
    };
  }, [prayers]);

  const list = (prayers ?? []).filter((p) =>
    tab === "active" ? p.status === "active" : p.status === "answered",
  );

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
          <Button className="ml-auto" onClick={() => setAdding(true)}>
            <Plus style={{ width: 16, height: 16 }} /> New prayer
          </Button>
        </div>

        {/* stats */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Active" value={stats.active} />
          <Stat label="Answered" value={stats.answered} accent />
          <Stat label="Days praying" value={stats.daysPraying} />
          <Stat label="Answered %" value={`${stats.answeredRate}%`} />
        </div>

        {/* tabs */}
        <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
          <TabBtn active={tab === "active"} onClick={() => setTab("active")}>
            <HandHeart style={{ width: 16, height: 16 }} /> Active ({stats.active})
          </TabBtn>
          <TabBtn active={tab === "answered"} onClick={() => setTab("answered")}>
            <Sparkles style={{ width: 16, height: 16 }} /> Answered ({stats.answered})
          </TabBtn>
        </div>

        {list.length === 0 ? (
          <EmptyState tab={tab} onAdd={() => setAdding(true)} />
        ) : (
          <div className="space-y-3">
            {list.map((p) => (
              <PrayerCard
                key={p.id}
                p={p}
                focused={focusId === p.id}
                onPrayed={() => prayedFor(p.id)}
                onAnswer={() => setAnswering(p)}
                onReopen={() => reopenPrayer(p.id)}
                onArchive={() => archivePrayer(p.id)}
              />
            ))}
          </div>
        )}
      </div>

      {adding && <AddPrayerDialog onClose={() => setAdding(false)} />}
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
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
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
}: {
  p: Prayer;
  focused?: boolean;
  onPrayed: () => void;
  onAnswer: () => void;
  onReopen: () => void;
  onArchive: () => void;
}) {
  const navigate = useNavigate();
  const [linking, setLinking] = useState(false);
  const answered = p.status === "answered";
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
      className={cn(
        "p-4 transition-shadow",
        answered && "border-success/30 bg-success/5",
        focused && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{p.title}</h3>
            <Badge className={cn("bg-transparent", catColor(p.category))}>{catLabel(p.category)}</Badge>
            {!answered && (
              <button
                onClick={() => toggleRemind(p.id, !p.remind)}
                title={p.remind ? "Daily reminder on" : "Remind me daily"}
                className="rounded p-1 hover:bg-accent"
              >
                {p.remind ? (
                  <BellRing style={{ width: 15, height: 15 }} className="text-primary-600" />
                ) : (
                  <Bell style={{ width: 15, height: 15 }} className="text-muted-foreground" />
                )}
              </button>
            )}
          </div>
          {p.body && <p className="mt-1 text-sm text-muted-foreground">{p.body}</p>}

          {answered ? (
            <div className="mt-3 rounded-md border border-success/30 bg-success/10 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-success">
                <Sparkles style={{ width: 14, height: 14 }} /> Answered · {new Date(p.answeredAt!).toLocaleDateString()}
              </div>
              {p.answerNote && <p className="mt-1 text-sm">{p.answerNote}</p>}
            </div>
          ) : (
            <div className="mt-2 text-xs text-muted-foreground">
              Prayed {p.prayedCount} {p.prayedCount === 1 ? "time" : "times"}
              {p.lastPrayedAt ? ` · last ${new Date(p.lastPrayedAt).toLocaleDateString()}` : ""}
            </div>
          )}

          {/* journal cross-references */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {(linkedJournals ?? []).map((j: JournalEntry) => (
              <button
                key={j.id}
                onClick={() => navigate(`/journal?open=${j.id}`)}
                className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs text-primary-700 hover:bg-primary/10 dark:text-primary-300"
              >
                <NotebookPen style={{ width: 11, height: 11 }} />
                {j.title}
              </button>
            ))}
            <button
              onClick={() => setLinking(true)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
            >
              <Plus style={{ width: 11, height: 11 }} /> Link a journal entry
            </button>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-1.5">
          {answered ? (
            <Button size="sm" variant="ghost" onClick={onReopen}>
              <RotateCcw style={{ width: 14, height: 14 }} /> Reopen
            </Button>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={onPrayed}>
                <HandHeart style={{ width: 14, height: 14 }} /> Prayed
              </Button>
              <Button size="sm" variant="success" onClick={onAnswer}>
                <CheckCircle2 style={{ width: 14, height: 14 }} /> Answered
              </Button>
              <Button size="sm" variant="ghost" onClick={onArchive}>
                <Archive style={{ width: 14, height: 14 }} /> Archive
              </Button>
            </>
          )}
        </div>
      </div>

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

function EmptyState({ tab, onAdd }: { tab: "active" | "answered"; onAdd: () => void }) {
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

function AddPrayerDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<PrayerCategory>("personal");
  const [remind, setRemind] = useState(false);
  const [addingCat, setAddingCat] = useState(false);
  const [newCat, setNewCat] = useState("");
  const newCatRef = useRef<HTMLInputElement>(null);

  const customCategories = useLiveQuery(() => getCustomPrayerCategories(), [], []);
  const categories: { key: string; label: string; custom: boolean }[] = [
    ...BUILTIN_CATEGORIES.map((c) => ({ ...c, custom: false })),
    ...(customCategories ?? []).map((c) => ({ key: c, label: catLabel(c), custom: true })),
  ];

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
        <DialogTitle>New prayer</DialogTitle>
        <DialogDescription>What would you like to bring before God?</DialogDescription>
        <Input autoFocus placeholder="Prayer title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea placeholder="Details (optional)" value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
        <div className="flex flex-wrap items-center gap-1.5">
          {categories.map((c) => (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className={cn(
                "group inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs",
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
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary"
            >
              <Plus style={{ width: 12, height: 12 }} /> Add
            </button>
          )}
        </div>
        <button
          onClick={() => setRemind((r) => !r)}
          className="flex items-center gap-2 text-left text-sm text-muted-foreground"
        >
          {remind ? (
            <BellRing style={{ width: 16, height: 16 }} className="text-primary-600" />
          ) : (
            <Bell style={{ width: 16, height: 16 }} />
          )}
          Remind me daily until answered
        </button>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim()}
            onClick={async () => {
              await addPrayer({ title, body, category, remind });
              onClose();
            }}
          >
            Add prayer
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
