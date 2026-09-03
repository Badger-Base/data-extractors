import { query, end } from "./db.js";
import dotenv from "dotenv";

dotenv.config();

/**
 * Deletes expired better-auth session rows.
 *
 * better-auth never removes them. An expired session stops working
 * immediately — `expiresAt` is checked on every lookup — so these rows are
 * inert, but nothing reclaims them and the table grows without bound.
 *
 * Deliberately conservative: only rows already past `expiresAt`, which no
 * longer authenticate anyone. It cannot sign a live user out.
 */
export async function pruneExpiredSessions(): Promise<number> {
  const { rowCount } = await query(
    `DELETE FROM "session" WHERE "expiresAt" < now()`
  );
  return rowCount ?? 0;
}

async function main() {
  const before = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM "session"`
  );
  const deleted = await pruneExpiredSessions();
  const after = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM "session"`
  );
  console.log(
    `sessions: ${before.rows[0].n} before, deleted ${deleted} expired, ${after.rows[0].n} remaining`
  );
  await end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("prune-sessions failed:", e);
    process.exit(1);
  });
}
