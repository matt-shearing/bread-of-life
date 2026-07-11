import { BIP39_WORDLIST } from "@/data/bip39-wordlist";

/**
 * End-to-end encryption for synced personal content (journal, prayers, notes).
 *
 * Model (chosen 2026-07-11): a random 256-bit **data key** encrypts record payloads
 * with AES-256-GCM before they leave the device; the relay only ever stores ciphertext.
 * The key is shown ONCE as a 24-word BIP39 **recovery phrase** so it can be restored on
 * another device — the server never sees it. Losing the phrase means the synced copies
 * can't be decrypted (the LOCAL copy is always plaintext and safe).
 *
 * All crypto is Web Crypto (`crypto.subtle`) — present in browsers, the Tauri webviews,
 * and Node ≥20 — so there are no native/third-party crypto dependencies.
 */

const KEY_BYTES = 32; // 256-bit data key
const IV_BYTES = 12; // 96-bit GCM nonce

function getCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new Error("Web Crypto unavailable");
  return c;
}

/* ------------------------------- base64 helpers ------------------------------ */

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ------------------------------ key + recovery phrase ------------------------ */

/** A fresh random 256-bit data key. */
export function generateDataKey(): Uint8Array {
  return getCrypto().getRandomValues(new Uint8Array(KEY_BYTES));
}

/** Encode a 256-bit key as a 24-word BIP39 recovery phrase (with checksum). */
export async function keyToPhrase(key: Uint8Array): Promise<string> {
  if (key.length !== KEY_BYTES) throw new Error("data key must be 32 bytes");
  // BIP39: entropy bits + (entropy/32) checksum bits, split into 11-bit words.
  const hash = new Uint8Array(await getCrypto().subtle.digest("SHA-256", key));
  const checksumBits = KEY_BYTES / 4; // 256/32 = 8 bits
  const bits: number[] = [];
  for (const b of key) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  for (let i = 0; i < checksumBits; i++) bits.push((hash[0] >> (7 - i)) & 1);
  const words: string[] = [];
  for (let i = 0; i < bits.length; i += 11) {
    let idx = 0;
    for (let j = 0; j < 11; j++) idx = (idx << 1) | bits[i + j];
    words.push(BIP39_WORDLIST[idx]);
  }
  return words.join(" ");
}

/** Decode a recovery phrase back to the 256-bit key, or null if invalid/checksum-fails. */
export async function phraseToKey(phrase: string): Promise<Uint8Array | null> {
  const words = phrase.trim().toLowerCase().split(/\s+/);
  if (words.length !== 24) return null;
  const bits: number[] = [];
  for (const w of words) {
    const idx = BIP39_WORDLIST.indexOf(w);
    if (idx < 0) return null;
    for (let i = 10; i >= 0; i--) bits.push((idx >> i) & 1);
  }
  const checksumBits = KEY_BYTES / 4;
  const entropyBits = bits.length - checksumBits; // 256
  const key = new Uint8Array(KEY_BYTES);
  for (let i = 0; i < entropyBits; i++) if (bits[i]) key[i >> 3] |= 1 << (7 - (i % 8));
  // verify checksum
  const hash = new Uint8Array(await getCrypto().subtle.digest("SHA-256", key));
  for (let i = 0; i < checksumBits; i++) {
    if (bits[entropyBits + i] !== ((hash[0] >> (7 - i)) & 1)) return null;
  }
  return key;
}

/* --------------------------------- encryption -------------------------------- */

async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  return getCrypto().subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Encrypt a JSON-serialisable value → base64(iv ‖ ciphertext). */
export async function encryptJSON(rawKey: Uint8Array, value: unknown): Promise<string> {
  const key = await importKey(rawKey);
  const iv = getCrypto().getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ct = new Uint8Array(await getCrypto().subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);
  return bytesToBase64(packed);
}

/** Decrypt base64(iv ‖ ciphertext) → the original value. Throws if tampered/wrong key. */
export async function decryptJSON<T = unknown>(rawKey: Uint8Array, b64: string): Promise<T> {
  const key = await importKey(rawKey);
  const packed = base64ToBytes(b64);
  const iv = packed.slice(0, IV_BYTES);
  const ct = packed.slice(IV_BYTES);
  const pt = await getCrypto().subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

/* ------------------------------ device-local key store ----------------------- */
// The data key lives ONLY on the device (localStorage), never synced. The recovery
// phrase is the user's backup. Kept out of the Zustand/Dexie stores so it never rides
// the sync channel or a settings export.

const KEY_STORAGE = "bol-e2e-key";

/** The active data key (base64) or null when E2E is off on this device. */
export function loadDataKey(): Uint8Array | null {
  try {
    const b64 = localStorage.getItem(KEY_STORAGE);
    return b64 ? base64ToBytes(b64) : null;
  } catch {
    return null;
  }
}
export function saveDataKey(key: Uint8Array): void {
  localStorage.setItem(KEY_STORAGE, bytesToBase64(key));
}
export function clearDataKey(): void {
  localStorage.removeItem(KEY_STORAGE);
}
export function isE2EEnabled(): boolean {
  return loadDataKey() !== null;
}
