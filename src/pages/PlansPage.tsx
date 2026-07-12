import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, BookOpen, Check, CheckCircle2, Play, Plus, RotateCcw, Star, Trash2 } from "lucide-react";
import { db } from "@/db";
import { addCustomPlan, deleteCustomPlan, setDayDone, startPlan, resetPlan } from "@/db/repos";
import { buildReadingRange, getPlans, type Plan } from "@/data/plans";
import { BOOKS, refRange } from "@/lib/osis";
import { useUI } from "@/store/ui";
import { Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from "@/components/ui";
import { cn } from "@/lib/cn";

function firstIncomplete(total: number, done: number[]): number {
  const set = new Set(done);
  for (let i = 0; i < total; i++) if (!set.has(i)) return i;
  return total; // finished
}

export function PlansPage() {
  const [builtins, setBuiltins] = useState<Plan[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const progress = useLiveQuery(() => db.plans.toArray(), [], []);
  const customs = useLiveQuery(() => db.customPlans.orderBy("createdAt").reverse().toArray(), [], []);

  useEffect(() => {
    getPlans().then(setBuiltins);
  }, []);

  const customPlans: Plan[] = (customs ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    days: c.days,
  }));
  const customIds = new Set((customs ?? []).map((c) => c.id));
  const plans = [...customPlans, ...builtins];

  const byId = useMemo(() => new Map((progress ?? []).map((p) => [p.planId, p])), [progress]);
  const selected = plans.find((p) => p.id === selectedId) ?? null;

  if (selected) {
    return (
      <PlanDetail
        plan={selected}
        completed={byId.get(selected.id)?.completedDays ?? []}
        started={byId.has(selected.id)}
        isCustom={customIds.has(selected.id)}
        onBack={() => setSelectedId(null)}
        onDelete={() => {
          deleteCustomPlan(selected.id);
          setSelectedId(null);
        }}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
        <div className="mb-1 flex items-center gap-3">
          <h1 className="font-serif text-3xl font-bold">Reading Plans</h1>
          <Button className="ml-auto" onClick={() => setCreating(true)}>
            <Plus style={{ width: 16, height: 16 }} /> Create plan
          </Button>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">
          Build a rhythm in the Word. Progress is tracked by chapters read — never by the clock — so you
          can’t fall behind.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {plans.map((p) => {
            const done = byId.get(p.id)?.completedDays.length ?? 0;
            const pct = Math.round((done / p.days.length) * 100);
            return (
              <Card
                key={p.id}
                className="cursor-pointer p-5 hover:border-primary/40"
                onClick={() => setSelectedId(p.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-serif text-lg font-bold">{p.name}</h3>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {customIds.has(p.id) && <Badge className="text-muted-foreground">Custom</Badge>}
                    {byId.has(p.id) && (
                      <Badge className="border-primary/30 text-primary-700 dark:text-primary-300">{pct}%</Badge>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {done}/{p.days.length}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
      {creating && <CreatePlanDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function PlanDetail({
  plan,
  completed,
  started,
  isCustom,
  onBack,
  onDelete,
}: {
  plan: Plan;
  completed: number[];
  started: boolean;
  isCustom: boolean;
  onBack: () => void;
  onDelete: () => void;
}) {
  const navigate = useNavigate();
  const { goTo, activePlanId, setActivePlan } = useUI();
  const doneSet = new Set(completed);
  const today = firstIncomplete(plan.days.length, completed);
  const isActive = activePlanId === plan.id;

  async function makeActive() {
    await startPlan(plan.id);
    setActivePlan(plan.id);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
        <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={onBack}>
          <ArrowLeft style={{ width: 16, height: 16 }} /> All plans
        </Button>

        <div className="mb-6 flex items-start gap-3">
          <div>
            <h1 className="font-serif text-3xl font-bold">{plan.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {completed.length} of {plan.days.length} days complete
              {today < plan.days.length ? ` · next up: Day ${today + 1}` : " · finished 🎉"}
            </p>
          </div>
          <div className="ml-auto flex flex-col gap-2">
            {today < plan.days.length && (
              <Button
                size="sm"
                onClick={async () => {
                  await makeActive();
                  navigate(`/guided/${plan.id}/${today}`);
                }}
              >
                <Play style={{ width: 15, height: 15 }} /> Start today's reading
              </Button>
            )}
            <Button variant={isActive ? "secondary" : "outline"} size="sm" onClick={makeActive}>
              <Star style={{ width: 15, height: 15 }} /> {isActive ? "Active plan" : "Set as active"}
            </Button>
            {started && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  resetPlan(plan.id);
                  if (isActive) setActivePlan(null);
                }}
              >
                <RotateCcw style={{ width: 15, height: 15 }} /> Reset
              </Button>
            )}
            {isCustom && (
              <Button variant="ghost" size="sm" onClick={onDelete}>
                <Trash2 style={{ width: 15, height: 15 }} /> Delete plan
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {plan.days.map((readings, day) => {
            const isDone = doneSet.has(day);
            const isToday = day === today;
            return (
              <Card
                key={day}
                className={cn(
                  "flex items-center gap-3 p-3",
                  isToday && "border-primary/50 bg-primary/5",
                  isDone && "opacity-70",
                )}
              >
                <button
                  onClick={() => setDayDone(plan.id, day, !isDone)}
                  aria-label={isDone ? "Mark not done" : "Mark done"}
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2",
                    isDone ? "border-success bg-success text-success-foreground" : "border-border",
                  )}
                >
                  {isDone && <Check style={{ width: 15, height: 15 }} />}
                </button>
                <div className="w-14 shrink-0 text-sm font-semibold text-muted-foreground">Day {day + 1}</div>
                <div className="flex flex-1 flex-wrap gap-1.5">
                  {readings.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        goTo(r.ho, r.chapter);
                        navigate("/bible");
                      }}
                      className="rounded-md border border-border px-2 py-1 text-sm hover:border-primary/40 hover:bg-accent"
                    >
                      {refRange(r.ho, r.chapter, r.vStart, r.vEnd)}
                    </button>
                  ))}
                </div>
                {isToday && !isDone && (
                  <span className="hidden shrink-0 items-center gap-1 text-xs font-medium text-primary-600 sm:flex">
                    <BookOpen style={{ width: 13, height: 13 }} /> Today
                  </span>
                )}
                {isDone && <CheckCircle2 style={{ width: 16, height: 16 }} className="shrink-0 text-success" />}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CreatePlanDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [startHo, setStartHo] = useState("MAT");
  const [endHo, setEndHo] = useState("JHN");
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const selectCls = "mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm";

  async function create() {
    setBusy(true);
    const dayBuckets = await buildReadingRange(startHo, endHo, days);
    const sName = BOOKS.find((b) => b.ho === startHo)?.name ?? startHo;
    const eName = BOOKS.find((b) => b.ho === endHo)?.name ?? endHo;
    const range = startHo === endHo ? sName : `${sName}–${eName}`;
    await addCustomPlan(name || range, `${range} in ${dayBuckets.length} days`, dayBuckets);
    setBusy(false);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>Create a reading plan</DialogTitle>
        <DialogDescription>Choose a book range and how many days to spread it over.</DialogDescription>
        <Input placeholder="Plan name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm text-muted-foreground">
            From
            <select className={selectCls} value={startHo} onChange={(e) => setStartHo(e.target.value)}>
              {BOOKS.map((b) => (
                <option key={b.ho} value={b.ho}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-muted-foreground">
            To
            <select className={selectCls} value={endHo} onChange={(e) => setEndHo(e.target.value)}>
              {BOOKS.map((b) => (
                <option key={b.ho} value={b.ho}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="text-sm text-muted-foreground">
          Days
          <Input
            type="number"
            min={1}
            value={days}
            onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
            className="mt-1"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy}>
            Create plan
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
