import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, Ban, BellRing, BookOpen, CalendarCheck, Check, Flame, HandHeart, Image, NotebookPen, Play, Sparkles, Sunrise, Sunset, Wind } from "lucide-react";
import { db } from "@/db";
import { DashboardBackground } from "@/components/dashboard/DashboardBackground";
import { cn } from "@/lib/cn";
import { verseOfTheDay } from "@/data/bible";
import { getPlan, type Plan } from "@/data/plans";
import {
  currentReadingIndex,
  devotionalById,
  getDevotionDay,
  mmdd,
  type DevotionDay,
  type DevotionReading,
} from "@/data/devotional";
import { isDueToday, prayedFor, setDayDone } from "@/db/repos";
import { refLabel } from "@/lib/osis";
import { useUI } from "@/store/ui";
import { Badge, Button, Card, CardContent, Dialog, DialogContent, DialogTitle } from "@/components/ui";
import { DevotionView } from "@/components/devotional/DevotionView";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function TodaysPlan() {
  const navigate = useNavigate();
  const { goTo, activePlanId } = useUI();
  const [plan, setPlan] = useState<Plan | null>(null);

  useEffect(() => {
    if (activePlanId) getPlan(activePlanId).then((p) => setPlan(p ?? null));
    else setPlan(null);
  }, [activePlanId]);

  const prog = useLiveQuery(
    async () => (activePlanId ? await db.plans.get(activePlanId) : undefined),
    [activePlanId],
  );

  if (!activePlanId || !plan) {
    return (
      <Card className="mb-6 flex items-center gap-3 p-5">
        <CalendarCheck style={{ width: 22, height: 22 }} className="text-primary-600" />
        <div>
          <div className="font-semibold">Reading plan</div>
          <div className="text-sm text-muted-foreground">Start a plan to build a daily rhythm in the Word.</div>
        </div>
        <Button className="ml-auto" variant="outline" onClick={() => navigate("/plans")}>
          Browse plans
        </Button>
      </Card>
    );
  }

  const completed = prog?.completedDays ?? [];
  const doneSet = new Set(completed);
  let today = 0;
  while (today < plan.days.length && doneSet.has(today)) today++;
  const finished = today >= plan.days.length;
  const readings = finished ? [] : plan.days[today];
  const pct = Math.round((completed.length / plan.days.length) * 100);

  return (
    <Card className="mb-6 p-5">
      <div className="flex items-center gap-2">
        <CalendarCheck style={{ width: 16, height: 16 }} className="text-primary-600" />
        <span className="text-sm font-semibold text-muted-foreground">Today’s Plan · {plan.name}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {completed.length}/{plan.days.length} · {pct}%
        </span>
      </div>
      {finished ? (
        <p className="mt-3 text-sm">You’ve finished this plan 🎉 — pick another on the Plans page.</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Day {today + 1}:</span>
          {readings.map((r, i) => (
            <button
              key={i}
              onClick={() => {
                goTo(r.ho, r.chapter);
                navigate("/bible");
              }}
              className="rounded-md border border-border px-2 py-1 text-sm hover:border-primary/40 hover:bg-accent"
            >
              {refLabel(r.ho, r.chapter)}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" onClick={() => navigate(`/guided/${activePlanId}/${today}`)}>
              <Play style={{ width: 15, height: 15 }} /> Start today's reading
            </Button>
            <Button size="sm" variant="success" onClick={() => setDayDone(activePlanId, today, true)}>
              <Check style={{ width: 15, height: 15 }} /> Mark done
            </Button>
          </div>
        </div>
      )}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </Card>
  );
}

function computeStreak(days: Set<string>): number {
  let streak = 0;
  const d = new Date();
  for (;;) {
    const key = d.toISOString().slice(0, 10);
    if (days.has(key)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else break;
  }
  return streak;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { goTo } = useUI();
  const [votd, setVotd] = useState<{ ho: string; chapter: number; verse: number; text: string } | null>(null);

  useEffect(() => {
    verseOfTheDay().then(setVotd);
  }, []);

  const prayers = useLiveQuery(() => db.prayers.toArray(), [], []);
  const journal = useLiveQuery(() => db.journal.orderBy("updatedAt").reverse().limit(3).toArray(), [], []);
  const progress = useLiveQuery(() => db.progress.orderBy("at").reverse().toArray(), [], []);

  const activePrayers = (prayers ?? []).filter((p) => p.status === "active");
  const answeredPrayers = (prayers ?? []).filter((p) => p.status === "answered");
  const duePrayers = (prayers ?? []).filter(isDueToday);
  const lastRead = progress?.[0];

  const streak = useMemo(() => {
    const days = new Set((progress ?? []).map((p) => new Date(p.at).toISOString().slice(0, 10)));
    return computeStreak(days);
  }, [progress]);

  const weekDots = useMemo(() => {
    const days = new Set((progress ?? []).map((p) => new Date(p.at).toISOString().slice(0, 10)));
    const out: { label: string; active: boolean; today: boolean }[] = [];
    const d = new Date();
    d.setDate(d.getDate() - 6);
    for (let i = 0; i < 7; i++) {
      const key = d.toISOString().slice(0, 10);
      out.push({
        label: d.toLocaleDateString(undefined, { weekday: "narrow" }),
        active: days.has(key),
        today: key === new Date().toISOString().slice(0, 10),
      });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [progress]);

  function openVotd() {
    if (votd) {
      goTo(votd.ho, votd.chapter);
      navigate("/bible");
    }
  }

  return (
    <div className="relative h-full overflow-y-auto">
      <DashboardBackground />
      <div className="relative z-10 mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <div className="mb-6 flex items-start gap-3">
          <div>
            <h1 className="font-serif text-3xl font-bold">{greeting()}.</h1>
            <p className="text-muted-foreground">Welcome back to your homebase.</p>
          </div>
          <BgToggle />
        </div>

        {/* Verse of the day hero */}
        <Card className="mb-6 overflow-hidden border-none bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-card">
          <CardContent className="p-7">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-white/80">
              <Sparkles style={{ width: 16, height: 16 }} /> Verse of the Day
            </div>
            {votd ? (
              <>
                <p className="font-serif text-xl leading-relaxed">“{votd.text}”</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="font-medium text-white/90">{refLabel(votd.ho, votd.chapter, votd.verse)} · BSB</span>
                  <Button variant="secondary" size="sm" onClick={openVotd} className="bg-white/20 text-white hover:bg-white/30">
                    Read in context <ArrowRight style={{ width: 15, height: 15 }} />
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-white/70">Loading…</p>
            )}
          </CardContent>
        </Card>

        <DevotionTile />

        <TodaysPlan />

        {duePrayers.length > 0 && (
          <Card className="mb-6 border-primary/30 p-5">
            <div className="mb-3 flex items-center gap-2">
              <BellRing style={{ width: 16, height: 16 }} className="text-primary-600" />
              <span className="text-sm font-semibold">Pray today</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {duePrayers.length} to lift up
              </span>
            </div>
            <div className="space-y-1.5">
              {duePrayers.slice(0, 6).map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <HandHeart style={{ width: 14, height: 14 }} className="shrink-0 text-primary-500" />
                  <span className="flex-1 truncate text-sm">{p.title}</span>
                  <Button size="sm" variant="secondary" onClick={() => prayedFor(p.id)}>
                    Prayed
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Continue reading */}
          <Card className="p-5">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <BookOpen style={{ width: 16, height: 16 }} /> Continue reading
            </div>
            <div className="font-serif text-lg font-bold">
              {lastRead ? refLabel(lastRead.ho, lastRead.chapter) : "John 1"}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              onClick={() => {
                if (lastRead) goTo(lastRead.ho, lastRead.chapter);
                navigate("/bible");
              }}
            >
              Open reader
            </Button>
          </Card>

          {/* Streak */}
          <Card className="p-5">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Flame style={{ width: 16, height: 16 }} /> Reading streak
            </div>
            <div className="text-2xl font-bold">
              {streak} {streak === 1 ? "day" : "days"}
            </div>
            <div className="mt-3 flex justify-between">
              {weekDots.map((d, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div
                    className={
                      d.active
                        ? "flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground"
                        : d.today
                          ? "h-6 w-6 rounded-full border-2 border-dashed border-primary/50"
                          : "h-6 w-6 rounded-full border border-border"
                    }
                  >
                    {d.active ? "✓" : ""}
                  </div>
                  <span className="text-[10px] text-muted-foreground">{d.label}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Prayers */}
          <Card className="p-5">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <HandHeart style={{ width: 16, height: 16 }} /> Prayers
            </div>
            <div className="flex gap-4">
              <div>
                <div className="text-2xl font-bold">{activePrayers.length}</div>
                <div className="text-xs text-muted-foreground">active</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-success">{answeredPrayers.length}</div>
                <div className="text-xs text-muted-foreground">answered</div>
              </div>
            </div>
            <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => navigate("/prayers")}>
              Open prayers
            </Button>
          </Card>
        </div>

        {/* Recent journal */}
        <div className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <NotebookPen style={{ width: 18, height: 18 }} className="text-primary-600" />
            <h2 className="font-semibold">Recent journal</h2>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => navigate("/journal")}>
              View all
            </Button>
          </div>
          {(journal ?? []).length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              Nothing yet — highlight a verse and send it to your journal to begin.
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {(journal ?? []).map((e) => (
                <Card key={e.id} className="cursor-pointer p-4 hover:border-primary/40" onClick={() => navigate("/journal")}>
                  <h3 className="font-medium">{e.title}</h3>
                  {e.body && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{e.body}</p>}
                  <div className="mt-2 text-xs text-muted-foreground">{new Date(e.updatedAt).toLocaleDateString()}</div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DevotionTile() {
  const navigate = useNavigate();
  const { goTo, devotionalId } = useUI();
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

  const done0 = useLiveQuery(() => db.devotions.get(`${dev.id}:${key}:0`), [dev.id, key]);
  const done1 = useLiveQuery(() => db.devotions.get(`${dev.id}:${key}:1`), [dev.id, key]);

  if (!day || !day.readings.length) return null;
  const reading = day.readings[Math.min(index, day.readings.length - 1)];
  const isDone = index === 0 ? !!done0 : !!done1;
  const snippet = reading.text.replace(/\s+/g, " ").slice(0, 160).trim() + "…";
  const openVerse = (e: DevotionReading) => {
    if (e.ho && e.chapter) {
      goTo(e.ho, e.chapter);
      navigate("/bible");
    }
  };
  const Icon = reading.label === "Evening" ? Sunset : reading.label === "Morning" ? Sunrise : Sparkles;

  return (
    <>
      <Card className="mb-6 p-5">
        <div className="mb-1 flex items-center gap-2">
          <Icon style={{ width: 16, height: 16 }} className="text-primary-600" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{dev.name}</div>
            <div className="text-xs text-muted-foreground">
              Today’s Devotional{reading.label ? ` · ${reading.label}` : ""} · {dev.author}
            </div>
          </div>
          {isDone && <Badge className="border-success/40 text-success">Done ✓</Badge>}
        </div>
        <div className="font-serif text-base font-bold">{reading.ref}</div>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{snippet}</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => setOpen(true)}>
            <BookOpen style={{ width: 15, height: 15 }} /> Read now
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate("/devotional")}>
            Browse all
          </Button>
        </div>
      </Card>
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

function BgToggle() {
  const { dashboardBg, setDashboardBg } = useUI();
  const opts = [
    { key: "plain" as const, label: "Plain", icon: <Ban style={{ width: 15, height: 15 }} /> },
    { key: "still" as const, label: "Scene", icon: <Image style={{ width: 15, height: 15 }} /> },
    { key: "animated" as const, label: "Living", icon: <Wind style={{ width: 15, height: 15 }} /> },
  ];
  return (
    <div className="ml-auto flex items-center rounded-lg border border-border bg-card/70 p-0.5 backdrop-blur">
      {opts.map((o) => (
        <button
          key={o.key}
          onClick={() => setDashboardBg(o.key)}
          title={`${o.label} background`}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
            dashboardBg === o.key ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.icon}
          <span className="hidden sm:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
