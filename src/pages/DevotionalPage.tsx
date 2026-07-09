import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  currentSlot,
  devotionKeys,
  getDevotionDay,
  mmdd,
  type DevotionDay,
  type DevotionEntry,
  type Slot,
} from "@/data/devotional";
import { useUI } from "@/store/ui";
import { Button, Card } from "@/components/ui";
import { DevotionView } from "@/components/devotional/DevotionView";

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
  const { goTo } = useUI();
  const [keys, setKeys] = useState<string[]>([]);
  const [dayKey, setDayKey] = useState(mmdd());
  const [slot, setSlot] = useState<Slot>(currentSlot());
  const [day, setDay] = useState<DevotionDay | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    devotionKeys().then(setKeys);
  }, []);

  useEffect(() => {
    setLoading(true);
    getDevotionDay(dayKey).then((d) => {
      setDay(d);
      setLoading(false);
    });
  }, [dayKey]);

  function step(delta: number) {
    if (!keys.length) return;
    const i = keys.indexOf(dayKey);
    const next = (i + delta + keys.length) % keys.length;
    setDayKey(keys[next]);
  }

  function openVerse(e: DevotionEntry) {
    if (e.ho && e.chapter) {
      goTo(e.ho, e.chapter);
      navigate("/bible");
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-8">
        <div className="mb-6 flex items-center gap-3">
          <div>
            <h1 className="font-serif text-3xl font-bold">Morning &amp; Evening</h1>
            <p className="text-sm text-muted-foreground">Daily readings by C.H. Spurgeon</p>
          </div>
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
          ) : day ? (
            <DevotionView dayKey={dayKey} day={day} slot={slot} setSlot={setSlot} onOpenVerse={openVerse} />
          ) : (
            <p className="text-muted-foreground">
              Devotional not available. Run <code>pnpm build:devotional</code> to fetch it.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
