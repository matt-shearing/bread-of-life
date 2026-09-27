import { useEffect, useState } from "react";
import { useUI, type ApiBibleChoice, type BibleKeys } from "@/store/ui";
import { ESV_TRANSLATION, NLT_TRANSLATION, getLicensedChapter, providerFetch } from "@/data/licensed";
import { listApiBibles, type ApiBibleSummary } from "@/data/licensed/apibible";
import { KNOWN_API_BIBLES } from "@/data/licensed/catalog";
import { memoryCacheStore } from "@/data/licensed/cache";
import { LicensedError, type LicensedFailure } from "@/data/licensed/types";
import { keySyncGate, onE2EStatusChange, type KeySyncGate } from "@/db/sync";
import { watchSyncedKeys, type KeyId } from "@/store/keySync";
import type { SyncedApiKey } from "@/db";

export const FAILURE_TEXT: Record<LicensedFailure, string> = {
  "no-key": "Enter a key first.",
  "bad-key": "The service did not accept this key.",
  "not-licensed": "This key is not allowed to read that text.",
  "rate-limited": "Too many requests just now. Try again in a minute.",
  "not-found": "The service answered, but sent no verses.",
  offline: "Could not reach the service. Check your connection.",
};

export type SaveResult = { ok: true; text: string; found?: ApiBibleSummary[] } | { ok: false; text: string };

/** ESV or NLT: a trial read of John 3 (kept out of the cache), and the key saved if it works. */
export async function checkAndSaveKey(provider: Exclude<keyof BibleKeys, "apiBible">, key: string): Promise<SaveResult> {
  const test = provider === "esv" ? ESV_TRANSLATION : NLT_TRANSLATION;
  const r = await getLicensedChapter(test, "JHN", 3, {
    keys: { esv: "", nlt: "", apiBible: "", [provider]: key },
    store: memoryCacheStore(),
  });
  if (!r.chapter) return { ok: false, text: `${FAILURE_TEXT[r.failure ?? "offline"]} The key was not saved.` };
  useUI.getState().setBibleKey(provider, key);
  return { ok: true, text: `Key saved. ${test.short} is now in the translation menu.` };
}

/**
 * API.Bible: list the English texts the key can read, save the key, and (with `pick`)
 * add NASB and the Amplified Bible to the picker when the key can read them.
 */
export async function findAndSaveApiBible(key: string, { pick = false }: { pick?: boolean } = {}): Promise<SaveResult> {
  try {
    const found = await listApiBibles(await providerFetch(), key);
    // Texts people ask for (NASB, AMP, …) first, then the rest by name.
    const rank = (b: ApiBibleSummary) => {
      const i = KNOWN_API_BIBLES.findIndex((k) => k.id === b.id);
      return i < 0 ? KNOWN_API_BIBLES.length : i;
    };
    found.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const st = useUI.getState();
    st.setBibleKey("apiBible", key);
    if (pick) {
      // NASB 2020, NASB 1995 and the Amplified Bible: the texts this setup is for.
      const known = found.filter((b) => KNOWN_API_BIBLES.slice(0, 3).some((k) => k.id === b.id));
      const chosen: ApiBibleChoice[] = [...st.apiBibleBibles];
      for (const b of known) if (!chosen.some((c) => c.id === b.id)) chosen.push({ id: b.id, abbreviation: b.abbreviation, name: b.name });
      st.setApiBibleBibles(chosen);
    }
    const nasb = found.some((b) => b.id === KNOWN_API_BIBLES[0].id || b.id === KNOWN_API_BIBLES[1].id);
    return {
      ok: true,
      found,
      text: `Key saved. It can read ${found.length} English text${found.length === 1 ? "" : "s"}.${
        nasb ? "" : " No NASB among them: add NASB 2020 or NASB 1995 to your Bibles on api.bible, then look again."
      }`,
    };
  } catch (e) {
    const why = e instanceof LicensedError ? e.failure : "offline";
    return { ok: false, text: `${FAILURE_TEXT[why]} The key was not saved.` };
  }
}

/** Whether keys can sync from here (re-checked every few seconds and on E2E changes), and the synced rows. */
export function useKeySyncInfo(): { gate: KeySyncGate | null; rows: Map<KeyId, SyncedApiKey> } {
  const [gate, setGate] = useState<KeySyncGate | null>(null);
  const [rows, setRows] = useState<Map<KeyId, SyncedApiKey>>(new Map());
  useEffect(() => {
    let live = true;
    const refresh = () => void keySyncGate().then((g) => live && setGate(g));
    refresh();
    const t = setInterval(refresh, 5000);
    const off = onE2EStatusChange(refresh);
    const stop = watchSyncedKeys((r) => live && setRows(r));
    return () => {
      live = false;
      clearInterval(t);
      off();
      stop();
    };
  }, []);
  return { gate, rows };
}
