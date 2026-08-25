import puppeteer from "puppeteer";
import config from "../config.js";

export async function getMadgradesToken(): Promise<string> {
  const browser = await puppeteer.launch({
    headless: config.puppeteer.headless,
    args: [...config.puppeteer.args],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport(config.puppeteer.viewport);
    await page.setUserAgent(config.puppeteer.userAgent);

    let token: string | null = null;

    page.on("request", (req) => {
      if (token) return;
      const url = req.url();
      if (!url.includes("api.madgrades.com")) return;
      const auth = req.headers()["authorization"];
      if (!auth) return;
      const match = auth.match(/Token token=([a-f0-9]{32})/);
      if (match) token = match[1];
    });

    console.log("[madgrades-token] Navigating to madgrades.com...");
    await page.goto("https://madgrades.com/search?q=CS+300", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    if (!token) {
      await new Promise((r) => setTimeout(r, 3000));
    }

    if (!token) {
      throw new Error("Could not intercept madgrades API token from network requests");
    }

    console.log(`[madgrades-token] Token acquired: ${token.substring(0, 8)}...`);
    return token;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  getMadgradesToken()
    .then((token) => {
      console.log(`MADGRADES_API_TOKEN=${token}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[madgrades-token] Failed:", err.message);
      process.exit(1);
    });
}
