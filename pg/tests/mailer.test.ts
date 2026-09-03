import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sendEmail, emailFrom, mailApiUrl, isEmailConfigured } from "../src/mailer.js";

const saved = { ...process.env };
const restore = () => {
  for (const k of ["SMTP_USER", "SMTP_PASS", "SMTP_FROM", "MAIL_API_URL"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
};

function captureFetch(response = new Response("{}", { status: 200 })) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return response;
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe("mailer", () => {
  beforeEach(() => {
    process.env.SMTP_USER = "notifications@badgerbase.app";
    process.env.SMTP_PASS = "secret";
    delete process.env.SMTP_FROM;
    delete process.env.MAIL_API_URL;
  });
  afterEach(restore);

  it("refuses to send when credentials are missing", async () => {
    delete process.env.SMTP_PASS;
    const { calls, impl } = captureFetch();
    await assert.rejects(
      () => sendEmail("a@wisc.edu", "s", "<p>b</p>", { fetchImpl: impl }),
      /not configured/
    );
    assert.equal(calls.length, 0, "must not reach the network when unconfigured");
  });

  // Mox rejects a plain JSON body: the payload goes in a `request` form field.
  it("sends the payload as a `request` form field, not a JSON body", async () => {
    const { calls, impl } = captureFetch();
    await sendEmail("a@wisc.edu", "Subject", "<p>Body</p>", { fetchImpl: impl });
    const body = calls[0].init.body as URLSearchParams;
    assert.ok(body instanceof URLSearchParams);
    assert.ok(body.get("request"), "expected a `request` field");
    assert.match(
      String((calls[0].init.headers as Record<string, string>)["Content-Type"]),
      /x-www-form-urlencoded/
    );
  });

  // Mox's schema: From is an array of addresses, not a single object.
  it("sends From as an array", async () => {
    const { calls, impl } = captureFetch();
    await sendEmail("a@wisc.edu", "Subject", "<p>Body</p>", { fetchImpl: impl });
    const payload = JSON.parse((calls[0].init.body as URLSearchParams).get("request")!);
    assert.ok(Array.isArray(payload.From), "From must be an array");
    assert.equal(payload.From[0].Address, "notifications@badgerbase.app");
    assert.equal(payload.To[0].Address, "a@wisc.edu");
    assert.equal(payload.Subject, "Subject");
    assert.equal(payload.HTML, "<p>Body</p>");
  });

  it("authenticates with HTTP basic", async () => {
    const { calls, impl } = captureFetch();
    await sendEmail("a@wisc.edu", "s", "<p>b</p>", { fetchImpl: impl });
    const auth = (calls[0].init.headers as Record<string, string>).Authorization;
    assert.match(auth, /^Basic /);
    const [user, pass] = Buffer.from(auth.slice(6), "base64").toString().split(":");
    assert.equal(user, "notifications@badgerbase.app");
    assert.equal(pass, "secret");
  });

  it("surfaces the server's error detail on a non-2xx", async () => {
    const { impl } = captureFetch(
      new Response('{"Code":"protocol","Message":"missing/empty request"}', { status: 400 })
    );
    await assert.rejects(
      () => sendEmail("a@wisc.edu", "s", "<p>b</p>", { fetchImpl: impl }),
      /mail api 400.*missing\/empty request/s
    );
  });

  it("honours SMTP_FROM and MAIL_API_URL overrides", async () => {
    process.env.SMTP_FROM = "alerts@badgerbase.app";
    process.env.MAIL_API_URL = "https://mail.example.com/webapi/v0/Send";
    const { calls, impl } = captureFetch();
    await sendEmail("a@wisc.edu", "s", "<p>b</p>", { fetchImpl: impl });
    assert.equal(calls[0].url, "https://mail.example.com/webapi/v0/Send");
    const payload = JSON.parse((calls[0].init.body as URLSearchParams).get("request")!);
    assert.equal(payload.From[0].Address, "alerts@badgerbase.app");
  });

  it("defaults to the production sender and endpoint", () => {
    assert.equal(emailFrom(), "notifications@badgerbase.app");
    assert.match(mailApiUrl(), /^https:\/\/mail\.badgerbase\.app\/webapi/);
    assert.equal(isEmailConfigured(), true);
  });
});
