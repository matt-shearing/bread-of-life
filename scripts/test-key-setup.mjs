/**
 * Tests for the guided key setup (src/data/licensed/setupGuide.ts): the prompt a user
 * gives their own AI agent, the Claude link, and the loose check of a pasted key.
 *
 * Run: node --test-reporter=spec scripts/test-key-setup.mjs   (Node 23.6+)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GUIDES, agentPrompt, claudeUrl, cleanKey } from "../src/data/licensed/setupGuide.ts";

const URLS = {
  apiBible: ["https://api.bible/sign-up/starter"],
  esv: ["https://api.esv.org/account/create-application/", "https://api.esv.org/account/"],
  nlt: ["https://api.nlt.to/Account/Register"],
};

for (const provider of ["apiBible", "esv", "nlt"]) {
  test(`${provider}: the agent prompt keeps the person in charge`, () => {
    const p = agentPrompt(provider);
    assert.match(p, /STOP and ask me before you accept any terms/);
    assert.match(p, /before you enter any personal details/);
    assert.match(p, /give it ONLY to me/);
    assert.match(p, /Do not post, email, save, or share it anywhere else/);
    assert.match(p, /Never pay for anything/);
    assert.match(p, /CAPTCHA/);
    assert.match(p, /non-commercial/);
    for (const u of URLS[provider]) assert.ok(p.includes(u), `mentions ${u}`);
    // Every link in the steps is one of this provider's own pages.
    const host = new URL(GUIDES[provider].signUpUrl).host;
    for (const u of p.match(/https:\/\/[^\s)]+/g)) assert.equal(new URL(u).host, host, u);
    for (const s of GUIDES[provider].steps) if (s.link) assert.equal(new URL(s.link.href).host, host);
  });
}

test("API.Bible: the prompt names NASB 2020 and the Amplified Bible, and the free plan", () => {
  const p = agentPrompt("apiBible");
  assert.match(p, /New American Standard Bible 2020/);
  assert.match(p, /Amplified Bible/);
  assert.match(p, /Starter plan/);
});

test("ESV: the statement of faith is left to the person", () => {
  assert.match(agentPrompt("esv"), /statement of faith/);
  assert.ok(GUIDES.esv.personal.some((x) => /statement of faith/.test(x)));
});

test("the Claude link carries the whole prompt", () => {
  const p = agentPrompt("nlt");
  const u = new URL(claudeUrl(p));
  assert.equal(u.origin + u.pathname, "https://claude.ai/new");
  assert.equal(u.searchParams.get("q"), p);
});

test("a pasted key is tidied and loosely checked", () => {
  assert.deepEqual(cleanKey("  abcdef0123456789abcdef  \n"), { key: "abcdef0123456789abcdef" });
  assert.deepEqual(cleanKey('"abcdef0123456789abcdef"'), { key: "abcdef0123456789abcdef" });
  assert.deepEqual(cleanKey("Token 0123456789abcdef0123456789abcdef01234567"), { key: "0123456789abcdef0123456789abcdef01234567" });
  assert.ok("error" in cleanKey(""));
  assert.ok("error" in cleanKey("short"));
  assert.ok("error" in cleanKey("two words here and more words"));
  assert.ok("error" in cleanKey("https://api.esv.org/account/"));
  assert.ok("error" in cleanKey("me@example.org.au.long.enough"));
});
