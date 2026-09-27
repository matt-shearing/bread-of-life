import { useEffect, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { verseOfTheDay } from "@/data/bible";
import { refLabel } from "@/lib/osis";
import { useOpenRef } from "@/lib/useOpenRef";
import { Card, CardContent } from "@/components/ui";

/** The Verse of the Day hero. Deep amber so white text reads at 5:1 or better (A3). */
export function VerseOfTheDay() {
  const openRef = useOpenRef();
  const [votd, setVotd] = useState<{ ho: string; chapter: number; verse: number; text: string } | null>(null);

  useEffect(() => {
    verseOfTheDay().then(setVotd);
  }, []);

  return (
    <Card className="mb-6 overflow-hidden border-none bg-gradient-to-br from-primary-700 to-primary-800 text-white shadow-card">
      <CardContent className="p-6 sm:p-7">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Sparkles size={16} aria-hidden /> Verse of the Day
        </h2>
        {votd ? (
          <>
            <p className="font-serif text-xl leading-relaxed">“{votd.text}”</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{refLabel(votd.ho, votd.chapter, votd.verse)} · BSB</span>
              <button
                type="button"
                onClick={() => openRef(votd.ho, votd.chapter, votd.verse, { path: "/", label: "Home" })}
                className="inline-flex h-8 items-center gap-2 rounded-md bg-white px-3 text-sm font-medium text-primary-800 shadow-sm hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary-700 [@media(pointer:coarse)]:h-11"
              >
                Read in context <ArrowRight size={15} aria-hidden />
              </button>
            </div>
          </>
        ) : (
          <p>Loading…</p>
        )}
      </CardContent>
    </Card>
  );
}
