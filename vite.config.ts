import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Vendor chunks by package name (the part after the last node_modules/, which
// also works through pnpm's .pnpm/ layout). Long-lived, so they stay cached
// across app releases that only change our own code. Tiptap/ProseMirror are only
// reached from the journal, so that chunk loads with the journal page alone.
const VENDOR_CHUNKS: [string, RegExp][] = [
  ["tiptap", /^(@tiptap\/|prosemirror-|orderedmap$|rope-sequence$|w3c-keyname$|linkifyjs$)/],
  ["react", /^(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)$/],
  ["radix", /^(@radix-ui\/|@floating-ui\/|react-remove-scroll|react-style-singleton$|use-callback-ref$|use-sidecar$|aria-hidden$|get-nonce$)/],
  ["dexie", /^(dexie|dexie-react-hooks)$/],
];

function vendorChunk(id: string): string | undefined {
  const i = id.lastIndexOf("node_modules/");
  if (i < 0) return;
  const parts = id.slice(i + "node_modules/".length).split("/");
  const pkg = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
  return VENDOR_CHUNKS.find(([, re]) => re.test(pkg))?.[0];
}

// Tauri expects a fixed port and no clearScreen so its logs stay visible.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: "es2022",
    outDir: "dist",
    rollupOptions: { output: { manualChunks: vendorChunk } },
  },
});
