import { CommentarySourceSelect, useCommentarySources } from "@/components/bible/CommentaryView";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";

export function CommentarySettings() {
  const sources = useCommentarySources();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Default commentary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <CommentarySourceSelect sources={sources} label="Commentary" className="max-w-sm" />
        <p className="text-xs text-muted-foreground">
          Shown on the Commentary page and in the Bible’s study panel. You can switch there too.
        </p>
      </CardContent>
    </Card>
  );
}
