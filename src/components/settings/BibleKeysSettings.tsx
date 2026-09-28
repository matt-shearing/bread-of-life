import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink, KeyRound, Wand2 } from "lucide-react";
import { useUI, type ApiBibleChoice, type BibleKeys } from "@/store/ui";
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Switch } from "@/components/ui";
import { APIBIBLE_PREFIX, ESV_TRANSLATION, NLT_TRANSLATION, apiBibleTranslation, clearLicensedCache } from "@/data/licensed";
import type { ApiBibleSummary } from "@/data/licensed/apibible";
import { knownApiBible } from "@/data/licensed/catalog";
import type { SetupProvider } from "@/data/licensed/setupGuide";
import { FREE_TRANSLATIONS, type Translation } from "@/data/bible";
import { keySyncState, shareKeyHere, adoptSyncedKey, type KeyId } from "@/store/keySync";
import { checkAndSaveKey, findAndSaveApiBible, useKeySyncInfo } from "./bibleKeyActions";
import { KeySetupDialog } from "./KeySetupDialog";
import { KeySyncOffer, KeySyncSwitch } from "./KeySyncOffer";

/**
 * Your own keys for the publishers' Bible APIs. Each key stays on this device (like the
 * AI key) unless you turn on "Sync my keys", which shares them with your other devices
 * end-to-end encrypted only (src/store/keySync.ts). See src/data/licensed/ for what is
 * fetched and how little of it is kept.
 */
export function BibleKeysSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bible translations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          The BSB and {FREE_TRANSLATIONS.length - 1} other free translations need nothing: pick them in the Bible’s translation menu.
          Copyrighted translations are read from their publisher’s own service with a free key that you get
          for yourself. Bread of Life never ships their text or a key. Only a little of each licensed text is kept for
          offline reading, as its licence requires.
        </p>

        <KeySyncSwitch />

        <ProviderKey
          provider="esv"
          title="ESV — English Standard Version"
          steps={
            <>
              Sign in at <Link href="https://api.esv.org/account/create-application/">api.esv.org</Link> and create an
              application for your own use. It is free for non-commercial use; Crossway asks you to agree with its
              statement of faith. Copy the application’s key here.
            </>
          }
          terms="Crossway’s terms: at most 500 verses stored on the device and never more than half of a book on screen, so a one-chapter book such as Jude opens in parts. Each quotation is marked (ESV)."
          test={ESV_TRANSLATION}
        />

        <ProviderKey
          provider="nlt"
          title="NLT — New Living Translation"
          steps={
            <>
              Register at <Link href="https://api.nlt.to/Account/Register">api.nlt.to</Link> (Tyndale House) and
              request a key for non-commercial use. Paste it here.
            </>
          }
          terms="Tyndale’s terms: non-commercial use, up to 5,000 requests a day, and no more than 500 verses kept. Copied verses carry Tyndale’s credit line."
          test={NLT_TRANSLATION}
        />

        <ApiBibleKey />

        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Not available</p>
          <p className="mt-1">
            The Legacy Standard Bible (LSB) is not offered through any public API; Three Sixteen Publishing licenses
            it to apps by agreement. API.Bible lists the NIV under a separate licence from Biblica, which a free
            Starter key may not include.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/** "Help me get a key": opens the guided setup. */
function SetupButton({ provider, show }: { provider: SetupProvider; show: boolean }) {
  const [open, setOpen] = useState(false);
  // The dialog stays mounted after its key is saved, so it can finish (and offer key sync).
  return (
    <>
      {show && (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Wand2 size={14} aria-hidden /> Help me get a key
        </Button>
      )}
      {open && <KeySetupDialog provider={provider} open={open} onOpenChange={setOpen} />}
    </>
  );
}

/** Where this key stands with the user's other devices; offers the choice when they differ. */
function SyncedKeyStatus({ id }: { id: KeyId }) {
  const { rows } = useKeySyncInfo();
  const keySync = useUI((s) => s.keySync);
  const bibleKeys = useUI((s) => s.bibleKeys);
  const keySyncAgreed = useUI((s) => s.keySyncAgreed);
  const st = keySyncState(id, { keySync, bibleKeys, keySyncAgreed }, rows.get(id));
  if (st.kind === "from-other") return <p className="text-xs text-primary-700 dark:text-primary-300">Using the key from your other devices.</p>;
  if (st.kind === "shared") return <p className="text-xs text-muted-foreground">Shared with your other devices, encrypted.</p>;
  if (st.kind !== "conflict") return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs dark:border-amber-800 dark:bg-amber-950/30">
      <span className="min-w-0 flex-1 basis-52">Your other devices use a different key. This device keeps its own until you choose.</span>
      <Button size="sm" variant="outline" onClick={() => void adoptSyncedKey(id)}>
        Use theirs here
      </Button>
      <Button size="sm" variant="ghost" onClick={() => void shareKeyHere(id)}>
        Use this one everywhere
      </Button>
    </div>
  );
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary-700 underline-offset-2 hover:underline dark:text-primary-400">
      {children}
      <ExternalLink size={11} aria-hidden />
    </a>
  );
}

/** One provider's key: a password field, Save / Remove, and a test read of John 3. */
function ProviderKey({
  provider,
  title,
  steps,
  terms,
  test,
}: {
  provider: Exclude<keyof BibleKeys, "apiBible">;
  title: string;
  steps: ReactNode;
  terms: string;
  test: Translation;
}) {
  const saved = useUI((s) => s.bibleKeys[provider]);
  const setBibleKey = useUI((s) => s.setBibleKey);
  const keySync = useUI((s) => s.keySync);
  const [draft, setDraft] = useState(saved);
  // A key that arrives from another device (or the guided setup) shows here too.
  useEffect(() => setDraft(saved), [saved]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const key = draft.trim();
    if (!key) return;
    setBusy(true);
    setStatus(null);
    setStatus(await checkAndSaveKey(provider, key));
    setBusy(false);
  }

  async function remove() {
    setBibleKey(provider, "");
    setDraft("");
    await clearLicensedCache(test).catch(() => {});
    setStatus({
      ok: true,
      text: `Key removed, and the ${test.short} text kept on this device was deleted.${keySync ? " It is removed from your other devices too." : ""}`,
    });
  }

  return (
    <section className="space-y-2" aria-label={title}>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <KeyRound size={14} className="text-muted-foreground" aria-hidden />
        {title}
        {saved && <span className="shrink-0 whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary-700 dark:text-primary-300">key saved</span>}
      </h3>
      <p className="text-xs text-muted-foreground">{steps}</p>
      <Field label={`${test.short} API key`}>
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
            />
            <Button size="sm" onClick={save} disabled={busy || !draft.trim() || draft.trim() === saved}>
              {busy ? "Checking…" : "Check and save"}
            </Button>
            {saved && (
              <Button size="sm" variant="outline" onClick={remove}>
                Remove
              </Button>
            )}
          </div>
        )}
      </Field>
      {status && (
        <p role="status" className={status.ok ? "text-xs text-primary-700 dark:text-primary-300" : "text-xs text-destructive"}>
          {status.text}
        </p>
      )}
      {status?.ok && saved && <KeySyncOffer />}
      <SyncedKeyStatus id={provider} />
      <SetupButton provider={provider} show={!saved} />
      <p className="text-xs text-muted-foreground">{terms}</p>
    </section>
  );
}

/** API.Bible: the key, then the English texts it can read, to add to the picker. */
function ApiBibleKey() {
  const saved = useUI((s) => s.bibleKeys.apiBible);
  const keySync = useUI((s) => s.keySync);
  const chosen = useUI((s) => s.apiBibleBibles);
  const setBibleKey = useUI((s) => s.setBibleKey);
  const setApiBibleBibles = useUI((s) => s.setApiBibleBibles);
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  const [list, setList] = useState<ApiBibleSummary[] | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function findBibles() {
    const key = draft.trim();
    if (!key) return;
    setBusy(true);
    setStatus(null);
    const r = await findAndSaveApiBible(key);
    if (r.ok && r.found) setList(r.found);
    setStatus(r);
    setBusy(false);
  }

  function toggle(b: ApiBibleSummary | ApiBibleChoice, on: boolean) {
    const rest = chosen.filter((c) => c.id !== b.id);
    setApiBibleBibles(on ? [...rest, { id: b.id, abbreviation: b.abbreviation, name: b.name }] : rest);
    if (!on) void clearLicensedCache(apiBibleTranslation(b)).catch(() => {});
    // A text taken out of the picker is not left selected in the reader.
    const st = useUI.getState();
    const id = `${APIBIBLE_PREFIX}${b.id}`;
    if (!on && st.translation === id) st.setTranslation("BSB");
    if (!on && st.parallel === id) st.setParallel(null);
  }

  async function remove() {
    for (const c of chosen) await clearLicensedCache(apiBibleTranslation(c)).catch(() => {});
    setBibleKey("apiBible", "");
    setApiBibleBibles([]);
    setDraft("");
    setList(null);
    setStatus({
      ok: true,
      text: `Key removed, and the API.Bible text kept on this device was deleted.${keySync ? " It is removed from your other devices too." : ""}`,
    });
  }

  // Show what is chosen even before the list has been fetched this session.
  const rows: (ApiBibleSummary | ApiBibleChoice)[] = list ?? chosen;

  return (
    <section className="space-y-2" aria-label="API.Bible">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <KeyRound size={14} className="text-muted-foreground" aria-hidden />
        NASB, AMP, CSB, NKJV and more — API.Bible
        {saved && <span className="shrink-0 whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary-700 dark:text-primary-300">key saved</span>}
      </h3>
      <p className="text-xs text-muted-foreground">
        Sign up for the free Starter plan at <Link href="https://api.bible/sign-up/starter">api.bible</Link> (American
        Bible Society; accounts are approved by hand, which can take a little while). The Starter plan lets you choose
        three copyrighted Bibles. For the NASB, choose <strong>New American Standard Bible 2020</strong> (listed as
        NASB) or <strong>New American Standard Bible 1995</strong>; for the Amplified, choose{" "}
        <strong>Amplified Bible</strong>. Then paste your key here.
      </p>
      <Field label="API.Bible key">
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
            />
            <Button size="sm" onClick={findBibles} disabled={busy || !draft.trim()}>
              {busy ? "Checking…" : "Find my Bibles"}
            </Button>
            {saved && (
              <Button size="sm" variant="outline" onClick={remove}>
                Remove
              </Button>
            )}
          </div>
        )}
      </Field>
      {status && (
        <p role="status" className={status.ok ? "text-xs text-primary-700 dark:text-primary-300" : "text-xs text-destructive"}>
          {status.text}
        </p>
      )}
      {status?.ok && saved && <KeySyncOffer />}
      <SyncedKeyStatus id="apiBible" />
      <SetupButton provider="apiBible" show={!saved} />
      {saved && rows.length > 0 && (
        <div className="space-y-2 rounded-lg border border-border p-3" data-testid="apibible-list">
          <p className="text-xs font-medium">Show in the translation menu</p>
          {rows.map((b) => {
            const known = knownApiBible(b.id);
            return (
              <Switch
                key={b.id}
                checked={chosen.some((c) => c.id === b.id)}
                onCheckedChange={(on) => toggle(b, on)}
                label={`${b.abbreviation} · ${b.name}`}
                description={known?.notice ? "Shown with the publisher’s copyright notice." : undefined}
              />
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        API.Bible’s terms: non-commercial use, 5,000 requests a month on the Starter plan, and text kept offline is
        refreshed at least every 30 days. The publishers’ own limits are stricter, so at most 500 verses of each text
        are kept. Each passage you read is counted anonymously by API.Bible’s Fair Use Management System, which its
        terms require; it receives a random device id, never your name or account.
      </p>
    </section>
  );
}
