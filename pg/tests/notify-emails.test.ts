import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCourseEmailHtml,
  buildSectionEmailHtml,
  type CourseHit,
  type GroupedSection,
} from "../src/notify.js";

const course = (o: Partial<CourseHit> = {}): CourseHit =>
  ({
    subscription_id: 1,
    course_ref: 1,
    email: "student@wisc.edu",
    full_course_designation: "COMP SCI 400",
    course_title: "Programming III",
    course_id: "000001",
    has_open: true,
    has_waitlisted: false,
    ...o,
  }) as CourseHit;

const section = (o: Partial<GroupedSection> = {}): GroupedSection =>
  ({
    subscription_id: 1,
    section_ref: 1,
    email: "student@wisc.edu",
    full_course_designation: "COMP SCI 400",
    course_title: "Programming III",
    section_id: "10001",
    status: "OPEN",
    meetings: ["LEC 001"],
    ...o,
  }) as GroupedSection;

describe("course email body", () => {
  it("names the course so the subject is recognisable in an inbox", () => {
    const html = buildCourseEmailHtml(course());
    assert.match(html, /COMP SCI 400/);
    assert.match(html, /Programming III/);
  });

  it("says open when a seat opened", () => {
    const html = buildCourseEmailHtml(course({ has_open: true }));
    assert.match(html, /open/i);
  });

  // A waitlist spot is not an open seat; telling someone a seat is available
  // when it is not sends them to enroll and fail.
  it("distinguishes a waitlist opening from an open seat", () => {
    const open = buildCourseEmailHtml(course({ has_open: true, has_waitlisted: false }));
    const waitlisted = buildCourseEmailHtml(course({ has_open: false, has_waitlisted: true }));
    assert.notEqual(open, waitlisted, "the two states must not read identically");
    assert.match(waitlisted, /waitlist/i);
  });

  it("escapes nothing it should not, and emits no undefined", () => {
    const html = buildCourseEmailHtml(course({ course_title: null as unknown as string }));
    assert.doesNotMatch(html, /undefined|\[object Object\]/);
  });
});

describe("section email body", () => {
  it("names the course and the meeting", () => {
    const html = buildSectionEmailHtml(section());
    assert.match(html, /COMP SCI 400/);
    assert.match(html, /LEC 001/);
  });

  it("falls back to the section id when there are no meetings", () => {
    const html = buildSectionEmailHtml(section({ meetings: [] }));
    assert.match(html, /10001/);
  });

  it("distinguishes an open section from a waitlist opening", () => {
    const open = buildSectionEmailHtml(section({ status: "OPEN" }));
    const wait = buildSectionEmailHtml(section({ status: "WAITLISTED" }));
    assert.notEqual(open, wait);
    assert.match(wait, /waitlist/i);
  });

  it("does not emit undefined when meeting metadata is absent", () => {
    const html = buildSectionEmailHtml(
      section({ meetings: undefined as unknown as GroupedSection["meetings"] })
    );
    assert.doesNotMatch(html, /undefined|\[object Object\]/);
  });
});
