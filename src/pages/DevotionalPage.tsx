import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  DEVOTIONALS,
  currentReadingIndex,
  devotionKeys,
  devotionalById,
  getDevotionDay,
  mmdd,
  type DevotionDay,
  type DevotionReading,
} from "@/data/devotional";
import { useUI } from "@/store/ui";
import { Button, Card, Popover, PopoverContent, PopoverTrigger } from "@/components/ui";
import { DevotionView } from "@/components/devotional/DevotionView";
import { cn } from "@/lib/cn";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function label(key: string): string {
  const [m, d] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function DevotionalPage() {
  const navigate = useNavigate();
  const { goTo, devotionalId, setDevotionalId } = useUI();
  const dev = devotionalById(devotionalId);
  const [keys, setKeys] = useState<string[]>([]);
  const [dayKey, setDayKey] = useState(mmdd());
  const [day, setDay] = useState<DevotionDay | null>(null);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    devotionKeys(dev).then(setKeys);
  }, [dev]);

  useEffect(() => {
    setLoading(true);
    getDevotionDay(dev, dayKey).then((d) => {
      setDay(d);
      setIndex(d ? currentReadingIndex(d) : 0);
      setLoading(false);
    });
  }, [dev, dayKey]);

  function step(delta: number) {
    if (!keys.length) return;
    const i = keys.indexOf(dayKey);
    setDayKey(keys[(i + delta + keys.length) % keys.length]);
  }

  function openVerse(e: DevotionReading) {
    if (e.ho && e.chapter) {
      goTo(e.ho, e.chapter);
      navigate("/bible");
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-8">
        <div className="mb-6 flex items-center gap-3">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <button className="text-left">
                <h1 className="flex items-center gap-1.5 font-serif text-3xl font-bold">
                  {dev.name}
                  <ChevronDown style={{ width: 20, height: 20 }} className="opacity-60" />
                </h1>
                <p className="text-sm text-muted-foreground">Daily readings by {dev.author}</p>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-1">
              {DEVOTIONALS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    setDevotionalId(d.id);
                    setPickerOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
                    d.id === devotionalId && "bg-accent",
                  )}
                >
                  <div className="flex-1">
                    <div className="font-medium">{d.name}</div>
                    <div className="text-xs text-muted-foreground">{d.author}</div>
                  </div>
                  {d.id === devotionalId && <Check style={{ width: 15, height: 15 }} className="text-primary-600" />}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => step(-1)} aria-label="Previous day">
              <ChevronLeft style={{ width: 18, height: 18 }} />
            </Button>
            <span className="min-w-28 text-center text-sm font-medium">{label(dayKey)}</span>
            <Button variant="ghost" size="icon" onClick={() => step(1)} aria-label="Next day">
              <ChevronRight style={{ width: 18, height: 18 }} />
            </Button>
          </div>
        </div>

        <Card className="p-6">
          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : day && day.readings.length ? (
            <DevotionView dev={dev} dayKey={dayKey} day={day} index={index} setIndex={setIndex} onOpenVerse={openVerse} />
          ) : (
            <p className="text-muted-foreground">This devotional isn’t available yet for {label(dayKey)}.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
