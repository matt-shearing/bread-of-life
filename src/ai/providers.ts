import type { AIProvider } from "@/store/ui";

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
    defaultModel: "claude-opus-5",
    needsKey: true,
    needsBaseUrl: false,
    modelSuggestions: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
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
