import { useEffect, useState } from "react";
import { BookAudio } from "lucide-react";
import {
  ANDROID_DROP_PATH,
  getMisslerLibraryPath,
  getMisslerStatus,
  setMisslerLibraryPath,
  type MisslerStatus,
} from "@/data/missler";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@/components/ui";

const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

/**
 * Points the app at a local Missler (Line by Line) library folder. The library is
 * personal and copyrighted, so it's never bundled or synced — only read from the
 * path set here. On desktop this is an absolute disk path; in the browser dev build
 * the folder is served through the `public/missler-library` symlink instead.
 */
export function MisslerSettings() {
  const [path, setPath] = useState("");
  const [status, setStatus] = useState<MisslerStatus | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMisslerLibraryPath().then(setPath);
    getMisslerStatus().then(setStatus);
  }, []);

  const save = async () => {
    setSaving(true);
    await setMisslerLibraryPath(path);
    setStatus(await getMisslerStatus());
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Missler Inspired (MI) Library</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/home/you/missler-commentary/out/library"
            spellCheck={false}
          />
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "…" : "Save"}
          </Button>
        </div>

        {status && (
          <div className="flex items-start gap-2 text-sm">
            <BookAudio className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {status.available ? (
              <span>
                Library found — {status.books} book{status.books === 1 ? "" : "s"}, {status.audioChapters} audio
                chapter{status.audioChapters === 1 ? "" : "s"}.
              </span>
            ) : (
              <span className="text-muted-foreground">
                {status.error ?? "No library set yet. Paste the path to your built library folder above."}
              </span>
            )}
          </div>
        )}

        {isAndroid && (
          <p className="text-xs text-muted-foreground">
            On Android, leave the path blank and drop your library folder into{" "}
            <code className="break-all rounded bg-muted px-1 py-0.5">{ANDROID_DROP_PATH}</code> (created
            automatically; visible to your file manager, MTP and Syncthing) — the app finds it there.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Personal library built from your own copies; never bundled or synced.
        </p>
      </CardContent>
    </Card>
  );
}
