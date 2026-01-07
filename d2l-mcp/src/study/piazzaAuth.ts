import "dotenv/config";
import { chromium, BrowserContext } from "playwright";
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";

const SESSION_PATH = join(homedir(), ".piazza-session");

// Pick a URL that reliably requires auth and lands you inside Piazza when logged in.
// You can use piazza.com and then navigate to a class page after.
const PIAZZA_HOME = "https://piazza.com/";

const REMOTE_DEBUG = process.env.REMOTE_DEBUG === "true";

// Same idea as your Learn script: detect common SSO/login URLs. 
function isLoginPage(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes("login") ||
    u.includes("sso") ||
    u.includes("adfs") ||
    u.includes("microsoftonline") ||
    u.includes("shibboleth") ||
    u.includes("saml")
  );
}

export async function getPiazzaAuthenticatedContext(): Promise<BrowserContext> {
  const hasExistingSession = existsSync(SESSION_PATH);

  const browserArgs: string[] = [];
  if (REMOTE_DEBUG) {
    browserArgs.push("--remote-debugging-port=9223", "--no-sandbox", "--disable-setuid-sandbox");
    console.error("[PIAZZA_AUTH] Remote debugging enabled on port 9223");
  }

  // Try headless first only if we have an existing session, same strategy as Learn. 
  let context = await chromium.launchPersistentContext(SESSION_PATH, {
    headless: hasExistingSession && !REMOTE_DEBUG,
    viewport: { width: 1280, height: 720 },
    args: browserArgs.length ? browserArgs : undefined,
  });

  const page = await context.newPage();
  console.error(`[PIAZZA_AUTH] Navigating to ${PIAZZA_HOME}`);
  await page.goto(PIAZZA_HOME, { waitUntil: "domcontentloaded" });

  // If we got bounced into SSO/login, we need an interactive login at least once.
  let currentUrl = page.url();
  if (isLoginPage(currentUrl)) {
    console.error(`[PIAZZA_AUTH] Login required (URL: ${currentUrl})`);

    // If we were headless but session expired, restart headed.
    if (hasExistingSession && !REMOTE_DEBUG) {
      await context.close();
      console.error("[PIAZZA_AUTH] Session expired, reopening browser headed for SSO...");
      context = await chromium.launchPersistentContext(SESSION_PATH, {
        headless: false,
        viewport: { width: 1280, height: 720 },
        args: browserArgs.length ? browserArgs : undefined,
      });
      const page2 = await context.newPage();
      await page2.goto(PIAZZA_HOME, { waitUntil: "domcontentloaded" });

      // Wait for you to complete SSO.
      await page2.waitForURL((url) => !isLoginPage(url.toString()), { timeout: 180000 });
      await page2.waitForLoadState("networkidle");
      await page2.close();
    } else {
      // Already headed or first run: wait for manual SSO to finish.
      if (context.pages().length === 0) {
        // no-op
      }
      await page.waitForURL((url) => !isLoginPage(url.toString()), { timeout: 180000 });
      await page.waitForLoadState("networkidle");
    }
  }

  await page.close();
  return context;
}

export async function getPiazzaCookieHeader(): Promise<string> {
  const context = await getPiazzaAuthenticatedContext();
  try {
    const cookies = await context.cookies(["https://piazza.com"]);
    // Build a Cookie header: "name=value; name2=value2"
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } finally {
    await context.close();
  }
}
