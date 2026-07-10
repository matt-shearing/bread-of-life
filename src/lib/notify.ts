import { db } from "@/db";
import { isDueToday } from "@/db/repos";
import { localDayKey } from "@/lib/day";

let notifiedThisSession = false;

/** Ask for OS notification permission (browser + Tauri webview both expose it). */
export async function enablePrayerNotifications(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const p = await Notification.requestPermission();
  return p === "granted";
}

/** Devotional reminder: at/after the set time each day, if not already done or
 *  notified today, fire one notification. Safe to call every minute. */
export async function maybeNotifyDevotion(enabled: boolean, timeHHMM: string): Promise<void> {
  if (!enabled || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const now = new Date();
  const [hh, mm] = timeHHMM.split(":").map(Number);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin < hh * 60 + mm) return; // not time yet
  const todayKey = localDayKey();
  if (localStorage.getItem("bol-devotion-notified") === todayKey) return;
  const slot = now.getHours() < 17 ? "m" : "e";
  const md = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const already = await db.devotions.get(`${md}:${slot}`);
  localStorage.setItem("bol-devotion-notified", todayKey); // dedupe regardless
  if (already) return;
  new Notification("Bread of Life", { body: "Time for your Morning & Evening devotional." });
}

let memoryNotifiedThisSession = false;

/** Once per day, nudge to review the memory-verse deck ("hide it in your heart").
 *  Fires at most once per session and once per calendar day, only when cards are
 *  actually due. Safe to call on every app open. */
export async function maybeNotifyMemory(enabled: boolean): Promise<void> {
  if (memoryNotifiedThisSession || !enabled) return;
  memoryNotifiedThisSession = true;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const todayKey = localDayKey();
  if (localStorage.getItem("bol-memory-notified") === todayKey) return;
  const due = await db.memory.where("dueAt").belowOrEqual(Date.now()).count();
  if (due <= 0) return;
  localStorage.setItem("bol-memory-notified", todayKey);
  new Notification("Bread of Life", {
    body: `${due} verse${due === 1 ? "" : "s"} to hide in your heart today — visit Memory Lane.`,
  });
}

/** Once per app launch, if enabled and permitted, nudge about due prayers. */
export async function maybeNotifyPrayers(enabled: boolean): Promise<void> {
  if (notifiedThisSession || !enabled) return;
  notifiedThisSession = true;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const prayers = await db.prayers.where("status").equals("active").toArray();
  const due = prayers.filter(isDueToday).length;
  if (due > 0) {
    new Notification("Bread of Life", {
      body: `You have ${due} prayer${due === 1 ? "" : "s"} to lift up today.`,
    });
  }
}
