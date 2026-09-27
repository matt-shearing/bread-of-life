import { useEffect, useState } from "react";
import { Cloud, CloudOff, RefreshCw, Server, TriangleAlert } from "lucide-react";
import {
  HOSTED_SYNC_URL,
  accountFeatures,
  changePassword,
  deleteAccount,
  getSyncStatus,
  isInsecureSyncUrl,
  login,
  resolveAccountChoice,
  signOut,
  signOutEverywhere,
  signup,
  subscribeBackfill,
  syncNow,
  type BackfillProgress,
  type SyncMode,
  type SyncStatus,
} from "@/db/sync";
import { Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from "@/components/ui";
import { cn } from "@/lib/cn";

type AccountDialog = null | "password" | "delete";

export function SyncSettings() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [mode, setMode] = useState<SyncMode>(HOSTED_SYNC_URL ? "hosted" : "selfhost");
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [backfill, setBackfill] = useState<BackfillProgress>({ running: false, done: 0, total: 0 });
  const [features, setFeatures] = useState({ logoutAll: false, changePassword: false, deleteAccount: false });
  const [dialog, setDialog] = useState<AccountDialog>(null);

  const refresh = () => getSyncStatus().then(setStatus);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => subscribeBackfill(setBackfill), []);

  const signedIn = !!status && status.mode !== "off";
  useEffect(() => {
    if (signedIn && !status?.signedOut) void accountFeatures().then(setFeatures);
  }, [signedIn, status?.signedOut]);

  // Signing in again after the server refused the old sign-in: same account, same server.
  const reauth = signedIn && !!status?.signedOut;
  useEffect(() => {
    if (reauth && status) {
      setEmail(status.email ?? "");
      setMode(status.mode);
      if (status.url) setUrl(status.url);
      setIsSignup(false);
    }
  }, [reauth]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setError(null);
    setBusy(true);
    const fn = isSignup ? signup : login;
    const res = await fn(mode, mode === "selfhost" ? url : null, email.trim(), password);
    setBusy(false);
    if (res.ok) {
      setPassword("");
      refresh();
    } else {
      setError(res.error);
    }
  };

  const choose = async (choice: "upload" | "keep-local" | "cancel") => {
    if (choice === "cancel") await signOut();
    else await resolveAccountChoice(choice);
    refresh();
  };

  const insecure = mode === "selfhost" && isInsecureSyncUrl(url);

  const form = (
    // A real <form> with name/autocomplete hints so password managers offer to
    // save/fill credentials. NOTE: the manager labels the entry by the webview
    // origin, which is fixed at `tauri.localhost` on Android/Windows (Tauri's
    // internal custom-protocol host — not configurable in Tauri v2), so it can't
    // be renamed to "breadoflife.dev" from the app. These hints at least make it
    // recognise the login and fill the right fields. See docs/MOBILE.md.
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {mode === "selfhost" && !reauth && (
        <Input aria-label="Sync server address" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://sync.example.org" spellCheck={false} />
      )}
      {insecure && !reauth && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This address starts with http://, so your password and everything that syncs would cross the network
          unencrypted. Use an https:// address unless the server is on your own network.
        </p>
      )}
      <Input
        aria-label="Email"
        type="email"
        name="email"
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        spellCheck={false}
        readOnly={reauth}
      />
      <Input
        aria-label="Password"
        type="password"
        name="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password (8+ characters)"
        autoComplete={isSignup ? "new-password" : "current-password"}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy || !email.trim() || password.length < 8}>
          {busy ? "…" : isSignup ? "Create account" : "Log in"}
        </Button>
        {!reauth && (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setIsSignup((v) => !v)}>
            {isSignup ? "I already have an account" : "Create an account"}
          </button>
        )}
      </div>
    </form>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sync &amp; account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {backfill.running && <BackfillBar backfill={backfill} />}
        {signedIn && reauth ? (
          <>
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                You've been signed out of <strong>{status?.email}</strong>, so nothing is syncing. Log in again to carry
                on. Changes made on this device are kept and will upload once you do.
              </div>
            </div>
            {form}
            <Button variant="ghost" size="sm" onClick={() => void signOut().then(refresh)}>
              Stop syncing on this device
            </Button>
          </>
        ) : signedIn ? (
          <>
            <div className="flex items-center gap-2 text-sm">
              <Cloud className="h-4 w-4 text-primary" />
              <span>
                Syncing as <strong>{status?.email}</strong>
                {status?.mode === "selfhost" && " (self-hosted)"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Your prayers, journal, reading progress, notes and plans stay in sync across your devices.
              {status?.lastSyncAt
                ? ` Last synced ${new Date(status.lastSyncAt).toLocaleTimeString()}.`
                : " Waiting for first sync…"}
              {status && status.pending > 0 ? ` ${status.pending} change(s) waiting to upload.` : ""}
              {status && status.waitingForKey > 0
                ? ` ${status.waitingForKey} journal, prayer or note change(s) will upload once you enter your recovery phrase below.`
                : ""}
              {status && status.stuck > 0
                ? ` The server keeps refusing ${status.stuck} change(s); they are safe on this device.`
                : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void syncNow().then(refresh)}>
                <RefreshCw className="mr-1 h-4 w-4" /> Sync now
              </Button>
              <Button variant="outline" size="sm" onClick={() => void signOut().then(refresh)}>
                Sign out
              </Button>
              {features.logoutAll && (
                <Button variant="ghost" size="sm" onClick={() => void signOutEverywhere().then(refresh)}>
                  Sign out on all devices
                </Button>
              )}
              {features.changePassword && (
                <Button variant="ghost" size="sm" onClick={() => setDialog("password")}>
                  Change password
                </Button>
              )}
              {features.deleteAccount && (
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDialog("delete")}>
                  Delete account
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Sign in to carry your data across devices. It's optional — everything works offline on this
              device without an account.
            </p>

            <div className="space-y-2">
              {HOSTED_SYNC_URL && (
                <ModeButton icon={Cloud} active={mode === "hosted"} onClick={() => setMode("hosted")} label="Hosted sync" hint="The app's hosted sync service." />
              )}
              <ModeButton icon={Server} active={mode === "selfhost"} onClick={() => setMode("selfhost")} label="Self-hosted" hint="Your own sync server." />
              <ModeButton icon={CloudOff} active={false} onClick={() => void signOut().then(refresh)} label="Local only" hint="Stay offline on this device (default)." />
            </div>
            {form}
          </>
        )}
      </CardContent>

      {/* Signed in to a different account while this device holds data. */}
      <Dialog open={!!status?.needsAccountChoice} onOpenChange={(o) => !o && void choose("cancel")}>
        <DialogContent>
          <DialogTitle>Add this device's data to {status?.email}?</DialogTitle>
          <DialogDescription>
            This device holds prayers, journal entries or reading progress from the account you used before. You can
            copy them into {status?.email}, or keep them on this device only. If you keep them here, anything you
            change later will still sync to {status?.email}.
          </DialogDescription>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => void choose("cancel")}>
              Sign out
            </Button>
            <Button variant="outline" onClick={() => void choose("keep-local")}>
              Keep on this device
            </Button>
            <Button onClick={() => void choose("upload")}>Copy to this account</Button>
          </div>
        </DialogContent>
      </Dialog>

      <PasswordDialog open={dialog === "password"} onClose={() => setDialog(null)} />
      <DeleteAccountDialog
        open={dialog === "delete"}
        email={status?.email ?? ""}
        onClose={() => {
          setDialog(null);
          refresh();
        }}
      />
    </Card>
  );
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setCurrent("");
    setNext("");
    setError(null);
    onClose();
  };
  const submit = async () => {
    setBusy(true);
    const r = await changePassword(current, next);
    setBusy(false);
    if (r.ok) close();
    else setError(r.error ?? "Couldn't change the password.");
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogTitle>Change password</DialogTitle>
        <DialogDescription>Your other devices will be signed out and need the new password.</DialogDescription>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input aria-label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" />
          <Input aria-label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (8+ characters)" />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !current || next.length < 8}>
              {busy ? "…" : "Change password"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteAccountDialog({ open, email, onClose }: { open: boolean; email: string; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setPassword("");
    setError(null);
    onClose();
  };
  const submit = async () => {
    setBusy(true);
    const r = await deleteAccount(password);
    setBusy(false);
    if (r.ok) close();
    else setError(r.error ?? "Couldn't delete the account.");
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogTitle>Delete {email}?</DialogTitle>
        <DialogDescription>
          This deletes the account and everything the sync server holds for it, and signs out every device. It can't
          be undone. Your prayers, journal and progress stay on this device, and on your other devices, until you remove
          them there.
        </DialogDescription>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input aria-label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || password.length < 8}>
              {busy ? "…" : "Delete account"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BackfillBar({ backfill }: { backfill: BackfillProgress }) {
  const pct = backfill.total > 0 ? Math.round((backfill.done / backfill.total) * 100) : 100;
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center gap-2 text-sm">
        <RefreshCw className="h-4 w-4 animate-spin text-primary" />
        <span>Preparing your library for its first upload…</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {backfill.done}/{backfill.total}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ModeButton({
  icon: Icon,
  active,
  onClick,
  label,
  hint,
}: {
  icon: typeof Cloud;
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
        active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span className="flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}
