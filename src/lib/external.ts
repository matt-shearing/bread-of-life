import { openUrl } from "@tauri-apps/plugin-opener";

import { isTauri } from "./platform";

/** Open a URL in the system browser (native in Tauri, new tab in a plain browser). */
export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    try {
      await openUrl(url);
      return;
    } catch {
      /* fall through to window.open */
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
