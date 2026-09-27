import { useState } from "react";
import { Bot, Check, ClipboardPaste, Copy, ExternalLink, ListChecks } from "lucide-react";
import { useUI } from "@/store/ui";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input, Tabs } from "@/components/ui";
import { GUIDES, agentPrompt, claudeUrl, cleanKey, type SetupProvider } from "@/data/licensed/setupGuide";
import { openExternal } from "@/lib/external";
import { cn } from "@/lib/cn";
import { checkAndSaveKey, findAndSaveApiBible } from "./bibleKeyActions";
import { KeySyncOffer } from "./KeySyncOffer";

/**
 * Guided setup for one publisher's key: the sign-up steps with their links, then a paste
 * step that checks the key with a test read. The step is remembered per device, because
 * an API.Bible account can take a day or more to be approved. A second tab gives a prompt
 * for the user's own browser-using AI agent.
 */
export function KeySetupDialog({
  provider,
  open,
  onOpenChange,
}: {
  provider: SetupProvider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const g = GUIDES[provider];
  const [mode, setMode] = useState<"self" | "agent">("self");
  const saved = useUI((s) => s.keySetupStep[provider]);
  const setStep = useUI((s) => s.setKeySetupStep);
  const pasteStep = g.steps.length; // the step after the guide's own
  const [finished, setFinished] = useState(false);
  const step = finished ? pasteStep : Math.min(saved ?? 0, pasteStep);
  const go = (n: number) => setStep(provider, n);
  const close = (o: boolean) => {
    // Finished: the next setup starts at the beginning. Otherwise it resumes where it was.
    if (!o && finished) setStep(provider, null);
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto p-5 sm:p-6">
        <DialogTitle className="pr-10">Get your {g.name} key</DialogTitle>
        <DialogDescription>
          A free key of your own lets Bread of Life read {g.reads}. It takes a few minutes, plus any wait for approval.
        </DialogDescription>
        <Tabs
          label="How to get the key"
          value={mode}
          onValueChange={setMode}
          tabs={[
            { value: "self", label: "Step by step", icon: <ListChecks size={15} aria-hidden /> },
            { value: "agent", label: "Ask my AI agent", icon: <Bot size={15} aria-hidden /> },
          ]}
        >
          <div className="pt-4">
            {mode === "self" ? (
              <Steps provider={provider} step={step} go={go} onSaved={() => setFinished(true)} onDone={() => close(false)} />
            ) : (
              <AgentPanel provider={provider} onPaste={() => {
                setMode("self");
                go(pasteStep);
              }} />
            )}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Steps({
  provider,
  step,
  go,
  onSaved,
  onDone,
}: {
  provider: SetupProvider;
  step: number;
  go: (n: number) => void;
  onSaved: () => void;
  onDone: () => void;
}) {
  const g = GUIDES[provider];
  const all = [...g.steps.map((s) => s.title), "Paste your key"];
  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-1.5" aria-label="Steps">
        {all.map((title, i) => (
          <li key={title}>
            <button
              onClick={() => go(i)}
              aria-current={i === step ? "step" : undefined}
              className={cn(
                "flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-xs font-semibold [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11",
                i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-primary/15 text-primary-700 dark:text-primary-300" : "bg-muted text-muted-foreground",
              )}
              aria-label={`Step ${i + 1}: ${title}`}
            >
              {i < step ? <Check size={14} aria-hidden /> : i + 1}
            </button>
          </li>
        ))}
      </ol>
      {step < g.steps.length ? (
        <div className="space-y-3">
          <h3 className="text-base font-semibold">
            {step + 1}. {g.steps[step].title}
          </h3>
          <p className="text-sm text-muted-foreground">{g.steps[step].body}</p>
          {g.steps[step].link && (
            <Button variant="outline" size="sm" onClick={() => void openExternal(g.steps[step].link!.href)}>
              <ExternalLink size={14} aria-hidden /> {g.steps[step].link!.label}
            </Button>
          )}
          <div className="flex flex-wrap justify-between gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => go(step - 1)} disabled={step === 0}>
              Back
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => go(g.steps.length)}>
                I have a key
              </Button>
              <Button size="sm" onClick={() => go(step + 1)}>
                Next
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <PasteStep provider={provider} back={() => go(g.steps.length - 1)} onSaved={onSaved} onDone={onDone} />
      )}
    </div>
  );
}

function PasteStep({ provider, back, onSaved, onDone }: { provider: SetupProvider; back: () => void; onSaved: () => void; onDone: () => void }) {
  const g = GUIDES[provider];
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [done, setDone] = useState(false);

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setDraft(text.trim());
      else setStatus({ ok: false, text: "The clipboard is empty. Copy the key first." });
    } catch {
      setStatus({ ok: false, text: "This device didn’t allow reading the clipboard. Paste into the box instead." });
    }
  }

  async function save() {
    const c = cleanKey(draft);
    if ("error" in c) {
      setStatus({ ok: false, text: c.error });
      return;
    }
    setDraft(c.key);
    setBusy(true);
    setStatus(null);
    const r = provider === "apiBible" ? await findAndSaveApiBible(c.key, { pick: true }) : await checkAndSaveKey(provider, c.key);
    setBusy(false);
    setStatus(r);
    if (r.ok) {
      setDone(true);
      onSaved();
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">{g.steps.length + 1}. Paste your key</h3>
      {g.waiting && <p className="text-sm text-muted-foreground">{g.waiting}</p>}
      <Field label={`${g.name} key`}>
        {(id) => (
          <div className="flex flex-wrap gap-2">
            <Input
              id={id}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Paste your key"
              className="min-w-0 flex-1 basis-48"
              disabled={done}
            />
            <Button variant="outline" size="sm" onClick={paste} disabled={done}>
              <ClipboardPaste size={14} aria-hidden /> Paste
            </Button>
          </div>
        )}
      </Field>
      {status && (
        <p role="status" className={status.ok ? "text-sm text-primary-700 dark:text-primary-300" : "text-sm text-destructive"}>
          {status.text}
          {status.ok && provider === "apiBible" && " NASB and the Amplified Bible are added to the translation menu if your key can read them."}
        </p>
      )}
      {done && <KeySyncOffer />}
      <div className="flex flex-wrap justify-between gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={back} disabled={done}>
          Back
        </Button>
        {done ? (
          <Button size="sm" onClick={onDone}>
            Done
          </Button>
        ) : (
          <Button size="sm" onClick={save} disabled={busy || !draft.trim()}>
            {busy ? "Checking…" : "Check and save"}
          </Button>
        )}
      </div>
    </div>
  );
}

function AgentPanel({ provider, onPaste }: { provider: SetupProvider; onPaste: () => void }) {
  const prompt = agentPrompt(provider);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* the text is selectable below */
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        If you use an AI agent that can drive a web browser (Claude with a browser, ChatGPT’s agent, and the like), give
        it this prompt. It tells the agent to stop for anything only you should do: accepting terms, your personal
        details, email checks and approvals. It may not get all the way; you will still need to check your email.
      </p>
      <textarea
        readOnly
        aria-label="Prompt for your AI agent"
        value={prompt}
        rows={9}
        className="w-full resize-y rounded-md border border-input bg-muted/40 p-3 font-mono text-xs leading-relaxed"
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={copy}>
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? "Copied" : "Copy prompt"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void openExternal(claudeUrl(prompt))}>
          <ExternalLink size={14} aria-hidden /> Open in Claude
        </Button>
        <Button variant="ghost" size="sm" onClick={onPaste}>
          I have the key
        </Button>
      </div>
    </div>
  );
}
