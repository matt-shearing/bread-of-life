import { useEffect, useState } from "react";
import { BookAudio, Download } from "lucide-react";
import {
  getMisslerLibraryPath,
  getMisslerStatus,
  importLibrary,
  setMisslerLibraryPath,
  type MisslerStatus,
} from "@/data/missler";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@/components/ui";

interface Progress {
  done: number;
  total: number;
  file: string;
}

/**
 * Points the app at a local Missler (Line by Line) library folder. The library is
 * personal and copyrighted, so it's never bundled or synced — only read from the
 * path set here. On desktop this is an absolute disk path; in the browser dev build
 * the folder is served through the `public/missler-library` symlink instead.
 *
 * On Android raw external-path reads FAIL (scoped storage won't attribute files
 * written by adb or other apps), so the "Import over network" section instead
 * downloads the whole library over HTTP into the app's own storage — always
 * readable, no permissions. Serve the built folder from your PC and paste the URL.
 */
const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

export function MisslerSettings() {
  const [path, setPath] = useState("");
  const [status, setStatus] = useState<MisslerStatus | null>(null);
  const [saving, setSaving] = useState(false);

  const [url, setUrl] = useState("");
  const [includeAudio, setIncludeAudio] = useState(true);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    getMisslerLibraryPath().then(setPath);
    getMisslerStatus().then(setStatus);
  }, []);

  const browse = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, title: "Choose your Missler library folder" });
    if (typeof dir === "string" && dir) {
      setPath(dir);
      setSaving(true);
      await setMisslerLibraryPath(dir);
      setStatus(await getMisslerStatus());
      setSaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    await setMisslerLibraryPath(path);
    setStatus(await getMisslerStatus());
    setSaving(false);
  };

  const runImport = async () => {
    setImporting(true);
    setImportError(null);
    setProgress({ done: 0, total: 0, file: "" });
    try {
      await importLibrary(url, (done, total, file) => setProgress({ done, total, file }), { audio: includeAudio });
      setStatus(await getMisslerStatus());
      setProgress(null);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
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
          {!isAndroid && (
            <Button
              variant="outline"
              onClick={() => void browse()}
              title="Choose the library folder"
            >
              Browse…
            </Button>
          )}
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

        <div className="space-y-3 border-t pt-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">Import over network</p>
            <p className="text-xs text-muted-foreground">
              Serve the built library folder from your PC, then paste its URL to download it into this app's own
              storage — the reliable option on Android, where reading files from a shared folder is blocked.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://100.x.y.z:8765"
              spellCheck={false}
              disabled={importing}
            />
            <Button onClick={() => void runImport()} disabled={importing || !url.trim()}>
              <Download className="mr-1 h-4 w-4" />
              {importing ? "Importing…" : "Import"}
            </Button>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={includeAudio}
              onChange={(e) => setIncludeAudio(e.target.checked)}
              disabled={importing}
            />
            Include audio (6.5 GB)
          </label>

          {progress && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {progress.total > 0 ? `${progress.done}/${progress.total}` : "Starting…"}
              {progress.file ? ` — ${progress.file}` : ""}
            </p>
          )}
          {importError && <p className="text-xs text-destructive">{importError}</p>}
        </div>

        <p className="text-xs text-muted-foreground">
          Personal library built from your own copies; never bundled or synced.
        </p>
      </CardContent>
    </Card>
  );
}
