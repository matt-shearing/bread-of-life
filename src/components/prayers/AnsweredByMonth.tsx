/**
 * A small bar row on the Faithfulness page: answered prayers in one year, month by month.
 * Renders nothing for a year with none.
 */
export function AnsweredByMonth({ prayers, year }: { prayers: { answeredAt: number | null }[]; year: number }) {
  const counts = Array.from({ length: 12 }, () => 0);
  for (const p of prayers) {
    if (!p.answeredAt) continue;
    const d = new Date(p.answeredAt);
    if (d.getFullYear() === year) counts[d.getMonth()]++;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const max = Math.max(...counts);
  const initial = (m: number) => new Date(year, m, 1).toLocaleDateString(undefined, { month: "narrow" });
  const name = (m: number) => new Date(year, m, 1).toLocaleDateString(undefined, { month: "long" });
  return (
    <figure className="mx-auto mt-5 w-fit" data-testid="answered-by-month">
      <div className="flex h-10 items-end gap-1" role="img" aria-label={`Prayers answered in ${year}, by month`}>
        {counts.map((n, m) => (
          <div
            key={m}
            title={`${name(m)}: ${n} answered`}
            className={n ? "w-3 rounded-sm bg-primary-400 dark:bg-primary-600" : "w-3 rounded-sm bg-muted"}
            style={{ height: n ? `${Math.max(18, (n / max) * 100)}%` : 3 }}
          />
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[9px] leading-none text-muted-foreground" aria-hidden>
        {counts.map((_, m) => (
          <span key={m} className="w-3 text-center">
            {initial(m)}
          </span>
        ))}
      </div>
      <figcaption className="mt-1.5 text-center text-xs text-muted-foreground">
        {total} answered in {year}
      </figcaption>
    </figure>
  );
}
