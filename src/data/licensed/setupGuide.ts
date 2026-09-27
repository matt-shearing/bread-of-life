/**
 * How to get each publisher's free key: the guided steps shown in Settings, a loose check
 * of what was pasted, and a prompt the user can give their own browser-using AI agent.
 * Plain data and string builders, so scripts/test-key-setup.mjs can test them in Node.
 *
 * The sign-up pages were checked on 28 September 2026 (docs/LICENSED-TRANSLATIONS.md).
 * Where the key appears after approval was not verified with a real account.
 */
export type SetupProvider = "apiBible" | "esv" | "nlt";

export interface SetupStep {
  title: string;
  body: string;
  /** A page to open for this step. */
  link?: { label: string; href: string };
}

export interface ProviderGuide {
  provider: SetupProvider;
  name: string;
  /** What the key reads, for the dialog title. */
  reads: string;
  signUpUrl: string;
  /** Where the key can be found once the account is ready. */
  keyUrl: string;
  steps: SetupStep[];
  /** The choices the user (or their agent) makes on the way, in order. */
  choices: string[];
  /** Things only the person can do. */
  personal: string[];
  /** Said on the paste step when the account can take a while. */
  waiting?: string;
}

export const GUIDES: Record<SetupProvider, ProviderGuide> = {
  apiBible: {
    provider: "apiBible",
    name: "API.Bible",
    reads: "NASB 2020, the Amplified Bible and more",
    signUpUrl: "https://api.bible/sign-up/starter",
    keyUrl: "https://api.bible/",
    steps: [
      {
        title: "Sign up for the free Starter plan",
        body: "API.Bible is run by the American Bible Society. Create an account on the Starter plan, which is free for non-commercial use. Never choose a paid plan.",
        link: { label: "Open the Starter sign-up", href: "https://api.bible/sign-up/starter" },
      },
      {
        title: "Choose your three Bibles",
        body: "The Starter plan lets you pick three copyrighted Bibles. Choose New American Standard Bible 2020 (listed as NASB), Amplified Bible, and one more, such as the Christian Standard Bible (CSB) or the New King James Version (NKJV).",
      },
      {
        title: "Wait for approval",
        body: "Accounts are approved by hand, which can take a day or more. API.Bible emails you when yours is ready. You can close this and come back: Bread of Life remembers where you were.",
      },
      {
        title: "Copy your key",
        body: "Sign in to API.Bible and open your application. Copy its API key.",
        link: { label: "Open API.Bible", href: "https://api.bible/" },
      },
    ],
    choices: [
      "Sign up on the free Starter plan at https://api.bible/sign-up/starter (non-commercial use).",
      "When asked to choose Bibles, choose these three: New American Standard Bible 2020 (NASB), Amplified Bible (AMP), and either the Christian Standard Bible (CSB) or the New King James Version (NKJV).",
      "Describe the use as: personal, non-commercial Bible reading in my own copy of the open-source Bread of Life app.",
      "Once the account is approved, open the application in the API.Bible dashboard and copy its API key.",
    ],
    personal: ["verifying the email address", "the account approval, which API.Bible does by hand and can take a day or more"],
    waiting: "Waiting for approval? Come back here when API.Bible’s email arrives.",
  },
  esv: {
    provider: "esv",
    name: "ESV API (Crossway)",
    reads: "the English Standard Version",
    signUpUrl: "https://api.esv.org/account/create-application/",
    keyUrl: "https://api.esv.org/account/",
    steps: [
      {
        title: "Create a Crossway account",
        body: "Sign in to api.esv.org, or create an account. It is free for non-commercial use.",
        link: { label: "Open api.esv.org", href: "https://api.esv.org/account/create-application/" },
      },
      {
        title: "Read Crossway’s terms yourself",
        body: "Crossway asks every user to read and accept its terms and its statement of faith. Please read them yourself before you agree; no one else can do this for you.",
      },
      {
        title: "Create an application",
        body: "Create an application for your own, non-commercial use. Any name will do, for example “My Bread of Life”.",
        link: { label: "Create an application", href: "https://api.esv.org/account/create-application/" },
      },
      {
        title: "Copy your key",
        body: "Your application’s page shows its key (a long string of letters and numbers). Copy it.",
        link: { label: "Open your applications", href: "https://api.esv.org/account/" },
      },
    ],
    choices: [
      "Go to https://api.esv.org/account/create-application/ and sign in or create an account.",
      "Create an application for personal, non-commercial use, named for example “My Bread of Life”, describing the use as Bible reading in my own copy of the open-source Bread of Life app.",
      "Open the application at https://api.esv.org/account/ and copy its API key.",
    ],
    personal: ["reading and accepting Crossway’s terms and statement of faith", "verifying the email address"],
  },
  nlt: {
    provider: "nlt",
    name: "NLT API (Tyndale)",
    reads: "the New Living Translation",
    signUpUrl: "https://api.nlt.to/Account/Register",
    keyUrl: "https://api.nlt.to/",
    steps: [
      {
        title: "Register with Tyndale",
        body: "Register at api.nlt.to and request a key for non-commercial use. It is free.",
        link: { label: "Open the NLT sign-up", href: "https://api.nlt.to/Account/Register" },
      },
      {
        title: "Confirm your email",
        body: "Tyndale emails you to confirm the address, then sends or shows your key.",
      },
      {
        title: "Copy your key",
        body: "Copy the key from the email or from your account on api.nlt.to.",
        link: { label: "Open api.nlt.to", href: "https://api.nlt.to/" },
      },
    ],
    choices: [
      "Go to https://api.nlt.to/Account/Register and request an API key for personal, non-commercial use.",
      "Describe the use as: Bible reading in my own copy of the open-source Bread of Life app.",
      "Find the key on the page shown after registering, in the confirmation email, or in the account on https://api.nlt.to/.",
    ],
    personal: ["accepting Tyndale’s terms", "confirming the email address"],
  },
};

/** The prompt for the user's own browser-using AI agent. */
export function agentPrompt(provider: SetupProvider): string {
  const g = GUIDES[provider];
  const steps = g.choices.map((c, i) => `${i + 1}. ${c}`).join("\n");
  return [
    `Please help me get a free API key from ${g.name} so I can read ${g.reads} in my own copy of Bread of Life, an open-source Bible app. The key is for my personal, non-commercial use only.`,
    "",
    "Use the browser to do this:",
    steps,
    "",
    "Rules:",
    `- STOP and ask me before you accept any terms, licence, or statement of faith, and before you enter any personal details (name, email, address, phone). I will read and accept terms myself.`,
    `- Leave these to me: ${g.personal.join("; ")}, and any CAPTCHA or "are you human" check. Tell me when you reach one and wait.`,
    "- Never pay for anything, enter card details, or choose a paid plan. Use only the free plan.",
    "- When you have the key, give it ONLY to me, here in this chat. Do not post, email, save, or share it anywhere else.",
    "- If something doesn't match these steps, stop and tell me what you see instead of guessing.",
  ].join("\n");
}

/** Opens a new Claude conversation with the prompt filled in. */
export function claudeUrl(prompt: string): string {
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}

/**
 * Tidy what was pasted: trims, drops surrounding quotes, and the "Token " an ESV key is
 * sent with. Returns the key, or an error to show. Deliberately loose: providers change
 * their key formats, and the test read is the real check.
 */
export function cleanKey(raw: string): { key: string } | { error: string } {
  let k = raw.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  k = k.replace(/^(token|bearer|api-key:?)\s+/i, "");
  if (!k) return { error: "Paste your key first." };
  if (/\s/.test(k)) return { error: "That has spaces in it, so it isn’t a key. Copy just the key." };
  if (k.length < 16) return { error: "That is too short to be a key. Check you copied all of it." };
  if (k.length > 200) return { error: "That is too long to be a key. Copy just the key." };
  if (/^https?:/i.test(k) || k.includes("@")) return { error: "That looks like a link or an email address, not a key." };
  return { key: k };
}
