import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { FileDown, X } from "lucide-react";
import { getSyncStatus } from "@/db/sync";
import { db } from "@/db";
import { useUI } from "@/store/ui";
import { Button } from "@/components/ui";
import { backUpNow, timeAgo } from "@/components/settings/DataSettings";

const BACKUP_NUDGE_DAYS = 30;

/**
 * The monthly "it's been a while since your last backup" nudge. Only for a device
 * with no sync account (with one, the account already holds a copy), only once there
 * is something worth keeping, and "Not now" quiets it for another month.
 */
export function BackupNudge() {
  const enabled = useUI((s) => s.backupReminder);
  const lastBackupAt = useUI((s) => s.lastBackupAt);
  const snoozedAt = useUI((s) => s.backupNudgeSnoozedAt);
  const snooze = useUI((s) => s.snoozeBackupNudge);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getSyncStatus().then((s) => alive && setSignedIn(s.mode !== "off"));
    return () => {
      alive = false;
    };
  }, []);

  // The oldest prayer or journal entry: with no backup yet, the month counts from there.
  const oldest = useLiveQuery(async () => {
    const [p, j] = await Promise.all([db.prayers.orderBy("createdAt").first(), db.journal.orderBy("createdAt").first()]);
    const ts = [p?.createdAt, j?.createdAt].filter((t): t is number => typeof t === "number");
    return ts.length ? Math.min(...ts) : null;
  }, []);

  const month = BACKUP_NUDGE_DAYS * 86_400_000;
  const now = Date.now();
  const since = lastBackupAt ?? oldest ?? null;
  const due = since !== null && now - since >= month && (!snoozedAt || now - snoozedAt >= month);
  if (!enabled || signedIn !== false || !due) return null;

  const backup = async () => {
    setBusy(true);
    setError(null);
    try {
      await backUpNow(); // success moves lastBackupAt, which hides the nudge
    } catch (e) {
      setError(e instanceof Error ? e.message : "The backup couldn’t be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="backup-nudge"
      className="mt-8 flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card/60 px-4 py-3 text-sm backdrop-blur"
    >
      <FileDown size={18} className="shrink-0 text-primary-500" />
      <div className="min-w-0 flex-1 basis-48">
        <span className="font-medium">It’s been a while since your last backup.</span>{" "}
        <span className="text-muted-foreground">
          {lastBackupAt ? `The last one was ${timeAgo(lastBackupAt)}.` : "This device hasn’t made one yet."} A backup file
          keeps your prayers and journal safe if this device is lost.
        </span>
        {error && <div className="mt-1 text-xs text-destructive">{error}</div>}
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline" onClick={() => void backup()} disabled={busy}>
          {busy ? "Backing up…" : "Back up now"}
        </Button>
        <button
          aria-label="Not now"
          title="Not now"
          className="rounded-md p-1 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[44px]"
          onClick={snooze}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

