// Minimal lint: TypeScript's recommended rules, the Rules of Hooks, and one
// import boundary. Formatting is left alone (no Prettier); `tsc` does the type checks.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/", "src-tauri/", "website/", "node_modules/", "public/"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // The two classic hooks rules only — not the React Compiler rules v7 adds.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // `any` is used deliberately at a few untyped boundaries (provider JSON, Tauri).
      "@typescript-eslint/no-explicit-any": "off",
      // tsc's noUnusedLocals/noUnusedParameters already cover this.
      "@typescript-eslint/no-unused-vars": "off",
      // Flags a default that every branch overwrites (`let x = ""; try { x = … }`),
      // which is a readable habit here, not a bug.
      "no-useless-assignment": "off",
      // The Tiptap editor is ~400 kB; only the journal may import it, so it stays
      // out of every other page's chunk (see src/lib/htmlToText.ts for the history).
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@tiptap/*", "@/components/journal/RichEditor", "**/journal/RichEditor"],
              message: "The Tiptap editor is journal-only. Plain-text helpers live in src/lib (e.g. htmlToText).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/journal/**", "src/pages/JournalPage.tsx"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["scripts/**/*.mjs", "eslint.config.js", "postcss.config.js"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["vite.config.ts", "tailwind.config.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
);
