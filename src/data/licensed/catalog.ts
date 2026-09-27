/**
 * What we know about licensed texts ahead of any key: the ids of the ones people ask
 * for on API.Bible, and the publisher's own wording for their notice where it is
 * stricter than what the API sends.
 *
 * The ids come from API.Bible's public catalogue (https://api.bible/bibles, read
 * 2026-09-28). Whether a given key can read a text depends on the plan and the three
 * copyrighted Bibles its owner picked, so these are hints, not promises.
 */

export interface KnownApiBible {
  id: string;
  abbreviation: string;
  name: string;
  /** The publisher's required notice, verbatim, when we should use it instead of the API's. */
  notice?: string;
  noticeUrl?: string;
}

/** Lockman's notice (https://www.lockman.org/permission-to-quote-copyright-trademark-information/). */
const lockmanNasb = (years: string) =>
  `Scripture quotations taken from the (NASB®) New American Standard Bible®, Copyright © ${years} by The Lockman Foundation. Used by permission. All rights reserved. www.Lockman.org`;

export const KNOWN_API_BIBLES: KnownApiBible[] = [
  {
    id: "a761ca71e0b3ddcf-01",
    abbreviation: "NASB",
    name: "New American Standard Bible 2020",
    notice: lockmanNasb("1960, 1971, 1977, 1995, 2020"),
    noticeUrl: "https://www.lockman.org",
  },
  {
    id: "b8ee27bcd1cae43a-01",
    abbreviation: "NASB1995",
    name: "New American Standard Bible 1995",
    // "Only use the last year corresponding to the edition(s) quoted."
    notice: lockmanNasb("1960, 1971, 1977, 1995"),
    noticeUrl: "https://www.lockman.org",
  },
  {
    id: "a81b73293d3080c9-01",
    abbreviation: "AMP",
    name: "Amplified Bible",
    notice:
      "Scripture quotations taken from the Amplified® Bible (AMP), Copyright © 2015 by The Lockman Foundation. Used by permission. www.Lockman.org",
    noticeUrl: "https://www.lockman.org",
  },
  { id: "a556c5305ee15c3f-01", abbreviation: "CSB", name: "Christian Standard Bible" },
  { id: "63097d2a0a2f7db3-01", abbreviation: "NKJV", name: "New King James Version" },
  { id: "d6e14a625393b4da-01", abbreviation: "NLT", name: "New Living Translation" },
];

export const knownApiBible = (id: string) => KNOWN_API_BIBLES.find((b) => b.id === id);

/** What the picker says about the NASB before any key can read it. */
export const NASB_NOTE =
  "NASB 2020 or NASB 1995 with a free API.Bible key — pick it as one of your three Bibles";
