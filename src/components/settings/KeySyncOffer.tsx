import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, RefreshCw } from "lucide-react";
import { useUI } from "@/store/ui";
import { setKeySyncEnabled } from "@/store/keySync";
import type { KeySyncGate } from "@/db/sync";
import { Button, Switch } from "@/components/ui";
import { useKeySyncInfo } from "./bibleKeyActions";

/** One sentence on why keys stay on this device, or null when they can sync. */
export function gateText(gate: KeySyncGate | null): string | null {
  switch (gate) {
    case "signed-out":
      return "Your keys stay on this device. To share them with your other devices, sign in to sync and turn on encryption.";
    case "no-e2e":
      return "Your keys stay on this device until end-to-end encryption is on here, so the sync server can never read them.";
    case "key-mismatch":
      return "Your keys stay on this device until its encryption key matches your account’s.";
    case "old-server":
      return "Your sync server can’t store keys yet, so they stay on this device.";
    case "offline":
      return "Your keys stay on this device while the sync server can’t be reached.";
    default:
      return null;
  }
}

/** The per-device switch, or why it isn't available, for the top of the translations card. */
export function KeySyncSwitch() {
  const { gate } = useKeySyncInfo();
  const on = useUI((s) => s.keySync);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const why = gateText(gate);
  const toggle = async (v: boolean) => {
    setBusy(true);
    try {
      await setKeySyncEnabled(v);
    } finally {
      setBusy(false);
    }
  };
  if (gate === null) return null;
  return (
    <div className="space-y-2 rounded-lg border border-border p-3" data-testid="key-sync">
      {why && gate !== "offline" && gate !== "old-server" ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="flex min-w-0 flex-1 basis-60 items-start gap-2 text-sm text-muted-foreground">
            <Lock size={14} className="mt-0.5 shrink-0" aria-hidden />
            {why}
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate(`/settings?section=${gate === "signed-out" ? "sync" : "encryption"}`)}>
            {gate === "signed-out" ? "Sync settings" : "Encryption settings"}
          </Button>
        </div>
      ) : (
        <>
          <Switch
            checked={on}
            onCheckedChange={(v) => void toggle(v)}
            disabled={busy || (gate !== "ready" && !on)}
            label="Sync my keys to my other devices"
            description="Encrypted on this device before they leave it; the sync server can’t read them. Each of your devices needs this on."
          />
          {why && <p className="text-xs text-muted-foreground">{why}</p>}
        </>
      )}
    </div>
  );
}

/** After a key is saved: offer to share it, when this device can. */
export function KeySyncOffer() {
  const { gate } = useKeySyncInfo();
  const on = useUI((s) => s.keySync);
  const [busy, setBusy] = useState(false);
  if (gate !== "ready") return null;
  if (on) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw size={12} aria-hidden /> It will reach your other devices, encrypted.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-3 text-sm" data-testid="key-sync-offer">
      <span className="min-w-0 flex-1 basis-52">Want this key on your other devices too? It travels end-to-end encrypted.</span>
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await setKeySyncEnabled(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        Sync my keys
      </Button>
    </div>
  );
}
