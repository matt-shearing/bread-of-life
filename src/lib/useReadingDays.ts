import { useLiveQuery } from "dexie-react-hooks";
import { readingDaysFromDb } from "@/db/readingLog";

const EMPTY: ReadonlySet<string> = new Set();

/** Every local day with any reading, live (the reading log plus `progress`; see readingDaysFromDb). */
export function useReadingDays(): ReadonlySet<string> {
  return useLiveQuery(readingDaysFromDb, [], EMPTY) ?? EMPTY;
}
