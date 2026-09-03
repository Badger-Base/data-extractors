import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_URL;

describe("pruneExpiredSessions", { skip: !connectionString && "TEST_DATABASE_URL not set" }, () => {
  let pool: pg.Pool;
  const ids = { expired: "prune-test-expired", live: "prune-test-live" };
  const userId = "prune-test-user";

  before(async () => {
    pool = new pg.Pool({ connectionString });

    // better-auth owns these tables and creates them from api-local's
    // schema/002_better_auth.sql, which this repo does not have. Create the
    // minimal shape the pruner touches so the test states its own
    // precondition instead of depending on whichever migrations happen to
    // have been applied to the database it is pointed at.
    //
    // This is a fixture, not a source of truth: it is deliberately the few
    // columns asserted on, so it cannot drift into pretending to be the real
    // schema.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        id              text PRIMARY KEY,
        name            text NOT NULL,
        email           text NOT NULL UNIQUE,
        "emailVerified" boolean NOT NULL DEFAULT false,
        "createdAt"     timestamptz NOT NULL DEFAULT now(),
        "updatedAt"     timestamptz NOT NULL DEFAULT now()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        id          text PRIMARY KEY,
        "expiresAt" timestamptz NOT NULL,
        token       text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "userId"    text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
      )`);

    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1,'Prune Test','prune-test@wisc.edu',true,now(),now())
       ON CONFLICT (id) DO NOTHING`, [userId]);
    // one session that expired an hour ago, one valid for another week
    await pool.query(
      `INSERT INTO "session" (id, "expiresAt", token, "createdAt", "updatedAt", "userId")
       VALUES ($1, now() - interval '1 hour', $1, now(), now(), $3),
              ($2, now() + interval '7 days', $2, now(), now(), $3)
       ON CONFLICT (id) DO NOTHING`, [ids.expired, ids.live, userId]);
  });

  after(async () => {
    await pool.query(`DELETE FROM "session" WHERE "userId" = $1`, [userId]);
    await pool.query(`DELETE FROM "user" WHERE id = $1`, [userId]);
    await pool.end();
  });

  test("deletes expired sessions and leaves live ones alone", async () => {
    process.env.DATABASE_URL = connectionString;
    const { pruneExpiredSessions } = await import("../src/prune-sessions.js");
    await pruneExpiredSessions();

    const expired = await pool.query(`SELECT 1 FROM "session" WHERE id = $1`, [ids.expired]);
    const live = await pool.query(`SELECT 1 FROM "session" WHERE id = $1`, [ids.live]);

    assert.equal(expired.rowCount, 0, "expired session should be deleted");
    assert.equal(live.rowCount, 1, "live session must survive — deleting it would sign a user out");
  });
});
