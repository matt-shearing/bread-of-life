import { useMemo, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Archive, Bell, BellRing, CheckCircle2, HandHeart, Plus, RotateCcw, Sparkles } from "lucide-react";
import { db, type Prayer, type PrayerCategory } from "@/db";
import {
  addPrayer,
  archivePrayer,
  markAnswered,
  prayedFor,
  reopenPrayer,
  toggleRemind,
} from "@/db/repos";
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

const CATEGORIES: { key: PrayerCategory; label: string }[] = [
  { key: "personal", label: "Personal" },
  { key: "family", label: "Family" },
  { key: "community", label: "Community" },
  { key: "thanksgiving", label: "Thanksgiving" },
  { key: "world", label: "World" },
];

const CAT_COLOR: Record<PrayerCategory, string> = {
  personal: "border-primary/40 text-primary-700 dark:text-primary-300",
  family: "border-rose-300 text-rose-600",
  community: "border-sky-300 text-sky-600",
  thanksgiving: "border-emerald-300 text-emerald-600",
  world: "border-violet-300 text-violet-600",
};

function daysSince(ts: number) {
  return Math.max(1, Math.round((Date.now() - ts) / 86_400_000));
}

export function PrayersPage() {
  const [tab, setTab] = useState<"active" | "answered">("active");
  const [adding, setAdding] = useState(false);
  const [answering, setAnswering] = useState<Prayer | null>(null);

  const prayers = useLiveQuery(() => db.prayers.orderBy("createdAt").reverse().toArray(), [], []);

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
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
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
  onPrayed,
  onAnswer,
  onReopen,
  onArchive,
}: {
  p: Prayer;
  onPrayed: () => void;
  onAnswer: () => void;
  onReopen: () => void;
  onArchive: () => void;
}) {
  const answered = p.status === "answered";
  return (
    <Card className={cn("p-4", answered && "border-success/30 bg-success/5")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{p.title}</h3>
            <Badge className={cn("bg-transparent", CAT_COLOR[p.category])}>{p.category}</Badge>
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
    </Card>
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
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>New prayer</DialogTitle>
        <DialogDescription>What would you like to bring before God?</DialogDescription>
        <Input autoFocus placeholder="Prayer title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea placeholder="Details (optional)" value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                category === c.key ? "border-primary bg-primary/10 text-primary-700 dark:text-primary-300" : "border-border text-muted-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
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
