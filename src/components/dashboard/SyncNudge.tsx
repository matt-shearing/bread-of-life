import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Cloud, X } from "lucide-react";
import { getSyncStatus } from "@/db/sync";
import { useUI } from "@/store/ui";
import { Button } from "@/components/ui";

export function SyncNudge() {
  const navigate = useNavigate();
  const dismissed = useUI((s) => s.syncPromptDismissed);
  const dismiss = useUI((s) => s.dismissSyncPrompt);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    getSyncStatus().then((s) => alive && setSignedIn(s.mode !== "off"));
    return () => {
      alive = false;
    };
  }, []);

  if (dismissed || signedIn !== false) return null;

  return (
    <div className="mt-8 flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card/60 px-4 py-3 text-sm backdrop-blur">
      <Cloud size={18} className="shrink-0 text-primary-700 dark:text-primary-400" aria-hidden />
      <div className="min-w-0 flex-1 basis-48">
        <span className="font-medium">Keep your prayers &amp; journal safe across devices.</span>{" "}
        <span className="text-muted-foreground">Set up optional sync — it's free and works offline too.</span>
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline" onClick={() => navigate("/settings")}>
          Set up sync
        </Button>
        <Button size="icon" variant="ghost" aria-label="Dismiss" onClick={dismiss}>
          <X size={16} />
        </Button>
      </div>
    </div>
  );
}
