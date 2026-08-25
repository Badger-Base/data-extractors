import dotenv from "dotenv";

dotenv.config();

export const config = {
  database: {
    url: process.env.DATABASE_URL ?? "",
  },

  apis: {
    courseSearch: {
      baseUrl: "https://public.enroll.wisc.edu/api/search/v1",
      enrollmentUrl: "https://public.enroll.wisc.edu/search",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/json",
        Authorization: "Basic dGVzdDp0ZXN0",
        "Sec-GPC": "1",
        Referer: "https://public.enroll.wisc.edu/search",
      } as Record<string, string>,
      selectedTerm: process.env.SELECTED_TERM || "1272",
    },
    madgrades: {
      baseUrl: "https://api.madgrades.com/v1",
      token: process.env.MADGRADES_API_TOKEN ?? "",
      perPage: 500,
      batchSize: 500,
    },
    rateMyProfessor: {
      baseUrl: "https://www.ratemyprofessors.com/graphql",
      schoolId: "U2Nob29sLTE4NDE4",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.5",
        "Content-Type": "application/json",
        Authorization: "Basic dGVzdDp0ZXN0",
        "Sec-GPC": "1",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        Priority: "u=4",
      } as Record<string, string>,
    },
  },

  rateLimiting: {
    delay: parseInt(process.env.RATE_LIMIT_DELAY ?? "100", 10),
    batchSize: parseInt(process.env.BATCH_SIZE ?? "100", 10),
    maxRetries: parseInt(process.env.MAX_RETRIES ?? "3", 10),
    backoffMultiplier: 2,
  },

  development: {
    testMode: process.env.TEST_MODE === "true",
    testCourseLimit: parseInt(process.env.TEST_COURSE_LIMIT ?? "50", 10),
    verboseLogging: process.env.DEBUG === "true",
  },

  puppeteer: {
    headless: process.env.PUPPETEER_HEADLESS !== "false",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
  },
} as const;

export default config;
