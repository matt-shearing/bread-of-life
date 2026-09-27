# Licensed translations

Bread of Life is free, open source and published on GitHub, the AUR and Obtainium, so it cannot ship
copyrighted Bible text. Copyrighted translations are read at run time from the publisher's own API
with a key each user gets for themselves. The app ships no key, keeps only a small capped cache, and
shows every notice the licences ask for. The code is `src/data/licensed/`; keys are entered in
Settings → Bible translations (`src/components/settings/BibleKeysSettings.tsx`).

The terms below were read on 28 September 2026. Re-read them before changing a cap or a notice.

## What is offered

| Translation | Where from | Key |
|---|---|---|
| BSB | Bundled | none |
| WEB, KJV, ASV, YLT, MSB, RV, Darby, Webster, BBE, Geneva 1599, Douay-Rheims | HelloAO (public domain) | none |
| NET Bible® | HelloAO (Biblical Studies Press permits free apps) | none |
| LSV, FBV, T4T | HelloAO (CC BY-SA 4.0) | none |
| ESV | Crossway's ESV API | the user's own, free |
| NLT | Tyndale's NLT API | the user's own, free |
| NASB 2020, NASB 1995, AMP, CSB, NKJV, … | API.Bible | the user's own, free Starter plan (three copyrighted Bibles) |

Not available: the **LSB** has no public API (Three Sixteen Publishing licenses it by agreement), and
the **NIV** is listed on API.Bible under a separate "unique" licence from Biblica.

## ESV — api.esv.org

Source: <https://api.esv.org/>.

- Free for non-commercial use by "individuals and non-commercial organizations", with the user
  agreeing to Crossway's statement of faith. Mobile apps may use it "without formal permission,
  provided all general conditions stated above are met". "You may not sell, share, or publish your
  access key" — so every user brings their own.
- "You may not locally store more than 500 verses or one-half of any book of the Bible (whichever is
  less)." Enforced: `ESV_POLICY` (500 verses, half of any book), LRU eviction in `cache.ts`.
- "You may not display more than 500 verses or one-half of any book (whichever is less) on any
  page." Enforced: `maxBookShareOnPage`; the reader shows a one- or two-chapter book in parts.
- Notice: the standard ESV copyright notice with the text, "(ESV)" with each quotation, and "Each
  page on which you use the text must include a link to www.esv.org."
- Limits: 5,000 queries a day, 1,000 an hour, 60 a minute. CORS: `Access-Control-Allow-Origin: *`.

## NLT — api.nlt.to

Sources: <https://api.nlt.to/>, <https://tyndale.com/permissions>.

- With a key: at most 500 verses per request, 5,000 requests a day, non-commercial, "consistent with
  Tyndale's purpose". Registration: <https://api.nlt.to/Account/Register>.
- Tyndale allows 500 verses without written permission, never a complete book. Enforced: 500 verses,
  half of any book.
- Notice (several translations in one project): "Scripture quotations marked (NLT) are taken from
  the Holy Bible, New Living Translation, …". Shown with the text and added to copied verses.

## API.Bible — NASB and others

Sources: <https://api.bible/terms-and-conditions>, <https://docs.api.bible/guides/fair-use/>,
<https://api.bible/faq>, the public catalogue at <https://api.bible/bibles>.

- Starter plan: free, strictly non-commercial, "Pick 3 of your favorite copyrighted Bibles",
  5,000 API calls a month. "Each individual or legal entity is strictly limited to a single
  free-tier account or application." Accounts are approved by hand.
- The catalogue lists **New American Standard Bible 2020** (`NASB`, `a761ca71e0b3ddcf-01`),
  **New American Standard Bible 1995** (`b8ee27bcd1cae43a-01`) and the **Amplified Bible**
  (`a81b73293d3080c9-01`), all from the Lockman Foundation under the Standard License.
- "All cached content from API.Bible must be updated at least once every 30 days." Enforced:
  `maxAgeMs` of 30 days.
- "Users on the Starter Plan are required to include a visible citation and hyperlink to
  https://api.bible within their application's interface." Shown under the text.
- FUMS is required. Chapter requests add `fums-version=3`, and each display is reported with a
  GET to `https://fums.api.bible/f3?t=<fumsToken>&dId=<device>&sId=<session>` (plugin-http in the
  app, `no-cors` in a browser), as the manual-reporting section of the FUMS guide describes. The
  device and session ids are random and carry no personal data.
- "Text may not be used to create audio content." Licensed texts are never read aloud; narration
  stays with the BSB.

Lockman's own terms (<https://www.lockman.org/permission-to-quote-copyright-trademark-information/>)
are stricter: no more than 1,000 verses "stored in an electronic retrieval system", never a complete
book, and "For web pages or apps the full copyright notice must be used with www.Lockman.org being a
click-enabled web link." Enforced: 500 verses, half of any book, and Lockman's wording (NASB 2020,
NASB 1995 without the 2020 year, AMP) linked to lockman.org, also added to copied verses.

## Not verified

No real key was used. Every request and response shape is taken from the providers' documentation
and tested against fakes (`scripts/test-licensed-translations.mjs`). The first real run with Matt's
keys should confirm: the ESV HTML markup, API.Bible's chapter JSON and its `/bibles?language=eng`
list for a Starter key, and that NASB 2020 can be picked on the Starter plan.
