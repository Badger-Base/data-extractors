import type { Fixture } from "../setup.js";

/**
 * Fixture builders for the notifier.
 *
 * Each returns a complete, valid graph rather than a fragment, so a test
 * reads as one scenario. Ids are deterministic because setup truncates with
 * RESTART IDENTITY.
 */

const subject = { subject_code: "COMP SCI" };

function course(overrides: Record<string, unknown> = {}) {
  return {
    course_id: "000001",
    course_uuid: `uuid-course-${Math.random().toString(36).slice(2, 10)}`,
    subject_code: "COMP SCI",
    course_designation: "COMP SCI 400",
    full_course_designation: "COMP SCI 400",
    course_title: "Programming III",
    catalog_number: 400,
    ...overrides,
  };
}

function section(overrides: Record<string, unknown> = {}) {
  return {
    section_id: "10001",
    section_uuid: `uuid-section-${Math.random().toString(36).slice(2, 10)}`,
    course_ref: 1,
    status: "CLOSED",
    available_seats: 0,
    ...overrides,
  };
}

/** One course, one CLOSED section, one subscriber. Nobody should be emailed. */
export function allClosed(email = "student@wisc.edu"): Fixture {
  return {
    subjects: [subject],
    courses: [course()],
    sections: [section({ status: "CLOSED" })],
    course_subscriptions: [{ email, course_id: 1 }],
  };
}

/** A seat opened on the subscribed course. */
export function courseOpen(email = "student@wisc.edu"): Fixture {
  return {
    subjects: [subject],
    courses: [course()],
    sections: [section({ status: "OPEN", available_seats: 3 })],
    course_subscriptions: [{ email, course_id: 1 }],
  };
}

/** Course has a waitlist opening but no open seat. */
export function courseWaitlisted(email = "student@wisc.edu"): Fixture {
  return {
    subjects: [subject],
    courses: [course()],
    sections: [section({ status: "WAITLISTED", waitlist_total: 2 })],
    course_subscriptions: [{ email, course_id: 1 }],
  };
}

/**
 * Two sections, only one open. The course query aggregates with bool_or, so
 * this must still notify — a subscriber wants to know *any* seat opened.
 */
export function courseOneOfTwoOpen(email = "student@wisc.edu"): Fixture {
  return {
    subjects: [subject],
    courses: [course()],
    sections: [
      section({ section_id: "10001", status: "CLOSED" }),
      section({ section_id: "10002", status: "OPEN", available_seats: 1 }),
    ],
    course_subscriptions: [{ email, course_id: 1 }],
  };
}

/** A specific section opened, with meeting metadata for the email body. */
export function sectionOpen(email = "student@wisc.edu"): Fixture {
  return {
    subjects: [subject],
    courses: [course()],
    sections: [section({ status: "OPEN", available_seats: 2 })],
    section_meetings: [
      { section_id: 1, meeting_type: "LEC", section_number: "001" },
    ],
    section_subscriptions: [{ email, section_id: 1 }],
  };
}

/** Two people watching the same course — both should hear about it. */
export function twoSubscribers(): Fixture {
  return {
    subjects: [subject],
    courses: [course()],
    sections: [section({ status: "OPEN", available_seats: 1 })],
    course_subscriptions: [
      { email: "first@wisc.edu", course_id: 1 },
      { email: "second@wisc.edu", course_id: 1 },
    ],
  };
}
