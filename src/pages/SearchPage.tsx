import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search as SearchIcon } from "lucide-react";
import { searchBible, type SearchHit } from "@/data/bible";
import { refLabel } from "@/lib/osis";
import { useUI } from "@/store/ui";
import { Card, Input } from "@/components/ui";

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Snippet({ text, terms }: { text: string; terms: string[] }) {
  const nodes = useMemo(() => {
    if (!terms.length) return [text];
    const re = new RegExp(`(${terms.map(escapeRe).join("|")})`, "ig");
    const termSet = new Set(terms.map((t) => t.toLowerCase()));
    return text.split(re).map((part, i) =>
      termSet.has(part.toLowerCase()) ? (
        <mark key={i} className="rounded bg-primary/30 px-0.5 text-foreground">
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  }, [text, terms]);
  return <>{nodes}</>;
}

export function SearchPage() {
  const navigate = useNavigate();
  const { goTo } = useUI();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    const id = setTimeout(() => {
      searchBible(q).then((r) => {
        setHits(r);
        setSearching(false);
      });
    }, 180);
    return () => clearTimeout(id);
  }, [query]);

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  function open(hit: SearchHit) {
    goTo(hit.ho, hit.chapter);
    navigate("/bible");
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-8">
        <h1 className="mb-1 font-serif text-3xl font-bold">Search</h1>
        <p className="mb-5 text-sm text-muted-foreground">Search the Berean Standard Bible.</p>

        <div className="relative mb-5">
          <SearchIcon
            style={{ width: 18, height: 18 }}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search words or a phrase…"
            className="h-12 pl-10 text-base"
          />
        </div>

        {query.trim().length >= 2 && (
          <div className="mb-3 text-sm text-muted-foreground">
            {searching ? "Searching…" : `${hits.length} result${hits.length === 1 ? "" : "s"}${hits.length >= 200 ? "+" : ""}`}
          </div>
        )}

        <div className="space-y-2">
          {hits.map((h) => (
            <Card
              key={h.bbcccvvv}
              className="cursor-pointer p-4 hover:border-primary/40"
              onClick={() => open(h)}
            >
              <div className="mb-1 text-xs font-semibold text-primary-600">{refLabel(h.ho, h.chapter, h.verse)}</div>
              <p className="font-serif text-[15px] leading-relaxed">
                <Snippet text={h.text} terms={terms} />
              </p>
            </Card>
          ))}
        </div>

        {query.trim().length >= 2 && !searching && hits.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">No verses found for “{query.trim()}”.</Card>
        )}
      </div>
    </div>
  );
}
