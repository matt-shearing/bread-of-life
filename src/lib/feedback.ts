import { openExternal } from "./external";

const REPO = "https://github.com/matt-shearing/bread-of-life";

/** Open a pre-filled "feature request" issue on GitHub in the system browser. */
export function requestFeature(): void {
  const body =
    "**What would you like Bread of Life to do?**\n\n\n" +
    "**How would it help your walk with God, or your day?**\n\n\n" +
    "---\n_Sent from the Bread of Life app._";
  openExternal(
    `${REPO}/issues/new?labels=${encodeURIComponent("feature-request")}` +
      `&title=${encodeURIComponent("Feature request: ")}` +
      `&body=${encodeURIComponent(body)}`,
  );
}

/** Open a pre-filled "bug report" issue on GitHub in the system browser. */
export function reportBug(): void {
  const platform = (typeof navigator !== "undefined" && navigator.platform) || "unknown";
  const body =
    "**What happened?**\n\n\n" +
    "**What did you expect to happen?**\n\n\n" +
    "**Steps to reproduce**\n1. \n2. \n\n" +
    `---\n_Platform: ${platform} · Sent from the Bread of Life app._`;
  openExternal(
    `${REPO}/issues/new?labels=${encodeURIComponent("bug")}` +
      `&title=${encodeURIComponent("Bug: ")}` +
      `&body=${encodeURIComponent(body)}`,
  );
}
