import type { AIConfig, AIProvider } from "@/store/ui";

/** Provider metadata for the settings UI. */
export const PROVIDERS: Record<
  AIProvider,
  {
    label: string;
    kind: "anthropic" | "openai";
    defaultModel: string;
    defaultBaseUrl?: string;
    needsKey: boolean;
    needsBaseUrl: boolean;
    modelSuggestions: string[];
    keyHint?: string;
  }
> = {
  anthropic: {
    label: "Claude (Anthropic)",
    kind: "anthropic",
    defaultModel: "claude-opus-4-8",
    needsKey: true,
    needsBaseUrl: false,
    modelSuggestions: ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5"],
    keyHint: "sk-ant-…",
  },
  openai: {
    label: "OpenAI",
    kind: "openai",
    defaultModel: "gpt-5.1",
    defaultBaseUrl: "https://api.openai.com/v1",
    needsKey: true,
    needsBaseUrl: false,
    modelSuggestions: ["gpt-5.1", "gpt-5-mini", "gpt-5-codex", "o4-mini"],
    keyHint: "sk-…",
  },
  ollama: {
    label: "Ollama (local, open models)",
    kind: "openai",
    defaultModel: "llama3.3",
    defaultBaseUrl: "http://localhost:11434/v1",
    needsKey: false,
    needsBaseUrl: true,
    modelSuggestions: ["llama3.3", "qwen2.5", "mistral-small", "gemma3"],
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    kind: "openai",
    defaultModel: "",
    needsKey: false,
    needsBaseUrl: true,
    modelSuggestions: [],
    keyHint: "optional",
  },
};

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** In the desktop app, route through the Tauri HTTP plugin (no CORS); in a
 *  plain browser, use window.fetch. */
async function getFetch(): Promise<typeof fetch> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch as unknown as typeof fetch;
  }
  return window.fetch.bind(window);
}

/** Ask the configured model, grounded by `system`, with a short chat `history`.
 *  Returns the assistant's reply text. Throws with the provider error on failure. */
export async function askCompanion(config: AIConfig, system: string, history: ChatMessage[]): Promise<string> {
  const f = await getFetch();
  const meta = PROVIDERS[config.provider];

  if (meta.kind === "anthropic") {
    const res = await f("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: config.model || meta.defaultModel,
        max_tokens: 2048,
        system,
        messages: history,
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return (data.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
  }

  // OpenAI-compatible (OpenAI, Ollama, custom)
  const base = (config.baseUrl || meta.defaultBaseUrl || "").replace(/\/$/, "");
  if (!base) throw new Error("No base URL configured for this provider.");
  const res = await f(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model || meta.defaultModel,
      messages: [{ role: "system", content: system }, ...history],
      max_tokens: 2048,
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`${meta.label} ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content ?? "").trim();
}
