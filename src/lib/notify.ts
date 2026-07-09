import { db } from "@/db";
import { isDueToday } from "@/db/repos";

let notifiedThisSession = false;

/** Ask for OS notification permission (browser + Tauri webview both expose it). */
export async function enablePrayerNotifications(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const p = await Notification.requestPermission();
  return p === "granted";
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
