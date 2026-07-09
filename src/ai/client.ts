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
  xai: {
    label: "Grok (xAI)",
    kind: "openai",
    defaultModel: "grok-4",
    defaultBaseUrl: "https://api.x.ai/v1",
    needsKey: true,
    needsBaseUrl: false,
    modelSuggestions: ["grok-4", "grok-4-fast", "grok-3", "grok-3-mini"],
    keyHint: "xai-…",
  },
  google: {
    label: "Google Gemini",
    kind: "openai",
    defaultModel: "gemini-2.5-flash",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    needsKey: true,
    needsBaseUrl: false,
    modelSuggestions: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    keyHint: "AIza…",
  },
  deepseek: {
    label: "DeepSeek",
    kind: "openai",
    defaultModel: "deepseek-chat",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    needsKey: true,
    needsBaseUrl: false,
    modelSuggestions: ["deepseek-chat", "deepseek-reasoner"],
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

/** Stream the model's reply, grounded by `system`, with a short chat `history`.
 *  Calls `onDelta` with each text chunk as it arrives and resolves with the full
 *  text. Throws with the provider error on failure. Works in the Tauri webview
 *  (via the HTTP plugin) and in a plain browser. */
export async function streamCompanion(
  config: AIConfig,
  system: string,
  history: ChatMessage[],
  onDelta: (chunk: string) => void,
): Promise<string> {
  const f = await getFetch();
  const meta = PROVIDERS[config.provider];

  let url: string;
  let headers: Record<string, string>;
  let body: unknown;

  if (meta.kind === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers = {
      "content-type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
    body = { model: config.model || meta.defaultModel, max_tokens: 2048, system, messages: history, stream: true };
  } else {
    const base = (config.baseUrl || meta.defaultBaseUrl || "").replace(/\/$/, "");
    if (!base) throw new Error("No base URL configured for this provider.");
    url = `${base}/chat/completions`;
    headers = {
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    };
    body = {
      model: config.model || meta.defaultModel,
      messages: [{ role: "system", content: system }, ...history],
      max_tokens: 2048,
      stream: true,
    };
  }

  const res = await f(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${meta.label} ${res.status}: ${await res.text()}`);
  if (!res.body) {
    // No stream available — fall back to a whole-response read.
    const text = await res.text();
    onDelta(text);
    return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  const handle = (json: any) => {
    let chunk = "";
    if (meta.kind === "anthropic") {
      if (json.type === "content_block_delta" && json.delta?.type === "text_delta") chunk = json.delta.text;
    } else {
      chunk = json.choices?.[0]?.delta?.content ?? "";
    }
    if (chunk) {
      full += chunk;
      onDelta(chunk);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        handle(JSON.parse(data));
      } catch {
        /* keep-alive / partial line — ignore */
      }
    }
  }
  return full.trim();
}
