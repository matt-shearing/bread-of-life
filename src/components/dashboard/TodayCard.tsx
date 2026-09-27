import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, CalendarCheck, Check, HandHeart, Play, Sparkles, Sunrise, Sunset } from "lucide-react";
import { db } from "@/db";
import { getPlan, type Plan } from "@/data/plans";
import {
  currentReadingIndex,
  devotionalById,
  getDevotionDay,
  mmdd,
  type DevotionDay,
  type DevotionReading,
} from "@/data/devotional";
import { isDueToday, prayedFor, setDayDone, setDevotionDone } from "@/db/repos";
import { refRange } from "@/lib/osis";
import { localDayKey } from "@/lib/day";
import { devotionDoneId } from "@/lib/devotionDone";
import { useUI } from "@/store/ui";
import { useOpenRef } from "@/lib/useOpenRef";
import { cn } from "@/lib/cn";
import { Button, Card, Dialog, DialogContent, DialogTitle } from "@/components/ui";
import { DevotionView } from "@/components/devotional/DevotionView";
import { ListenButton } from "@/components/devotional/ListenButton";
import { PrayThroughButton } from "@/components/prayers/PrayThrough";

/**
 * Today, in one card: the plan reading, prayer and the devotional as three rows you
 * can tick off (UX 10). The plan and devotional ticks are real checkboxes; prayer is
 * ticked once today's reminder prayers have all been prayed for.
 */
export function TodayCard() {
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  return (
    <Card className="mb-6 p-5">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-lg font-semibold">Today</h2>
        <span className="text-sm text-muted-foreground">{date}</span>
      </div>
      <ul className="divide-y divide-border">
        <PlanRow />
        <PrayerRow />
        <DevotionRow />
      </ul>
    </Card>
  );
}

/* ----------------------------------- layout ----------------------------------- */

function Row({ check, children, actions }: { check: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 py-3.5 last:pb-0 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <div className="pt-0.5">{check}</div>
      <div className="min-w-0">{children}</div>
      {actions && (
        <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:row-start-1 sm:justify-end">{actions}</div>
      )}
    </li>
  );
}

function RowTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 font-medium">
      <span className="shrink-0 text-primary-700 dark:text-primary-400" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

const CIRCLE = "flex h-7 w-7 items-center justify-center rounded-full border-2 transition-colors";

/** A round checkbox; its hit area grows to 44px on touch. */
function CheckCircle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        CIRCLE,
        "relative after:absolute after:-inset-2 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        checked ? "border-success bg-success text-success-foreground" : "border-border hover:border-primary",
      )}
    >
      {checked && <Check size={15} strokeWidth={3} aria-hidden />}
    </button>
  );
}

/** The same circle as a status only (nothing to toggle). */
function StatusCircle({ done, label }: { done: boolean; label: string }) {
  return (
    <span role="img" aria-label={label} className={cn(CIRCLE, done ? "border-success bg-success text-success-foreground" : "border-border")}>
      {done && <Check size={15} strokeWidth={3} aria-hidden />}
    </span>
  );
}

/* ------------------------------------ plan ------------------------------------ */

function PlanRow() {
  const navigate = useNavigate();
  const activePlanId = useUI((s) => s.activePlanId);
  const [plan, setPlan] = useState<Plan | null>(null);

  useEffect(() => {
    if (activePlanId) getPlan(activePlanId).then((p) => setPlan(p ?? null));
    else setPlan(null);
  }, [activePlanId]);

  const prog = useLiveQuery(async () => (activePlanId ? await db.plans.get(activePlanId) : undefined), [activePlanId]);

  if (!activePlanId || !plan) {
    return (
      <Row
        check={<StatusCircle done={false} label="No reading plan" />}
        actions={
          <Button size="sm" variant="outline" onClick={() => navigate("/plans")}>
            Browse plans
          </Button>
        }
      >
        <RowTitle icon={<CalendarCheck size={16} />}>Reading plan</RowTitle>
        <p className="text-sm text-muted-foreground">Start a plan to build a daily rhythm in the Word.</p>
      </Row>
    );
  }

  const completed = prog?.completedDays ?? [];
  const doneSet = new Set(completed);
  let next = 0;
  while (next < plan.days.length && doneSet.has(next)) next++;
  const finished = next >= plan.days.length;
  const pct = Math.round((completed.length / plan.days.length) * 100);
  // A day finished today (by its completion time) ticks the row; unticking reopens it.
  const todayKey = localDayKey();
  const doneToday = Object.entries(prog?.completedAt ?? {})
    .filter(([day, at]) => doneSet.has(Number(day)) && localDayKey(at) === todayKey)
    .map(([day]) => Number(day))
    .sort((a, b) => b - a)[0];
  const checked = doneToday !== undefined || finished;

  const progress = (
    <div className="mt-2 flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {completed.length}/{plan.days.length}
      </span>
    </div>
  );

  if (checked) {
    return (
      <Row
        check={
          doneToday !== undefined ? (
            <CheckCircle
              checked
              label={`Day ${doneToday + 1} of ${plan.name} done`}
              onChange={() => void setDayDone(activePlanId, doneToday, false)}
            />
          ) : (
            <StatusCircle done label="Plan finished" />
          )
        }
        actions={
          <Button size="sm" variant="ghost" onClick={() => navigate("/plans")}>
            {finished ? "Pick another" : "View plan"}
          </Button>
        }
      >
        <RowTitle icon={<CalendarCheck size={16} />}>
          {finished ? `You’ve finished ${plan.name} 🎉` : `Day ${doneToday! + 1} read`}
        </RowTitle>
        <p className="text-sm text-muted-foreground">
          {finished ? "Well done." : `${plan.name} · Day ${next + 1} is next.`}
        </p>
        {progress}
      </Row>
    );
  }

  const readings = plan.days[next];
  return (
    <Row
      check={
        <CheckCircle
          checked={false}
          label={`Mark day ${next + 1} of ${plan.name} as read`}
          onChange={() => void setDayDone(activePlanId, next, true)}
        />
      }
      actions={
        <Button size="sm" onClick={() => navigate(`/guided/${activePlanId}/${next}`)}>
          <Play size={15} aria-hidden /> Start
        </Button>
      }
    >
      <RowTitle icon={<CalendarCheck size={16} />}>
        Day {next + 1} · {plan.name}
      </RowTitle>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {readings.map((r, i) => (
          <button
            key={i}
            // A reading opens the ON-RAILS guided reader at that reading (so it ticks
            // off and tracks completion), not the plain Bible page.
            onClick={() => navigate(`/guided/${activePlanId}/${next}?reading=${i}`)}
            className="rounded-md border border-border px-2 py-0.5 text-sm hover:border-primary/40 hover:bg-accent [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3"
          >
            {refRange(r.ho, r.chapter, r.vStart, r.vEnd)}
          </button>
        ))}
      </div>
      {progress}
    </Row>
  );
}

/* ----------------------------------- prayer ----------------------------------- */

function PrayerRow() {
  const navigate = useNavigate();
  const active = useLiveQuery(() => db.prayers.where("status").equals("active").toArray(), [], []);
  const list = active ?? [];
  const due = list.filter(isDueToday);
  const reminded = list.filter((p) => p.remind);
  const todayKey = localDayKey();
  const prayedToday = list.some((p) => p.lastPrayedAt && localDayKey(p.lastPrayedAt) === todayKey);
  const done = list.length > 0 && due.length === 0 && (reminded.length > 0 || prayedToday);

  if (list.length === 0) {
    return (
      <Row
        check={<StatusCircle done={false} label="No prayers yet" />}
        actions={
          <Button size="sm" variant="outline" onClick={() => navigate("/prayers?new=1")}>
            Add a prayer
          </Button>
        }
      >
        <RowTitle icon={<HandHeart size={16} />}>Prayer</RowTitle>
        <p className="text-sm text-muted-foreground">Bring what’s on your heart to God.</p>
      </Row>
    );
  }

  return (
    <Row
      check={<StatusCircle done={done} label={done ? "Prayed for today" : "Still to pray for today"} />}
      actions={<PrayThroughButton variant="button" className="h-8 [@media(pointer:coarse)]:h-11" />}
    >
      <RowTitle icon={<HandHeart size={16} />}>
        {due.length > 0 ? `${due.length} to lift up today` : done ? "Prayed for today" : "Prayer"}
      </RowTitle>
      {due.length > 0 ? (
        <ul className="mt-1 space-y-1">
          {due.slice(0, 3).map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{p.title}</span>
              <Button size="sm" variant="secondary" className="h-7 px-2.5 text-xs" onClick={() => void prayedFor(p.id)}>
                Prayed
              </Button>
            </li>
          ))}
          {due.length > 3 && <li className="text-xs text-muted-foreground">and {due.length - 3} more</li>}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {list.length} active {list.length === 1 ? "prayer" : "prayers"}
          {reminded.length === 0 && " · mark one with the bell to be reminded here"}
        </p>
      )}
    </Row>
  );
}

/* --------------------------------- devotional --------------------------------- */

function DevotionRow() {
  const devotionalId = useUI((s) => s.devotionalId);
  const openRef = useOpenRef();
  const dev = devotionalById(devotionalId);
  const key = mmdd();
  const [day, setDay] = useState<DevotionDay | null>(null);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getDevotionDay(dev, key).then((d) => {
      setDay(d);
      setIndex(d ? currentReadingIndex(d) : 0);
    });
  }, [dev, key]);

  const doneId = devotionDoneId(dev.id, key, index);
  const done = useLiveQuery(() => db.devotions.get(doneId), [doneId]);

  if (!day || !day.readings.length) return null;
  const reading = day.readings[Math.min(index, day.readings.length - 1)];
  const isDone = !!done;
  const Icon = reading.label === "Evening" ? Sunset : reading.label === "Morning" ? Sunrise : Sparkles;
  const openVerse = (e: DevotionReading) => {
    if (e.ho && e.chapter) openRef(e.ho, e.chapter, e.verse, { path: "/", label: "Home" });
  };

  return (
    <>
      <Row
        check={
          <CheckCircle
            checked={isDone}
            label={`${dev.name}${reading.label ? `, ${reading.label}` : ""}: ${isDone ? "read" : "mark as read"}`}
            onChange={(v) => void setDevotionDone(doneId, v)}
          />
        }
        actions={
          <>
            <Button size="sm" variant={isDone ? "outline" : "primary"} onClick={() => setOpen(true)}>
              <BookOpen size={15} aria-hidden /> Read
            </Button>
            <ListenButton devotionalId={dev.id} dayKey={key} index={index} reading={reading} quiet />
          </>
        }
      >
        <RowTitle icon={<Icon size={16} />}>
          {dev.name}
          {reading.label ? ` · ${reading.label}` : ""}
        </RowTitle>
        <p className="text-sm text-muted-foreground">
          {reading.ref ? `${reading.ref} · ` : ""}
          {dev.author} ·{" "}
          <Link to="/devotional" className="font-medium text-primary-700 underline-offset-2 hover:underline dark:text-primary-400 [@media(pointer:coarse)]:-my-3 [@media(pointer:coarse)]:inline-block [@media(pointer:coarse)]:py-3">
            Browse all
          </Link>
        </p>
      </Row>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogTitle>
            {dev.name} · {dev.author}
          </DialogTitle>
          <DevotionView
            dev={dev}
            dayKey={key}
            day={day}
            index={index}
            setIndex={setIndex}
            onOpenVerse={(e) => {
              setOpen(false);
              openVerse(e);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
