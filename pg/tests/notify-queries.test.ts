import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, type TestDb } from "./setup.js";
import * as fx from "./fixtures/subscriptions.js";
import {
  getOpenCourseSubscriptions,
  getOpenSectionSubscriptions,
} from "../src/notify.js";

const hasDb = Boolean(process.env.TEST_DATABASE_URL);

describe("notifier queries", { skip: !hasDb && "TEST_DATABASE_URL not set" }, () => {
  let db: TestDb;
  before(async () => { db = await setupTestDb(); });
  after(async () => { await db.teardown(); });
  beforeEach(async () => { await db.truncate(); });

  // The whole point of the job: do not email people about closed courses.
  it("returns nothing when every section is closed", async () => {
    await db.seed(fx.allClosed());
    assert.deepEqual(await getOpenCourseSubscriptions(), []);
  });

  it("returns a subscriber when a seat opens", async () => {
    await db.seed(fx.courseOpen("student@wisc.edu"));
    const hits = await getOpenCourseSubscriptions();
    assert.equal(hits.length, 1);
    assert.equal(hits[0].email, "student@wisc.edu");
    assert.equal(hits[0].has_open, true);
    assert.equal(hits[0].full_course_designation, "COMP SCI 400");
  });

  it("distinguishes a waitlist opening from an open seat", async () => {
    await db.seed(fx.courseWaitlisted());
    const hits = await getOpenCourseSubscriptions();
    assert.equal(hits.length, 1);
    assert.equal(hits[0].has_open, false);
    assert.equal(hits[0].has_waitlisted, true);
  });

  // bool_or aggregation: one open section among many still counts.
  it("notifies when only one of several sections is open", async () => {
    await db.seed(fx.courseOneOfTwoOpen());
    const hits = await getOpenCourseSubscriptions();
    assert.equal(hits.length, 1, "aggregation should collapse to one row per subscription");
    assert.equal(hits[0].has_open, true);
  });

  it("returns one row per subscriber, not per course", async () => {
    await db.seed(fx.twoSubscribers());
    const emails = (await getOpenCourseSubscriptions()).map((h) => h.email).sort();
    assert.deepEqual(emails, ["first@wisc.edu", "second@wisc.edu"]);
  });

  it("returns section subscriptions with meeting metadata", async () => {
    await db.seed(fx.sectionOpen("student@wisc.edu"));
    const hits = await getOpenSectionSubscriptions();
    assert.equal(hits.length, 1);
    assert.equal(hits[0].email, "student@wisc.edu");
    assert.equal(hits[0].status, "OPEN");
    assert.equal(hits[0].meeting_type, "LEC");
  });

  it("ignores section subscriptions whose section is closed", async () => {
    const f = fx.sectionOpen();
    f.sections![0].status = "CLOSED";
    await db.seed(f);
    assert.deepEqual(await getOpenSectionSubscriptions(), []);
  });

  // Deleting a subscription must not delete the course it pointed at.
  it("cascades from sections to their subscriptions, not the reverse", async () => {
    await db.seed(fx.sectionOpen());
    await db.pool.query("DELETE FROM section_subscriptions WHERE id = 1");
    const { rows } = await db.pool.query("SELECT count(*)::int n FROM sections");
    assert.equal(rows[0].n, 1, "removing a subscription must leave the section intact");
  });
});
