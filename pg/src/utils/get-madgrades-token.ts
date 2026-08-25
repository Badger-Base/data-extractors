import puppeteer from "puppeteer";
import config from "../config.js";

export async function getMadgradesToken(): Promise<string> {
  const username = process.env.GITHUB_USERNAME;
  const password = process.env.GITHUB_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "GITHUB_USERNAME and GITHUB_PASSWORD env vars required for madgrades token fetch"
    );
  }

  const browser = await puppeteer.launch({
    headless: config.puppeteer.headless,
    args: [...config.puppeteer.args],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport(config.puppeteer.viewport);
    await page.setUserAgent(config.puppeteer.userAgent);

    console.log("[madgrades-token] Navigating to api.madgrades.com...");
    await page.goto("https://api.madgrades.com", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    const signInLink = await page.$('a[href="/auth/github"]');
    if (!signInLink) {
      const pageContent = await page.content();
      if (pageContent.includes("token") || pageContent.includes("Token")) {
        console.log("[madgrades-token] Already authenticated, extracting token...");
        return await extractToken(page);
      }
      throw new Error("Could not find GitHub sign-in link");
    }

    console.log("[madgrades-token] Clicking GitHub sign-in...");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
      signInLink.click(),
    ]);

    const currentUrl = page.url();
    if (currentUrl.includes("github.com/login")) {
      console.log("[madgrades-token] Filling GitHub credentials...");

      await page.waitForSelector('input[name="login"]', { timeout: 10000 });
      await page.type('input[name="login"]', username, { delay: 50 });
      await page.type('input[name="password"]', password, { delay: 50 });

      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
        page.click('input[type="submit"], button[type="submit"]'),
      ]);

      const postLoginUrl = page.url();

      if (postLoginUrl.includes("github.com/login/oauth/authorize")) {
        console.log("[madgrades-token] Authorizing OAuth app...");
        const authorizeButton = await page.$(
          'button[name="authorize"], button#js-oauth-authorize-btn'
        );
        if (authorizeButton) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
            authorizeButton.click(),
          ]);
        }
      }

      if (postLoginUrl.includes("github.com/sessions/two-factor")) {
        console.log("[madgrades-token] 2FA detected — waiting up to 2 min for manual entry...");
        await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 120000 });
      }
    }

    await page.waitForFunction(
      () => window.location.hostname === "api.madgrades.com",
      { timeout: 30000 }
    );

    console.log("[madgrades-token] Redirected back to madgrades, extracting token...");
    await new Promise((r) => setTimeout(r, 2000));

    return await extractToken(page);
  } finally {
    await browser.close();
  }
}

async function extractToken(page: puppeteer.Page): Promise<string> {
  await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});

  const token = await page.evaluate(() => {
    const codeEl = document.querySelector("code, pre");
    if (codeEl?.textContent) {
      const match = codeEl.textContent.match(/[a-f0-9]{32}/);
      if (match) return match[0];
    }

    const inputEl = document.querySelector(
      'input[type="text"], input[readonly], input[value]'
    ) as HTMLInputElement | null;
    if (inputEl?.value) {
      const match = inputEl.value.match(/[a-f0-9]{32}/);
      if (match) return match[0];
    }

    const bodyText = document.body.innerText;
    const match = bodyText.match(/[a-f0-9]{32}/);
    if (match) return match[0];

    return null;
  });

  if (!token) {
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.error("[madgrades-token] Page content after login:", bodyText.substring(0, 500));
    throw new Error("Could not find API token on page after login");
  }

  console.log(`[madgrades-token] Token acquired: ${token.substring(0, 8)}...`);
  return token;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  getMadgradesToken()
    .then((token) => {
      console.log(`\nMADGRADES_API_TOKEN=${token}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[madgrades-token] Failed:", err.message);
      process.exit(1);
    });
}
