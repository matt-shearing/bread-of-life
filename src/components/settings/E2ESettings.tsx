import { useEffect, useState } from "react";
import { KeyRound, Lock, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  getE2EStatus,
  enableE2E,
  disableE2E,
  restoreE2E,
  getRecoveryPhrase,
} from "@/db/sync";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Textarea,
} from "@/components/ui";

export function E2ESettings() {
  const [status, setStatus] = useState<{ enabled: boolean; needsKey: boolean }>({ enabled: false, needsKey: false });
  const [phrase, setPhrase] = useState<string | null>(null); // shown in the reveal dialog
  const [confirming, setConfirming] = useState(false); // enable confirmation
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreText, setRestoreText] = useState("");
  const [restoreErr, setRestoreErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => setStatus(getE2EStatus());
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  async function doEnable() {
    setBusy(true);
    try {
      const p = await enableE2E();
      setConfirming(false);
      setPhrase(p);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function doReveal() {
    const p = await getRecoveryPhrase();
    if (p) setPhrase(p);
  }

  async function doRestore() {
    setRestoreErr(null);
    setBusy(true);
    try {
      const ok = await restoreE2E(restoreText.trim());
      if (!ok) {
        setRestoreErr("That doesn't look like a valid 24-word recovery phrase. Check the words and spacing.");
        return;
      }
      setRestoreOpen(false);
      setRestoreText("");
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock style={{ width: 16, height: 16 }} /> End-to-end encryption
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.needsKey && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
            <TriangleAlert style={{ width: 16, height: 16 }} className="mt-0.5 shrink-0 text-amber-600" />
            <div>
              Some synced entries are locked on this device. Enter your recovery phrase to unlock them.
              <button className="ml-1 font-semibold underline" onClick={() => setRestoreOpen(true)}>
                Restore now
              </button>
            </div>
          </div>
        )}

        {status.enabled ? (
          <>
            <div className="flex items-center gap-2 text-sm text-success">
              <ShieldCheck style={{ width: 16, height: 16 }} />
              Your journal, prayers and notes are encrypted before they sync. The server can’t read them.
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={doReveal}>
                <KeyRound style={{ width: 15, height: 15 }} /> Show recovery phrase
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { disableE2E(); refresh(); }}>
                Turn off on this device
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Encrypt your journal, prayers and notes so that only your devices can read them — not even the
              sync server. You’ll get a 24-word recovery phrase; it’s the only way to read your synced data on
              a new device, so keep it somewhere safe. Reading position, highlights and settings still sync
              normally.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setConfirming(true)}>
                <Lock style={{ width: 15, height: 15 }} /> Turn on encryption
              </Button>
              <Button variant="outline" size="sm" onClick={() => setRestoreOpen(true)}>
                Restore from recovery phrase
              </Button>
            </div>
          </>
        )}
      </CardContent>

      {/* Enable confirmation */}
      <Dialog open={confirming} onOpenChange={(o) => !o && setConfirming(false)}>
        <DialogContent>
          <DialogTitle>Turn on end-to-end encryption?</DialogTitle>
          <DialogDescription>
            We’ll generate a private key that stays on your devices and show you a 24-word recovery phrase.
            <strong> Write it down and keep it safe.</strong> If you lose it, encrypted data on other devices
            can’t be recovered — we have no way to reset it. Your data on this device is always readable.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={doEnable} disabled={busy}>
              {busy ? "Setting up…" : "Turn on & show my phrase"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Recovery phrase reveal */}
      <Dialog open={phrase !== null} onOpenChange={(o) => !o && setPhrase(null)}>
        <DialogContent>
          <DialogTitle>Your recovery phrase</DialogTitle>
          <DialogDescription>
            Write these 24 words down in order and keep them somewhere safe. Anyone with this phrase can read
            your synced data; without it, it can’t be recovered.
          </DialogDescription>
          {phrase && (
            <ol className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-border bg-muted/40 p-4 text-sm sm:grid-cols-3">
              {phrase.split(" ").map((w, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-5 shrink-0 text-right text-muted-foreground">{i + 1}.</span>
                  <span className="font-medium">{w}</span>
                </li>
              ))}
            </ol>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => phrase && navigator.clipboard?.writeText(phrase)}>
              Copy
            </Button>
            <Button onClick={() => setPhrase(null)}>I’ve saved it</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Restore */}
      <Dialog open={restoreOpen} onOpenChange={(o) => !o && setRestoreOpen(false)}>
        <DialogContent>
          <DialogTitle>Restore from recovery phrase</DialogTitle>
          <DialogDescription>
            Enter the 24-word phrase from when you turned on encryption. Your synced journal, prayers and notes
            will unlock and decrypt on this device.
          </DialogDescription>
          <Textarea
            value={restoreText}
            onChange={(e) => setRestoreText(e.target.value)}
            placeholder="word1 word2 word3 …"
            rows={3}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {restoreErr && <p className="text-sm text-destructive">{restoreErr}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRestoreOpen(false)}>
              Cancel
            </Button>
            <Button onClick={doRestore} disabled={busy || !restoreText.trim()}>
              {busy ? "Restoring…" : "Restore"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
