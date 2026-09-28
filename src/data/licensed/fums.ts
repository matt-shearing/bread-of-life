/**
 * FUMS, API.Bible's Fair Use Management System. Every passage an app shows must be
 * reported, so the publishers who license their text to API.Bible know it is read.
 * Each API.Bible response carries a `fumsToken`; reporting is one GET per display.
 * The ids are random, per install and per session, and identify no one.
 */
import type { FetchLike } from "./types";

export const FUMS_URL = "https://fums.api.bible/f3";

function randomId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

let deviceId: string | null = null;
const sessionId = randomId();

/** A random id kept for this install (not tied to any account). */
function getDeviceId(): string {
  if (deviceId) return deviceId;
  try {
    deviceId = globalThis.localStorage?.getItem("bol-fums-device") ?? null;
    if (!deviceId) {
      deviceId = randomId();
      globalThis.localStorage?.setItem("bol-fums-device", deviceId);
    }
  } catch {
    deviceId = randomId();
  }
  return deviceId;
}

export function fumsUrl(tokens: string[], ids: { device: string; session: string }): string {
  const params = new URLSearchParams();
  for (const t of tokens) params.append("t", t);
  params.set("dId", ids.device);
  params.set("sId", ids.session);
  return `${FUMS_URL}?${params}`;
}

/** Report that these passages were shown. Throws when the report did not go out. */
export async function reportFums(fetchFn: FetchLike, tokens: string[]): Promise<void> {
  const clean = tokens.filter(Boolean);
  if (!clean.length) return;
  const res = await fetchFn(fumsUrl(clean, { device: getDeviceId(), session: sessionId }));
  if (!res.ok) throw new Error(`FUMS ${res.status}`);
}
