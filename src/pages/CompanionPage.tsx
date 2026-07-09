import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Send, Sparkles, Trash2, Settings as SettingsIcon } from "lucide-react";
import { useUI } from "@/store/ui";
import { getChapter, verses } from "@/data/bible";
import { refLabel } from "@/lib/osis";
import { streamCompanion, PROVIDERS, type ChatMessage } from "@/ai/client";
import { Button, Card, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";

const QUICK = [
  "Explain this chapter in plain language.",
  "What's the historical context here?",
  "How does this passage apply to my life?",
  "What are the key cross-references?",
];

async function buildSystem(ho: string, chapter: number): Promise<string> {
  const ch = await getChapter(ho, chapter);
  const ref = refLabel(ho, chapter);
  let passage = "";
  if (ch) passage = verses(ch).map((v) => `${v.n} ${v.text}`).join("\n");
  return [
    "You are a warm, faithful Bible study companion inside the “Bread of Life” app.",
    `The reader is currently in ${ref}. Here is the passage (Berean Standard Bible):`,
    "",
    passage,
    "",
    "Answer their questions about this passage and Scripture faithfully and concisely.",
    "Ground your answers in the text and cite verses by reference. Where Christian",
    "traditions differ, note it briefly and irenically. Never invent quotes or references.",
  ].join("\n");
}

export function CompanionPage() {
  const navigate = useNavigate();
  const { ho, chapter, ai, companionSeed, setCompanionSeed } = useUI();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seedConsumed = useRef(false);

  const meta = PROVIDERS[ai.provider];
  const configured = !meta.needsKey || ai.apiKey.trim().length > 0;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, loading]);

  // Consume a seed question passed from the reader's "Ask" action (once).
  useEffect(() => {
    if (companionSeed && !seedConsumed.current) {
      seedConsumed.current = true;
      const q = companionSeed;
      setCompanionSeed(null);
      if (configured) send(q);
      else setInput(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companionSeed]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    setError(null);
    const next = [...messages, { role: "user" as const, content: q }];
    // add an empty assistant bubble we stream into
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);
    try {
      const system = await buildSystem(ho, chapter);
      await streamCompanion(ai, system, next, (chunk) => {
        setMessages((m) => {
          const copy = m.slice();
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: last.content + chunk };
          return copy;
        });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // drop the empty assistant bubble on error
      setMessages((m) => (m[m.length - 1]?.role === "assistant" && !m[m.length - 1].content ? m.slice(0, -1) : m));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border px-6 py-4">
        <Sparkles style={{ width: 20, height: 20 }} className="text-primary-600" />
        <div>
          <h1 className="font-serif text-xl font-bold">Study Companion</h1>
          <p className="text-xs text-muted-foreground">
            Grounded in <span className="font-medium text-foreground">{refLabel(ho, chapter)}</span> · {meta.label}
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setMessages([])}>
            <Trash2 style={{ width: 15, height: 15 }} /> Clear
          </Button>
        )}
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-2xl space-y-4">
          {!configured ? (
            <Card className="p-6 text-center">
              <p className="mb-3 text-sm text-muted-foreground">
                Add your {meta.label} API key in Settings to use the study companion. Your key stays on
                this device.
              </p>
              <Button variant="outline" size="sm" onClick={() => navigate("/settings")}>
                <SettingsIcon style={{ width: 15, height: 15 }} /> Open Settings
              </Button>
            </Card>
          ) : messages.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Ask anything about {refLabel(ho, chapter)} — or the Bible more broadly. Try:
              </p>
              <div className="grid grid-cols-2 gap-2">
                {QUICK.map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="rounded-lg border border-border p-3 text-left text-sm hover:border-primary/40 hover:bg-accent"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) =>
              m.role === "assistant" && m.content === "" ? null : (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card font-serif",
                  )}
                >
                  {m.content}
                </div>
              </div>
            ),
            )
          )}
          {loading && messages[messages.length - 1]?.content === "" && (
            <div className="text-sm text-muted-foreground">Thinking…</div>
          )}
          {error && (
            <Card className="border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</Card>
          )}
        </div>
      </div>

      <div className="border-t border-border px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={configured ? `Ask about ${refLabel(ho, chapter)}…` : "Configure a provider in Settings first"}
            disabled={!configured || loading}
            rows={1}
            className="min-h-[44px] resize-none"
          />
          <Button onClick={() => send(input)} disabled={!configured || loading || !input.trim()} size="icon" className="h-11 w-11">
            <Send style={{ width: 18, height: 18 }} />
          </Button>
        </div>
      </div>
    </div>
  );
}
