import type { Chapter } from "../bible";

export type LicensedSourceId = "esv" | "apibible" | "nlt";

/** Why a licensed chapter is missing, so the reader can say what to do about it. */
export type LicensedFailure =
  | "no-key" // no key saved on this device
  | "bad-key" // the provider refused the key
  | "not-licensed" // the key works, but not for this text
  | "rate-limited"
  | "not-found" // the text has no such chapter
  | "offline";

/** The subset of fetch the providers use: window.fetch, plugin-http and test fakes all fit. */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; method?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export class LicensedError extends Error {
  failure: LicensedFailure;
  constructor(failure: LicensedFailure, message?: string) {
    super(message ?? failure);
    this.failure = failure;
  }
}

export function failureForStatus(status: number): LicensedFailure {
  if (status === 401) return "bad-key";
  if (status === 403) return "not-licensed";
  if (status === 404 || status === 400) return "not-found";
  if (status === 429) return "rate-limited";
  return "offline";
}

export interface ChapterResult {
  chapter: Chapter;
  /** API.Bible: the usage token to report through FUMS each time the chapter is shown. */
  fumsToken?: string;
}
