import { READING_DEEP_LINK, READING_ID_BASE } from "./readingReminders.ts";

/**
 * The pure halves of the native notification glue in notify.ts, kept free of app
 * imports so scripts/test-reading-reminders.mjs can check them.
 */

export type NativeSchedule =
  | { at: { date: Date; repeating: false; allowWhileIdle: true } }
  | { interval: { interval: { hour: number; minute: number; second: 0 }; allowWhileIdle: true } };

export interface NativeNotification {
  id: number;
  title: string;
  body: string;
  largeBody: string;
  schedule: NativeSchedule;
}

export function toPluginPayload(n: NativeNotification, channelId: string, actionTypeId: string) {
  const base = {
    id: n.id,
    title: n.title,
    body: n.body,
    largeBody: n.largeBody,
    summary: "Bread of Life",
    channelId,
    actionTypeId, // the "Go now" button
    autoCancel: true,
    schedule: n.schedule,
  };
  // Nested once so a notification restored after a reboot still carries itself.
  const inner = JSON.stringify(base);
  return { ...base, sourceJson: JSON.stringify({ ...base, sourceJson: inner }) };
}

/** The screen a tapped notification should open, from whatever the platform hands us. */
export function deepLinkFor(payload: unknown, byId: Record<number, string> = {}): string | null {
  let n: unknown = payload;
  const outer = payload as Record<string, unknown> | null;
  if (outer && typeof outer === "object" && "notification" in outer && outer.notification) n = outer.notification;
  if (typeof n === "string") {
    try {
      n = JSON.parse(n);
    } catch {
      n = null;
    }
  }
  const obj = (n ?? {}) as Record<string, unknown>;
  const link = (obj.extra as Record<string, unknown> | undefined)?.deepLink ?? (outer?.extra as Record<string, unknown> | undefined)?.deepLink;
  if (typeof link === "string") return link;
  const id = Number(obj.id ?? outer?.id);
  if (!Number.isFinite(id)) return null;
  if (id >= READING_ID_BASE && id < READING_ID_BASE + 10_000) return READING_DEEP_LINK;
  return byId[id] ?? null;
}

