import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  Cloud,
  CloudOff,
  HandHeart,
  NotebookPen,
  Server,
  Sparkles,
  Sunrise,
} from "lucide-react";
import {
  HOSTED_SYNC_URL,
  login,
  signup,
  subscribeBackfill,
  type BackfillProgress,
  type SyncMode,
} from "@/db/sync";
import { useUI } from "@/store/ui";
import { Button, Input } from "@/components/ui";
import { BackfillBar } from "@/components/settings/SyncSettings";
import { cn } from "@/lib/cn";

/**
 * First-run welcome: a short walkthrough of the main features, then an optional
 * offer to create (or sign in to) a sync account. Everything works offline
 * without an account, so "Skip" is always a first-class choice.
 */
export function Onboarding() {
  const hasOnboarded = useUI((s) => s.hasOnboarded);
  const setHasOnboarded = useUI((s) => s.setHasOnboarded);
  const [step, setStep] = useState(0);

  if (hasOnboarded) return null;

  const finish = () => setHasOnboarded(true);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-primary-900/40 p-4 backdrop-blur-sm pt-[env(safe-area-inset-top)]">
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
        <div className="flex-1 overflow-y-auto">
          {step === 0 && <WelcomeStep />}
          {step === 1 && <FeaturesStep />}
          {step === 2 && <SyncStep onDone={finish} />}
        </div>
        <div className="flex items-center gap-3 border-t border-border px-6 py-4">
          <Dots step={step} total={3} />
          {step < 2 ? (
            <>
              <button className="ml-auto text-sm text-muted-foreground hover:text-foreground" onClick={finish}>
                Skip
              </button>
              <Button onClick={() => setStep((s) => s + 1)}>
                {step === 0 ? "Take the tour" : "Next"} <ArrowRight style={{ width: 15, height: 15 }} />
              </Button>
            </>
          ) : (
            <div className="ml-auto" />
          )}
        </div>
      </div>
    </div>
  );
}

function Dots({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn("h-1.5 rounded-full transition-all", i === step ? "w-5 bg-primary" : "w-1.5 bg-muted")}
        />
      ))}
    </div>
  );
}

function WelcomeStep() {
  return (
    <div className="px-7 py-10 text-center">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-card">
        <BookOpen style={{ width: 30, height: 30 }} />
      </div>
      <h1 className="font-serif text-3xl font-bold">Welcome to Bread of Life</h1>
      <p className="mx-auto mt-3 max-w-sm text-muted-foreground">
        A warm, offline-first homebase for reading Scripture, journalling, and — the heart of it — an
        answered-prayer log you can look back on.
      </p>
      <p className="mt-4 text-sm text-muted-foreground">
        Everything lives on this device. No account is required.
      </p>
    </div>
  );
}

const FEATURES = [
  { icon: BookOpen, title: "A warm reader", body: "The Berean Standard Bible with commentary, cross-references, and a study rail." },
  { icon: HandHeart, title: "Answered-prayer log", body: "Keep your prayers, mark them answered, and look back on God's faithfulness." },
  { icon: NotebookPen, title: "Journal", body: "Write reflections and link them to the verses that moved you." },
  { icon: Sunrise, title: "Plans & devotionals", body: "Build a daily rhythm with reading plans and classic devotionals." },
  { icon: Sparkles, title: "AI study companion", body: "Optional — bring your own key to ask questions about the passage you're reading." },
];

function FeaturesStep() {
  return (
    <div className="px-7 py-8">
      <h2 className="font-serif text-2xl font-bold">What's inside</h2>
      <p className="mt-1 text-sm text-muted-foreground">A quick look at the main things you can do.</p>
      <ul className="mt-5 space-y-4">
        {FEATURES.map((f) => (
          <li key={f.title} className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-600">
              <f.icon style={{ width: 20, height: 20 }} />
            </div>
            <div>
              <div className="font-semibold">{f.title}</div>
              <div className="text-sm text-muted-foreground">{f.body}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SyncStep({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<SyncMode>(HOSTED_SYNC_URL ? "hosted" : "selfhost");
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignup, setIsSignup] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [backfill, setBackfill] = useState<BackfillProgress>({ running: false, done: 0, total: 0 });

  useEffect(() => subscribeBackfill(setBackfill), []);

  const submit = async () => {
    setError(null);
    setBusy(true);
    const fn = isSignup ? signup : login;
    const res = await fn(mode, mode === "selfhost" ? url : null, email.trim(), password);
    setBusy(false);
    if (res.ok) setDone(true);
    else setError(res.error ?? "Something went wrong.");
  };

  if (done) {
    return (
      <div className="px-7 py-10 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-success">
          <Check style={{ width: 30, height: 30 }} />
        </div>
        <h2 className="font-serif text-2xl font-bold">You're all set</h2>
        <p className="mx-auto mt-3 max-w-sm text-muted-foreground">
          Your library is syncing to <strong>{email.trim()}</strong>. Sign in with the same account on
          another device and everything will follow you there.
        </p>
        {backfill.running && (
          <div className="mt-5 text-left">
            <BackfillBar backfill={backfill} />
          </div>
        )}
        <Button className="mt-6" onClick={onDone} disabled={backfill.running}>
          {backfill.running ? "Uploading your library…" : "Start reading"}
        </Button>
      </div>
    );
  }

  return (
    <div className="px-7 py-8">
      <h2 className="font-serif text-2xl font-bold">Sync across your devices</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Optional. Create an account to carry your prayers, journal, and progress to your phone and back.
        You can always do this later in Settings.
      </p>

      <div className="mt-5 space-y-2">
        {HOSTED_SYNC_URL && (
          <ModeButton
            icon={Cloud}
            active={mode === "hosted"}
            onClick={() => setMode("hosted")}
            label="Hosted sync"
            hint="The app's hosted sync service — the easy option."
          />
        )}
        <ModeButton
          icon={Server}
          active={mode === "selfhost"}
          onClick={() => setMode("selfhost")}
          label="Self-hosted"
          hint="Point at your own sync server."
        />
      </div>

      {mode === "selfhost" && (
        <Input
          className="mt-3"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://sync.example.org"
          spellCheck={false}
        />
      )}
      <Input
        className="mt-3"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        autoComplete="email"
        spellCheck={false}
      />
      <Input
        className="mt-3"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password (8+ characters)"
        autoComplete={isSignup ? "new-password" : "current-password"}
      />
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={() => void submit()} disabled={busy || !email.trim() || password.length < 8}>
          {busy ? "…" : isSignup ? "Create account" : "Log in"}
        </Button>
        <button className="text-xs text-muted-foreground underline" onClick={() => setIsSignup((v) => !v)}>
          {isSignup ? "I already have an account" : "Create an account"}
        </button>
        <button
          className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          onClick={onDone}
        >
          <CloudOff style={{ width: 15, height: 15 }} /> Stay local-only
        </button>
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
