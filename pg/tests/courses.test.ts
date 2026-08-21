import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getSmallestEnrollment,
  formatSections,
  formatTime,
  transformCourse,
  type EnrollmentPackage,
  type CourseHit,
} from "../src/extractors/courses.js";

// ─── getSmallestEnrollment ─────────────────────────────────────────

describe("getSmallestEnrollment", () => {
  it("returns null for null input", () => {
    assert.equal(getSmallestEnrollment(null as unknown as undefined), null);
  });

  it("returns null for empty array", () => {
    assert.equal(getSmallestEnrollment([]), null);
  });

  it("returns null for undefined", () => {
    assert.equal(getSmallestEnrollment(undefined), null);
  });

  it("returns null when no sections have enrollment data", () => {
    const sections = [
      { type: "LEC", sectionNumber: "001" },
      { type: "DIS", sectionNumber: "002" },
    ] as EnrollmentPackage["sections"];
    assert.equal(getSmallestEnrollment(sections), null);
  });

  it("returns null when capacity is 0", () => {
    const sections = [
      {
        type: "LEC",
        sectionNumber: "001",
        enrollmentStatus: { capacity: 0, currentlyEnrolled: 0 },
      },
    ] as EnrollmentPackage["sections"];
    assert.equal(getSmallestEnrollment(sections), null);
  });

  it("returns the only section enrollment", () => {
    const sections = [
      {
        type: "LEC",
        sectionNumber: "001",
        enrollmentStatus: { capacity: 30, currentlyEnrolled: 25 },
      },
    ] as EnrollmentPackage["sections"];
    const result = getSmallestEnrollment(sections);
    assert.equal(result!.capacity, 30);
    assert.equal(result!.currentlyEnrolled, 25);
  });

  it("returns smallest capacity among multiple sections", () => {
    const sections = [
      {
        type: "LEC",
        sectionNumber: "001",
        enrollmentStatus: { capacity: 200, currentlyEnrolled: 150 },
      },
      {
        type: "DIS",
        sectionNumber: "002",
        enrollmentStatus: { capacity: 30, currentlyEnrolled: 28 },
      },
      {
        type: "DIS",
        sectionNumber: "003",
        enrollmentStatus: { capacity: 100, currentlyEnrolled: 90 },
      },
    ] as EnrollmentPackage["sections"];
    const result = getSmallestEnrollment(sections);
    assert.equal(result!.capacity, 30);
  });

  it("skips sections without enrollment data", () => {
    const sections = [
      { type: "LEC", sectionNumber: "001" },
      {
        type: "DIS",
        sectionNumber: "002",
        enrollmentStatus: { capacity: 50, currentlyEnrolled: 40 },
      },
      { type: "DIS", sectionNumber: "003" },
    ] as EnrollmentPackage["sections"];
    const result = getSmallestEnrollment(sections);
    assert.equal(result!.capacity, 50);
  });
});

// ─── formatSections ────────────────────────────────────────────────

describe("formatSections", () => {
  it("returns empty arrays for empty input", () => {
    const result = formatSections([], "uuid-1", null);
    assert.deepEqual(result, { sections: [], meetings: [] });
  });

  it("formats a basic section with instructor and meeting", () => {
    const packages: EnrollmentPackage[] = [
      {
        enrollmentClassNumber: "12345",
        courseId: "CS101",
        subjectCode: "COMP",
        catalogNumber: "101",
        sections: [
          {
            type: "LEC",
            sectionNumber: "001",
            instructors: [{ name: { first: "Jane", last: "Smith" } }],
            instructionMode: "In Person",
            enrollmentStatus: { capacity: 30, currentlyEnrolled: 25 },
            classMeetings: [
              {
                meetingType: "CLASS",
                meetingOrExamNumber: "1",
                meetingDays: "MWF",
                meetingTimeStart: 54000000,
                meetingTimeEnd: 57600000,
                meetingDaysList: ["MONDAY", "WEDNESDAY", "FRIDAY"],
                building: { buildingName: "CS Building" },
                room: "1240",
              },
            ],
          },
        ],
        packageEnrollmentStatus: {
          status: "OPEN",
          availableSeats: 5,
          waitlistTotal: 0,
        },
        isAsynchronous: false,
      },
    ];

    const result = formatSections(packages, "uuid-1", "None");
    const { sections, meetings } = result;

    assert.equal(sections.length, 1);
    assert.equal(sections[0].sectionId, "12345");
    assert.equal(sections[0].status, "OPEN");
    assert.equal(sections[0].availableSeats, 5);
    assert.deepEqual(sections[0].instructors, ["Jane Smith"]);

    assert.equal(meetings.length, 1);
    assert.equal(meetings[0].meetingDays, "MWF");
    assert.equal(meetings[0].buildingName, "CS Building");
    assert.ok(meetings[0].mondayMeetingStart !== null);
    assert.ok(meetings[0].wednesdayMeetingStart !== null);
    assert.ok(meetings[0].fridayMeetingStart !== null);
    assert.equal(meetings[0].tuesdayMeetingStart, null);
    assert.equal(meetings[0].thursdayMeetingStart, null);
  });

  it("handles section with no instructors", () => {
    const packages: EnrollmentPackage[] = [
      {
        enrollmentClassNumber: "99999",
        courseId: "MATH200",
        subjectCode: "MATH",
        catalogNumber: "200",
        sections: [
          {
            type: "LEC",
            sectionNumber: "001",
            instructionMode: "Online",
            enrollmentStatus: { capacity: 100, currentlyEnrolled: 80 },
            classMeetings: [],
          },
        ],
        packageEnrollmentStatus: {
          status: "OPEN",
          availableSeats: 20,
          waitlistTotal: 0,
        },
        isAsynchronous: true,
      },
    ];

    const result = formatSections(packages, "uuid-2", "None");
    const { sections } = result;

    assert.equal(sections.length, 1);
    assert.deepEqual(sections[0].instructors, []);
    assert.equal(sections[0].isAsynchronous, true);
  });

  it("excludes section requisites that match course prerequisites", () => {
    const packages: EnrollmentPackage[] = [
      {
        enrollmentClassNumber: "55555",
        courseId: "PHYS201",
        subjectCode: "PHYS",
        catalogNumber: "201",
        sections: [
          {
            type: "LEC",
            sectionNumber: "001",
            instructors: [],
            instructionMode: "In Person",
            enrollmentStatus: { capacity: 50, currentlyEnrolled: 45 },
            classMeetings: [],
          },
        ],
        packageEnrollmentStatus: {
          status: "OPEN",
          availableSeats: 5,
          waitlistTotal: 0,
        },
        enrollmentRequirementGroups: {
          catalogRequirementGroups: [{ description: "Sophomore standing" }],
        },
      },
    ];

    const result = formatSections(packages, "uuid-3", "Sophomore standing");
    const { sections } = result;

    assert.equal(sections[0].sectionRequisites, null);
  });

  it("includes section-specific requisites", () => {
    const packages: EnrollmentPackage[] = [
      {
        enrollmentClassNumber: "77777",
        courseId: "BIO300",
        subjectCode: "BIO",
        catalogNumber: "300",
        sections: [
          {
            type: "LEC",
            sectionNumber: "001",
            instructors: [],
            instructionMode: "In Person",
            enrollmentStatus: { capacity: 40, currentlyEnrolled: 35 },
            classMeetings: [],
          },
        ],
        packageEnrollmentStatus: {
          status: "WAITLISTED",
          availableSeats: 0,
          waitlistTotal: 3,
        },
        enrollmentRequirementGroups: {
          classAssociationRequirementGroups: [
            { description: "Must be enrolled in Biology major" },
          ],
        },
      },
    ];

    const result = formatSections(packages, "uuid-4", "None");
    const { sections } = result;

    assert.equal(
      sections[0].sectionRequisites,
      "Must be enrolled in Biology major"
    );
  });
});

// ─── formatTime ────────────────────────────────────────────────────

describe("formatTime", () => {
  it("returns null for null input", () => {
    assert.equal(formatTime(null), null);
  });

  it("returns null for undefined input", () => {
    assert.equal(formatTime(undefined), null);
  });

  it("returns null for 0", () => {
    assert.equal(formatTime(0), null);
  });

  it("formats a morning time", () => {
    const result = formatTime(54000000);
    assert.ok(result !== null);
    assert.ok(result!.includes("AM") || result!.includes("PM"));
  });
});

// ─── transformCourse ───────────────────────────────────────────────

describe("transformCourse", () => {
  it("transforms a basic course hit to a CourseRow", () => {
    const hit: CourseHit = {
      courseId: "025015",
      catalogNumber: "200",
      subject: { subjectCode: "COMP SCI" },
      courseDesignation: "COMP SCI 200",
      fullCourseDesignation: "COMP SCI 200 — Programming I",
      minimumCredits: 3,
      maximumCredits: 3,
      title: "Programming I",
      description: "Intro to programming",
      enrollmentPrerequisites: "None",
      breadths: [{ code: "N" }, { code: "P" }],
      levels: [{ code: "Elementary" }],
      openToFirstYear: true,
    };

    const row = transformCourse(hit);

    assert.equal(row.courseId, "025015");
    assert.equal(row.catalogNumber, 200);
    assert.equal(row.subjectCode, "COMP SCI");
    assert.equal(row.title, "Programming I");
    assert.equal(row.naturalScience, true);
    assert.equal(row.physicalScience, true);
    assert.equal(row.socialScience, false);
    assert.equal(row.humanities, false);
    assert.equal(row.openToFirstYear, true);
    assert.equal(row.level, "Elementary");
    assert.ok(row.courseUuid.length > 0);
  });

  it("handles boolean breadth fields correctly", () => {
    const hit: CourseHit = {
      courseId: "001",
      catalogNumber: "101",
      subject: { subjectCode: "SOC" },
      courseDesignation: "SOC 101",
      breadths: [{ code: "S" }, { code: "H" }],
      ethnicStudies: { code: "ES" },
      lettersAndScienceCredits: { code: "Y" },
    };

    const row = transformCourse(hit);

    assert.equal(row.socialScience, true);
    assert.equal(row.humanities, true);
    assert.equal(row.ethnicStudies, true);
    assert.equal(row.lettersAndScienceCredits, true);
    assert.equal(row.biologicalScience, false);
    assert.equal(row.literature, false);
  });

  it("defaults optional fields to null", () => {
    const hit: CourseHit = {
      courseId: "002",
      catalogNumber: "300",
      subject: { subjectCode: "MATH" },
      courseDesignation: "MATH 300",
    };

    const row = transformCourse(hit);

    assert.equal(row.title, null);
    assert.equal(row.description, null);
    assert.equal(row.minimumCredits, null);
    assert.equal(row.level, null);
    assert.equal(row.generalEducation, null);
    assert.equal(row.openToFirstYear, false);
    assert.equal(row.repeatableForCredit, false);
  });
});
