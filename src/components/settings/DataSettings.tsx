import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Archive, FileDown, FileUp, ShieldCheck } from "lucide-react";
import { db } from "@/db";
import { getSyncStatus } from "@/db/sync";
import { useUI } from "@/store/ui";
import { version as APP_VERSION } from "../../../package.json";
import {
  applyRestore,
  BackupError,
  backupFileName,
  createBackup,
  describeContents,
  describeEffect,
  parseBackup,
  previewRestore,
  serializeBackup,
  type RestorePlan,
} from "@/lib/backup";
import { createMarkdownZip, markdownExportFileName } from "@/lib/markdownExport";
import { openTextFile, saveFile } from "@/lib/fileIO";
import { localDayKey } from "@/lib/day";
import { Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui";

function describeErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** "today", "yesterday", "3 days ago", "2 months ago" — by LOCAL calendar day. */
export function timeAgo(ts: number, now: number = Date.now()): string {
  const day = (t: number) => {
    const [y, m, d] = localDayKey(t).split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86_400_000;
  };
  const days = Math.round(day(now) - day(ts));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 60) return `${days} days ago`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} months ago`;
  return `${Math.round(days / 365.25)} years ago`;
}

/** Where a saved file went, in words. A content:// URI means nothing to a person. */
function savedWhere(where: string): string {
  if (where === "download") return "Saved to your downloads.";
  if (where.startsWith("content://")) return "Saved.";
  return `Saved to ${where}.`;
}

/**
 * Make a backup file and hand it to the save dialog. Shared by Settings and the
 * dashboard reminder. Returns a sentence for the UI, or null if the user cancelled.
 */
export async function backUpNow(): Promise<string | null> {
  const backup = await createBackup(APP_VERSION);
  const where = await saveFile({
    fileName: backupFileName(),
    bytes: new TextEncoder().encode(serializeBackup(backup)),
    mime: "application/json",
    filter: { name: "Bread of Life backup", extensions: ["json"] },
  });
  if (!where) return null;
  useUI.getState().setLastBackupAt(Date.now());
  return savedWhere(where);
}

type Status = { kind: "ok" | "error"; text: string } | null;

/** Settings → "Your data": counts, back up, restore, Markdown export. */
export function DataSettings() {
  const lastBackupAt = useUI((s) => s.lastBackupAt);
  const backupReminder = useUI((s) => s.backupReminder);
  const setBackupReminder = useUI((s) => s.setBackupReminder);
  const [busy, setBusy] = useState<null | "backup" | "restore" | "export">(null);
  const [status, setStatus] = useState<Status>(null);
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [planFile, setPlanFile] = useState("");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    getSyncStatus().then((s) => alive && setSignedIn(s.mode !== "off"));
    return () => {
      alive = false;
    };
  }, []);

  const counts = useLiveQuery(
    async () => ({
      highlights: await db.highlights.count(),
      notes: await db.notes.count(),
      prayers: await db.prayers.count(),
      journal: await db.journal.count(),
    }),
    [],
    { highlights: 0, notes: 0, prayers: 0, journal: 0 },
  );

  async function run(kind: "backup" | "restore" | "export", fn: () => Promise<void>) {
    setBusy(kind);
    setStatus(null);
    try {
      await fn();
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof BackupError ? e.message : `Something went wrong: ${describeErr(e)}` });
    } finally {
      setBusy(null);
    }
  }

  const backup = () =>
    run("backup", async () => {
      const said = await backUpNow();
      if (said) setStatus({ kind: "ok", text: said });
    });

  const pickRestore = () =>
    run("restore", async () => {
      const file = await openTextFile({ name: "Bread of Life backup", extensions: ["json"] });
      if (!file) return;
      const parsed = parseBackup(file.text);
      setPlanFile(file.name);
      setPlan(await previewRestore(parsed));
    });

  const confirmRestore = () =>
    run("restore", async () => {
      if (!plan) return;
      const r = await applyRestore(plan.parsed);
      setPlan(null);
      const bits = [`${r.added.toLocaleString()} added`, `${r.updated.toLocaleString()} updated`];
      let text = `Restored: ${bits.join(", ")}.`;
      if (r.kept) text += ` ${r.kept.toLocaleString()} newer ${r.kept === 1 ? "item" : "items"} on this device ${r.kept === 1 ? "was" : "were"} kept.`;
      if (r.added + r.updated === 0) text = "Nothing to restore — this device already had everything in that backup.";
      setStatus({ kind: "ok", text });
    });

  const exportMarkdown = () =>
    run("export", async () => {
      const { bytes, files } = await createMarkdownZip();
      const where = await saveFile({
        fileName: markdownExportFileName(),
        bytes,
        mime: "application/zip",
        filter: { name: "Zip archive", extensions: ["zip"] },
      });
      if (where) setStatus({ kind: "ok", text: `${savedWhere(where)} ${files} Markdown ${files === 1 ? "file" : "files"}, zipped.` });
    });

  const exportedAt = plan?.parsed.backup.exportedAt ? new Date(plan.parsed.backup.exportedAt) : null;
  const canRestore = !!plan && plan.totals.add + plan.totals.update > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          {counts.highlights} highlights · {counts.notes} notes · {counts.prayers} prayers · {counts.journal} journal entries
        </p>

        <div className="rounded-md border border-border bg-background/60 p-3">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
            <div className="min-w-0">
              <div className="font-medium" data-testid="last-backup">
                {lastBackupAt ? `Last backup: ${timeAgo(lastBackupAt)}` : "Not backed up on this device yet"}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                A backup is one file holding all your prayers, journal, notes, highlights, plans and memory
                verses. Keep it somewhere safe; restoring it merges with what’s here and never deletes
                anything.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void backup()} disabled={busy !== null}>
              <FileDown className="h-4 w-4" />
              {busy === "backup" ? "Backing up…" : "Back up now"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void pickRestore()} disabled={busy !== null}>
              <FileUp className="h-4 w-4" />
              {busy === "restore" ? "Reading…" : "Restore from backup…"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void exportMarkdown()} disabled={busy !== null}>
              <Archive className="h-4 w-4" />
              {busy === "export" ? "Exporting…" : "Export as Markdown"}
            </Button>
          </div>
          {status && (
            <p
              role="status"
              data-testid="data-status"
              className={
                status.kind === "error"
                  ? "mt-3 break-words text-xs text-destructive"
                  : "mt-3 break-words text-xs text-muted-foreground"
              }
            >
              {status.text}
            </p>
          )}
        </div>

        {signedIn === false && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-primary"
              checked={backupReminder}
              onChange={(e) => setBackupReminder(e.target.checked)}
            />
            <span>
              Remind me on the dashboard once a month
              <span className="block text-xs text-muted-foreground">
                Only while this device has no sync account.
              </span>
            </span>
          </label>
        )}

        <p className="text-xs text-muted-foreground">
          Export as Markdown saves your journal (one file per entry), prayers and notes as plain text that
          opens in any editor or an Obsidian vault. It is for reading, not for restoring.
        </p>
        <p className="text-xs text-muted-foreground">
          Everything is stored locally on this device (offline-first). Scripture is the Berean Standard
          Bible, public domain (CC0).
        </p>
      </CardContent>

      <Dialog open={!!plan} onOpenChange={(o) => !o && busy === null && setPlan(null)}>
        <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] overflow-y-auto">
          <DialogTitle>Restore from backup</DialogTitle>
          {plan && (
            <>
              <DialogDescription>
                {planFile}
                {exportedAt && !Number.isNaN(exportedAt.getTime())
                  ? ` · made ${exportedAt.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}`
                  : ""}
                {plan.parsed.backup.appVersion ? ` · version ${plan.parsed.backup.appVersion}` : ""}
              </DialogDescription>
              <div className="space-y-2 text-sm" data-testid="restore-preview">
                <p>
                  <span className="font-medium">In this backup:</span> {describeContents(plan)}.
                </p>
                {describeEffect(plan).map((line) => (
                  <p key={line} className="text-muted-foreground">
                    {line}
                  </p>
                ))}
                {(plan.parsed.invalidRows > 0 || plan.parsed.unknownTables.length > 0) && (
                  <p className="text-xs text-muted-foreground">
                    {plan.parsed.invalidRows > 0 && `${plan.parsed.invalidRows} damaged items will be skipped. `}
                    {plan.parsed.unknownTables.length > 0 &&
                      "Some data is from a newer version of the app and will be skipped."}
                  </p>
                )}
                {status?.kind === "error" && (
                  <p role="alert" className="break-words text-xs text-destructive">
                    {status.text}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Nothing on this device is deleted.{plan.skippedDeviceSettings > 0 && " Settings that belong to the device that made the backup stay there."}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => setPlan(null)} disabled={busy !== null}>
                  Cancel
                </Button>
                <Button onClick={() => void confirmRestore()} disabled={busy !== null || !canRestore}>
                  {busy === "restore" ? "Restoring…" : "Restore"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
