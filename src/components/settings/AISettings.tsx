import { PROVIDERS } from "@/ai/client";
import type { AIProvider } from "@/store/ui";
import { useUI } from "@/store/ui";
import { Card, CardContent, CardHeader, CardTitle, ChipGroup, Field, Input } from "@/components/ui";

export function AISettings() {
  const ai = useUI((s) => s.ai);
  const setAI = useUI((s) => s.setAI);
  const aiMeta = PROVIDERS[ai.provider];

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI study companion</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-2 text-sm font-medium">Provider</div>
          <ChipGroup
            label="AI provider"
            value={ai.provider}
            onValueChange={(p) =>
              p &&
              setAI({
                provider: p,
                model: PROVIDERS[p].defaultModel,
                baseUrl: PROVIDERS[p].defaultBaseUrl ?? "",
              })
            }
            options={(Object.keys(PROVIDERS) as AIProvider[]).map((p) => ({ value: p, label: PROVIDERS[p].label }))}
          />
        </div>

        <Field label="Model">
          {(id) => (
            <>
              <Input
                id={id}
                list="ai-model-suggestions"
                value={ai.model}
                onChange={(e) => setAI({ model: e.target.value })}
                placeholder={aiMeta.defaultModel || "model id"}
              />
              <datalist id="ai-model-suggestions">
                {aiMeta.modelSuggestions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </>
          )}
        </Field>

        {(aiMeta.needsKey || ai.provider === "custom") && (
          <Field label={`API key${aiMeta.needsKey ? "" : " (optional)"}`}>
            {(id) => (
              <Input
                id={id}
                type="password"
                value={ai.apiKey}
                onChange={(e) => setAI({ apiKey: e.target.value })}
                placeholder={aiMeta.keyHint ?? "API key"}
              />
            )}
          </Field>
        )}

        {aiMeta.needsBaseUrl && (
          <Field label="Base URL">
            {(id) => (
              <Input
                id={id}
                value={ai.baseUrl}
                onChange={(e) => setAI({ baseUrl: e.target.value })}
                placeholder={aiMeta.defaultBaseUrl ?? "https://…/v1"}
              />
            )}
          </Field>
        )}

        <p className="text-xs text-muted-foreground">
          Your key is stored locally on this device and used only to call your chosen provider.
          In the desktop app requests go out natively (no CORS); OpenAI/custom providers may be
          blocked by CORS in a plain browser.
        </p>
      </CardContent>
    </Card>
  );
}
