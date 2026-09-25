import { useState } from "react";
import { Button } from "@/components/ui";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

/** Copy text, falling back to a hidden textarea where the async clipboard is refused. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Android only: copy the native player's recent audio events (earphone and car buttons,
 * play/pause requests, service start/stop, what Android Auto asked for) so they can be
 * pasted into a bug report. The log lives in memory in the audio plugin (get_debug_log).
 */
export function AudioDebugLog() {
  const [status, setStatus] = useState<string | null>(null);
  if (!(isTauri && isAndroid)) return null;

  async function copy() {
    setStatus("Reading the log…");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { lines } = await invoke<{ lines: string[] }>("plugin:native-audio|get_debug_log");
      if (!lines?.length) {
        setStatus("The log is empty. Play something first, then copy it.");
        return;
      }
      const header = `Bread of Life audio log · ${new Date().toString()} · ${navigator.userAgent}`;
      const ok = await copyText([header, ...lines].join("\n"));
      setStatus(ok ? `Copied ${lines.length} lines. Paste them into a message or a bug report.` : "Could not copy to the clipboard.");
    } catch (e) {
      setStatus(`Could not read the log: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="text-sm text-muted-foreground">
        Audio misbehaving (stops after a pause, the car or earphones do the wrong thing)? Copy the
        player’s recent events and send them along.
      </p>
      <Button variant="outline" onClick={() => void copy()}>
        Copy audio debug log
      </Button>
      {status && (
        <p className="text-xs text-muted-foreground" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
