import { useEffect, useState } from "react";
import { Cloud, CloudOff, RefreshCw, Server } from "lucide-react";
import {
  HOSTED_SYNC_URL,
  getSyncStatus,
  login,
  signOut,
  signup,
  syncNow,
  type SyncMode,
  type SyncStatus,
} from "@/db/sync";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@/components/ui";
import { cn } from "@/lib/cn";

export function SyncSettings() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [mode, setMode] = useState<SyncMode>(HOSTED_SYNC_URL ? "hosted" : "selfhost");
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => getSyncStatus().then(setStatus);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  const signedIn = status && status.mode !== "off";

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
      setError(res.error ?? "Something went wrong.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sync &amp; account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {signedIn ? (
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
              {status && status.pending > 0 ? ` ${status.pending} change(s) pending.` : ""}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void syncNow().then(refresh)}>
                <RefreshCw className="mr-1 h-4 w-4" /> Sync now
              </Button>
              <Button variant="outline" size="sm" onClick={() => void signOut().then(refresh)}>
                Sign out
              </Button>
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

            {mode === "selfhost" && (
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://sync.example.org" spellCheck={false} />
            )}
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="email" spellCheck={false} />
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (8+ characters)"
              autoComplete={isSignup ? "new-password" : "current-password"}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex items-center gap-2">
              <Button onClick={() => void submit()} disabled={busy || !email.trim() || password.length < 8}>
                {busy ? "…" : isSignup ? "Create account" : "Log in"}
              </Button>
              <button className="text-xs text-muted-foreground underline" onClick={() => setIsSignup((v) => !v)}>
                {isSignup ? "I already have an account" : "Create an account"}
              </button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
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
