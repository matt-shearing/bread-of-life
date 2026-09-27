/**
 * Save a file the user names, or open one they pick — the same call on every platform.
 *
 *  - Desktop app: the native save/open dialogs (plugin-dialog), then plugin-fs. The
 *    dialog adds the picked path to the fs scope, so no broad write scope is needed.
 *  - Android app: the dialogs are the system document picker, which hands back a
 *    `content://` URI rather than a path. plugin-fs opens those through Android's
 *    ContentResolver (mode "wt" for a write, which truncates), so the same
 *    writeFile/readTextFile calls work. A cancelled picker REJECTS on Android instead
 *    of returning null, so cancellation is detected by message.
 *  - Browser (pnpm dev): a Blob download, and an <input type=file>.
 */
const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isAndroid = () => typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

/** True when the picker was dismissed — Android rejects, desktop resolves null. */
function isCancel(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return /cancel/i.test(msg);
}

export interface SaveOptions {
  fileName: string;
  bytes: Uint8Array;
  mime: string;
  /** For the desktop dialog's filter, e.g. { name: "Backup", extensions: ["json"] }. */
  filter: { name: string; extensions: string[] };
}

/** Where the file went: a path/URI, "download" in the browser, or null if cancelled. */
export async function saveFile(o: SaveOptions): Promise<string | null> {
  if (!isTauri()) {
    const blob = new Blob([o.bytes as BlobPart], { type: o.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = o.fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return "download";
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  let target: string | null;
  try {
    target = await save({
      title: "Save",
      defaultPath: o.fileName,
      filters: [o.filter],
    });
  } catch (e) {
    if (isCancel(e)) return null;
    throw e;
  }
  if (!target) return null;
  await writeFile(target, o.bytes);
  return target;
}

/** A picked file's text, or null if the user cancelled. */
export async function openTextFile(filter: { name: string; extensions: string[] }): Promise<{ name: string; text: string } | null> {
  if (!isTauri()) return pickInBrowser(filter.extensions);
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  let picked: string | string[] | null;
  try {
    // No type filter on Android: the system picker filters by MIME type, and a JSON
    // file saved through the document picker is often recorded as
    // application/octet-stream, which a json filter would grey out. The content is
    // validated after reading instead.
    picked = await open({ multiple: false, directory: false, filters: isAndroid() ? undefined : [filter] });
  } catch (e) {
    if (isCancel(e)) return null;
    throw e;
  }
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (!path) return null;
  const name = decodeURIComponent(path.split(/[\\/]/).pop() ?? path);
  return { name, text: await readTextFile(path) };
}

function pickInBrowser(extensions: string[]): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = extensions.map((e) => `.${e}`).join(",");
    input.style.display = "none";
    input.setAttribute("data-testid", "restore-file-input");
    document.body.appendChild(input);
    const done = () => input.remove();
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      done();
      if (!f) return resolve(null);
      f.text().then((text) => resolve({ name: f.name, text }), reject);
    });
    input.addEventListener("cancel", () => {
      done();
      resolve(null);
    });
    input.click();
  });
}
