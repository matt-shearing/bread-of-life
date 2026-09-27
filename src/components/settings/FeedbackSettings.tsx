import { requestFeature, reportBug } from "@/lib/feedback";
import { AudioDebugLog } from "@/components/settings/AudioDebugLog";
import { version as APP_VERSION } from "../../../package.json";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";

export function FeedbackSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Feedback</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Have an idea, or something you'd love the app to do? Requests are read and turned into
          real changes.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={requestFeature}>🌱 Request a feature</Button>
          <Button variant="outline" onClick={reportBug}>
            Report a bug
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Opens a pre-filled issue on GitHub (needs a free GitHub account).
        </p>
        <AudioDebugLog />
      </CardContent>
    </Card>
  );
}

export function AboutSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>About</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        <p>Bread of Life · v{APP_VERSION} — a warm, offline-first homebase for reading, prayer, and journalling.</p>
      </CardContent>
    </Card>
  );
}
