import dotenv from "dotenv";

dotenv.config();

/**
 * Outbound mail for the notifier.
 *
 * Submits over Mox's HTTP/JSON API on 443 rather than SMTP, matching
 * api-local. SMTP submission ports are not reliably reachable from every
 * environment this runs in — Railway cannot open a connection to 465 or 2525
 * at all — and a notifier that silently fails to send is worse than one that
 * fails loudly, because nobody is watching a scheduled job.
 *
 * Two details of Mox's API that are not guessable from the endpoint:
 *   - the JSON goes in a form field named `request`, not as a JSON body
 *   - `From` is an array of addresses, not a single object
 */

const DEFAULT_FROM = "notifications@badgerbase.app";
const DEFAULT_API_URL = "https://mail.badgerbase.app/webapi/v0/Send";

export function emailFrom(): string {
  return process.env.SMTP_FROM || DEFAULT_FROM;
}

export function mailApiUrl(): string {
  return process.env.MAIL_API_URL || DEFAULT_API_URL;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

export interface SendDeps {
  /** Injected so tests exercise the real request shape without a network. */
  fetchImpl?: typeof fetch;
}

/**
 * Sends one message. Throws on any non-2xx so the caller can decide whether
 * a failure should abort the run or just skip one subscriber.
 */
export async function sendEmail(
  to: string,
  subject: string,
  htmlBody: string,
  deps: SendDeps = {}
): Promise<void> {
  if (!isEmailConfigured()) {
    throw new Error(
      "email is not configured: SMTP_USER and SMTP_PASS are required"
    );
  }

  const doFetch = deps.fetchImpl ?? fetch;
  const request = JSON.stringify({
    From: [{ Name: "BadgerBase", Address: emailFrom() }],
    To: [{ Address: to }],
    Subject: subject,
    HTML: htmlBody,
  });

  const auth = Buffer.from(
    `${process.env.SMTP_USER}:${process.env.SMTP_PASS}`
  ).toString("base64");

  const res = await doFetch(mailApiUrl(), {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ request }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `mail api ${res.status}: ${detail.slice(0, 200) || res.statusText}`
    );
  }
}
