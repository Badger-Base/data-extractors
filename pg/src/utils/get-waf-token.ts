import puppeteer from "puppeteer";
import config from "../config.js";

export async function getWafToken(): Promise<string | null> {
  const browser = await puppeteer.launch({
    headless: config.puppeteer.headless,
    args: [...config.puppeteer.args],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport(config.puppeteer.viewport);
    await page.setUserAgent(config.puppeteer.userAgent);

    await page.goto(config.apis.courseSearch.enrollmentUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await new Promise((r) => setTimeout(r, 3000));

    const pageTitle = await page.title();
    if (pageTitle === "Human Verification") {
      if (config.puppeteer.headless) {
        console.log("CAPTCHA detected in headless mode — waiting up to 5 min...");
      } else {
        console.log("CAPTCHA detected — please solve it in the browser window");
      }
      const maxWait = config.puppeteer.headless ? 300 : 600;
      let elapsed = 0;
      while (elapsed < maxWait) {
        await new Promise((r) => setTimeout(r, 2000));
        elapsed += 2;
        const title = await page.title();
        if (title !== "Human Verification" && !title.includes("Verification")) {
          console.log(`CAPTCHA solved after ${elapsed}s`);
          break;
        }
        if (elapsed % 30 === 0) console.log(`Still waiting for CAPTCHA... (${elapsed}s)`);
      }
      if (elapsed >= maxWait) {
        throw new Error("CAPTCHA not solved in time");
      }
    }

    const cookies = await page.cookies();
    const waf = cookies.find((c) => c.name === "aws-waf-token");

    if (waf) {
      console.log("WAF token acquired");
      if (waf.expires) {
        console.log(`Token expires: ${new Date(waf.expires * 1000).toISOString()}`);
      }
      return waf.value;
    }

    console.log("No WAF token found (may still work)");
    return null;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  getWafToken()
    .then((token) => {
      if (token) {
        console.log("\nToken:", token);
      } else {
        console.log("\nNo token retrieved");
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error("Failed to get WAF token:", err.message);
      process.exit(1);
    });
}
