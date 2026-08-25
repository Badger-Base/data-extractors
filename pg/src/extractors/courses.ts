import puppeteer, { type Browser, type Page } from "puppeteer";
import { v4 as uuidv4 } from "uuid";
import config from "../config.js";

const { testMode: TEST_MODE, testCourseLimit: TEST_COURSE_LIMIT } = config.development;
const RATE_LIMIT_DELAY = TEST_MODE ? 50 : config.rateLimiting.delay;
const BATCH_SIZE = TEST_MODE ? 3 : config.rateLimiting.batchSize;
const MAX_RETRIES = TEST_MODE ? 1 : config.rateLimiting.maxRetries;
const SELECTED_TERM = config.apis.courseSearch.selectedTerm;
const BASE_HEADERS = config.apis.courseSearch.headers;

// ── Types ───────────────────────────────────────────────────────────

export interface CourseHit {
  courseId: string;
  catalogNumber: string;
  subject: { subjectCode: string; footnotes?: string[] };
  courseDesignation: string;
  fullCourseDesignation?: string;
  minimumCredits?: number;
  maximumCredits?: number;
  title?: string;
  description?: string;
  enrollmentPrerequisites?: string;
  generalEd?: { code: string };
  ethnicStudies?: { code: string };
  lettersAndScienceCredits?: { code: string } | null;
  breadths?: { code: string }[];
  levels?: { code: string }[];
  typicallyOffered?: string;
  workplaceExperience?: { description: string };
  gradingBasis?: { description: string };
  openToFirstYear?: boolean;
  repeatable?: string | boolean;
}

export interface EnrollmentPackage {
  enrollmentClassNumber: string;
  courseId: string;
  subjectCode: string;
  catalogNumber: string;
  packageEnrollmentStatus?: { status: string; availableSeats?: number; waitlistTotal?: number };
  isAsynchronous?: boolean;
  enrollmentRequirementGroups?: {
    catalogRequirementGroups?: { description?: string }[];
    classAssociationRequirementGroups?: { description?: string }[];
  };
  sections?: {
    type: string;
    sectionNumber: string;
    instructionMode?: string;
    instructors?: { name: { first: string; last: string } }[];
    enrollmentStatus?: { capacity: number; currentlyEnrolled: number };
    classMeetings?: {
      meetingType: string;
      meetingOrExamNumber?: string;
      meetingDays?: string;
      meetingDaysList?: string[];
      meetingTimeStart?: number;
      meetingTimeEnd?: number;
      building?: { buildingName: string };
      room?: string;
    }[];
  }[];
}

interface CourseRow {
  courseId: string;
  courseUuid: string;
  catalogNumber: number;
  subjectCode: string;
  courseDesignation: string;
  fullCourseDesignation: string | null;
  minimumCredits: number | null;
  maximumCredits: number | null;
  title: string | null;
  description: string | null;
  enrollmentPrerequisites: string | null;
  lettersAndScienceCredits: boolean;
  generalEducation: string | null;
  ethnicStudies: boolean;
  socialScience: boolean;
  humanities: boolean;
  biologicalScience: boolean;
  physicalScience: boolean;
  naturalScience: boolean;
  literature: boolean;
  level: string | null;
  typicallyOffered: string | null;
  workplaceExperienceDescription: string | null;
  gradingBasisDescription: string | null;
  openToFirstYear: boolean;
  repeatableForCredit: boolean;
}

export interface SectionRow {
  sectionId: string;
  sectionUuid: string;
  courseUuid: string;
  status: string;
  availableSeats: number;
  waitlistTotal: number;
  capacity: number;
  enrolled: number;
  instructionMode: string;
  isAsynchronous: boolean;
  sectionRequisites: string | null;
  instructors: string[];
}

export interface MeetingRow {
  sectionUuid: string;
  meetingType: string;
  meetingNumber: number | null;
  sectionNumber: string | null;
  meetingDays: string | null;
  startTime: string | null;
  endTime: string | null;
  buildingName: string | null;
  room: string | null;
  location: string | null;
  mondayMeetingStart: number | null;
  mondayMeetingEnd: number | null;
  tuesdayMeetingStart: number | null;
  tuesdayMeetingEnd: number | null;
  wednesdayMeetingStart: number | null;
  wednesdayMeetingEnd: number | null;
  thursdayMeetingStart: number | null;
  thursdayMeetingEnd: number | null;
  fridayMeetingStart: number | null;
  fridayMeetingEnd: number | null;
}

// ── Helpers ─────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string, level = "INFO"): void {
  const ts = new Date().toISOString().substring(11, 23);
  console.log(`[${ts}] [${level}] ${message}`);
}

export function formatTime(millis: number | null | undefined): string | null {
  if (!millis) return null;
  const CST_OFFSET_MS = 6 * 60 * 60 * 1000;
  let adjusted = millis - CST_OFFSET_MS;
  if (adjusted < 0) adjusted += 24 * 60 * 60 * 1000;
  const hours = Math.floor(adjusted / 3600000);
  const minutes = Math.floor((adjusted % 3600000) / 60000);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes.toString().padStart(2, "0")} ${period}`;
}

// ── Browser / request helpers ───────────────────────────────────────

let browserInstance: Browser | null = null;
let browserPage: Page | null = null;

async function initBrowser(): Promise<void> {
  const isHeadless = config.puppeteer.headless;
  log(`Initializing browser session (headless=${isHeadless})...`);

  browserInstance = await puppeteer.launch({
    headless: isHeadless,
    args: [...config.puppeteer.args],
  });
  browserPage = await browserInstance.newPage();
  await browserPage.setViewport(config.puppeteer.viewport);
  await browserPage.setUserAgent(config.puppeteer.userAgent);

  log("Navigating to enrollment site for WAF token...");
  await browserPage.goto("https://public.enroll.wisc.edu/search", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await delay(3000);

  const pageTitle = await browserPage.title();
  if (pageTitle === "Human Verification") {
    if (isHeadless) {
      log("CAPTCHA detected in headless mode — waiting up to 5 min...", "WARNING");
    } else {
      log("CAPTCHA detected — please solve it in the browser window", "WARNING");
    }
    const maxWait = isHeadless ? 300 : 600;
    let elapsed = 0;
    while (elapsed < maxWait) {
      await delay(2000);
      elapsed += 2;
      const title = await browserPage.title();
      if (title !== "Human Verification" && !title.includes("Verification")) {
        log(`CAPTCHA solved after ${elapsed}s`, "SUCCESS");
        break;
      }
      if (elapsed % 30 === 0) log(`Still waiting for CAPTCHA... (${elapsed}s)`);
    }
    if (elapsed >= maxWait) {
      throw new Error("CAPTCHA not solved in time");
    }
  }

  const cookies = await browserPage.cookies();
  const waf = cookies.find((c) => c.name === "aws-waf-token");
  log(waf ? "WAF token acquired" : "No WAF token found (may still work)", waf ? "SUCCESS" : "WARNING");
}

async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
    browserPage = null;
  }
}

async function makeRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (browserPage) {
        const result = await browserPage.evaluate(
          async (reqUrl: string, method: string, headers: Record<string, string>, body: string | null) => {
            try {
              const h = new Headers();
              for (const [k, v] of Object.entries(headers)) h.set(k, v);
              const opts: RequestInit = { method, headers: h, credentials: "include", mode: "cors", cache: "no-cache" };
              if (body) opts.body = body;
              const resp = await fetch(reqUrl, opts);
              const text = await resp.text();
              if (!resp.ok) return { __error: true, message: `HTTP ${resp.status}: ${text.substring(0, 300)}` };
              return JSON.parse(text);
            } catch (e: unknown) {
              return { __error: true, message: (e as Error).message };
            }
          },
          url,
          (options.method as string) || "GET",
          (options.headers as Record<string, string>) || BASE_HEADERS,
          (options.body as string) || null
        );
        if (result && (result as { __error?: boolean }).__error) {
          throw new Error((result as { message: string }).message);
        }
        return result as T;
      }

      const resp = await fetch(url, options);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return (await resp.json()) as T;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      const backoff = RATE_LIMIT_DELAY * Math.pow(2, attempt);
      log(`Request failed (attempt ${attempt + 1}), retrying in ${backoff}ms...`, "ERROR");
      await delay(backoff);
    }
  }
  throw new Error("unreachable");
}

// ── Data transformation ─────────────────────────────────────────────

export function transformCourse(hit: CourseHit): CourseRow {
  const hasBreadth = (code: string) => hit.breadths?.some((b) => b.code === code) ?? false;
  return {
    courseId: hit.courseId,
    courseUuid: uuidv4(),
    catalogNumber: parseInt(hit.catalogNumber, 10),
    subjectCode: hit.subject.subjectCode,
    courseDesignation: hit.courseDesignation,
    fullCourseDesignation: hit.fullCourseDesignation ?? null,
    minimumCredits: hit.minimumCredits ?? null,
    maximumCredits: hit.maximumCredits ?? null,
    title: hit.title ?? null,
    description: hit.description ?? null,
    enrollmentPrerequisites: hit.enrollmentPrerequisites ?? null,
    lettersAndScienceCredits: !!hit.lettersAndScienceCredits?.code,
    generalEducation: hit.generalEd?.code ?? null,
    ethnicStudies: !!hit.ethnicStudies?.code,
    socialScience: hasBreadth("S"),
    humanities: hasBreadth("H"),
    biologicalScience: hasBreadth("B"),
    physicalScience: hasBreadth("P"),
    naturalScience: hasBreadth("N"),
    literature: hasBreadth("L"),
    level: hit.levels?.[0]?.code ?? null,
    typicallyOffered: hit.typicallyOffered ?? null,
    workplaceExperienceDescription: hit.workplaceExperience?.description ?? null,
    gradingBasisDescription: hit.gradingBasis?.description ?? null,
    openToFirstYear: !!hit.openToFirstYear,
    repeatableForCredit: hit.repeatable === "Y" || hit.repeatable === true,
  };
}

export function getSmallestEnrollment(sections: EnrollmentPackage["sections"]): { capacity: number; currentlyEnrolled: number } | null {
  if (!sections?.length) return null;
  const withEnrollment = sections.filter((s) => s.enrollmentStatus && s.enrollmentStatus.capacity > 0);
  if (!withEnrollment.length) return null;
  return withEnrollment.reduce((smallest, cur) =>
    !smallest || cur.enrollmentStatus!.capacity < smallest.enrollmentStatus!.capacity ? cur : smallest
  ).enrollmentStatus!;
}

export function formatSections(
  packages: EnrollmentPackage[],
  courseUuid: string,
  coursePrereqs: string | null
): { sections: SectionRow[]; meetings: MeetingRow[] } {
  const sections: SectionRow[] = [];
  const meetings: MeetingRow[] = [];
  const normalizePrereq = (p: string | null | undefined) =>
    (p ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/^none$/i, "");
  const normalizedCoursePrereq = normalizePrereq(coursePrereqs);
  const seenSectionIds = new Set<string>();

  for (const pkg of packages) {
    const sectionId = String(pkg.enrollmentClassNumber);
    if (seenSectionIds.has(sectionId)) continue;
    seenSectionIds.add(sectionId);
    const sectionUuid = uuidv4();
    const primary = pkg.sections?.[0];
    const instructors =
      primary?.instructors?.map((i) => `${i.name?.first ?? ""} ${i.name?.last ?? ""}`.trim()).filter(Boolean) ?? [];

    const smallestEnrollment = getSmallestEnrollment(pkg.sections);
    const enrollment = smallestEnrollment ?? primary?.enrollmentStatus ?? { capacity: 0, currentlyEnrolled: 0 };

    const sectionRequisites: string[] = [];
    pkg.enrollmentRequirementGroups?.catalogRequirementGroups?.forEach((g) => {
      if (g.description && normalizePrereq(g.description) !== normalizedCoursePrereq) {
        sectionRequisites.push(g.description);
      }
    });
    pkg.enrollmentRequirementGroups?.classAssociationRequirementGroups?.forEach((g) => {
      if (g.description) sectionRequisites.push(g.description);
    });

    const statusRaw = pkg.packageEnrollmentStatus?.status ?? "CLOSED";
    const status = statusRaw === "OPEN" || statusRaw === "WAITLISTED" || statusRaw === "CLOSED" ? statusRaw : "CLOSED";

    sections.push({
      sectionId,
      sectionUuid,
      courseUuid,
      status,
      availableSeats: pkg.packageEnrollmentStatus?.availableSeats ?? 0,
      waitlistTotal: pkg.packageEnrollmentStatus?.waitlistTotal ?? 0,
      capacity: enrollment.capacity ?? 0,
      enrolled: enrollment.currentlyEnrolled ?? 0,
      instructionMode: primary?.instructionMode ?? "UNKNOWN",
      isAsynchronous: pkg.isAsynchronous ?? false,
      sectionRequisites: sectionRequisites.length > 0 ? sectionRequisites.join("; ") : null,
      instructors,
    });

    for (const nested of pkg.sections ?? []) {
      const classMeeting = nested.classMeetings?.find((m) => m.meetingType === "CLASS");
      if (!classMeeting) continue;

      const meetingData: MeetingRow = {
        sectionUuid,
        meetingType: nested.type,
        meetingNumber: classMeeting.meetingOrExamNumber ? parseInt(classMeeting.meetingOrExamNumber, 10) : null,
        sectionNumber: nested.sectionNumber ?? null,
        meetingDays: classMeeting.meetingDays ?? null,
        startTime: formatTime(classMeeting.meetingTimeStart),
        endTime: formatTime(classMeeting.meetingTimeEnd),
        buildingName: classMeeting.building?.buildingName ?? null,
        room: classMeeting.room ?? null,
        location: classMeeting.building
          ? `${classMeeting.building.buildingName ?? ""} ${classMeeting.room ?? ""}`.trim()
          : null,
        mondayMeetingStart: null,
        mondayMeetingEnd: null,
        tuesdayMeetingStart: null,
        tuesdayMeetingEnd: null,
        wednesdayMeetingStart: null,
        wednesdayMeetingEnd: null,
        thursdayMeetingStart: null,
        thursdayMeetingEnd: null,
        fridayMeetingStart: null,
        fridayMeetingEnd: null,
      };

      const startMs = classMeeting.meetingTimeStart ?? null;
      const endMs = classMeeting.meetingTimeEnd ?? null;
      for (const day of classMeeting.meetingDaysList ?? []) {
        switch (day.toUpperCase()) {
          case "MONDAY":
            meetingData.mondayMeetingStart = startMs;
            meetingData.mondayMeetingEnd = endMs;
            break;
          case "TUESDAY":
            meetingData.tuesdayMeetingStart = startMs;
            meetingData.tuesdayMeetingEnd = endMs;
            break;
          case "WEDNESDAY":
            meetingData.wednesdayMeetingStart = startMs;
            meetingData.wednesdayMeetingEnd = endMs;
            break;
          case "THURSDAY":
            meetingData.thursdayMeetingStart = startMs;
            meetingData.thursdayMeetingEnd = endMs;
            break;
          case "FRIDAY":
            meetingData.fridayMeetingStart = startMs;
            meetingData.fridayMeetingEnd = endMs;
            break;
        }
      }

      meetings.push(meetingData);
    }
  }

  return { sections, meetings };
}

// ── API fetching ────────────────────────────────────────────────────

async function fetchAllCourses(): Promise<{ hits: CourseHit[]; found: number | null }> {
  if (TEST_MODE) {
    const pageSize = TEST_COURSE_LIMIT;
    const resp = await makeRequest<{ hits: CourseHit[]; found?: number }>(
      "https://public.enroll.wisc.edu/api/search/v1",
      {
        headers: BASE_HEADERS,
        method: "POST",
        body: JSON.stringify({
          selectedTerm: SELECTED_TERM,
          queryString: "*",
          filters: [
            {
              has_child: {
                type: "enrollmentPackage",
                query: {
                  bool: {
                    must: [
                      { match: { "packageEnrollmentStatus.status": "OPEN WAITLISTED CLOSED" } },
                      { match: { published: true } },
                    ],
                  },
                },
              },
            },
          ],
          page: 1,
          pageSize,
          sortOrder: "SCORE",
        }),
      }
    );
    return { hits: resp.hits, found: resp.found ?? null };
  }

  const allHits: CourseHit[] = [];
  let page = 1;
  let totalFound: number | null = null;

  while (true) {
    log(`Fetching course page ${page}...`);
    const resp = await makeRequest<{ hits: CourseHit[]; found?: number; totalHits?: number }>(
      "https://public.enroll.wisc.edu/api/search/v1",
      {
        headers: BASE_HEADERS,
        method: "POST",
        body: JSON.stringify({
          selectedTerm: SELECTED_TERM,
          queryString: "*",
          filters: [
            {
              has_child: {
                type: "enrollmentPackage",
                query: {
                  bool: {
                    must: [
                      { match: { "packageEnrollmentStatus.status": "OPEN WAITLISTED CLOSED" } },
                      { match: { published: true } },
                    ],
                  },
                },
              },
            },
          ],
          page,
          pageSize: 10000,
          sortOrder: "SCORE",
        }),
      }
    );

    const hits = resp.hits ?? [];
    if (totalFound === null) totalFound = resp.found ?? resp.totalHits ?? null;
    allHits.push(...hits);
    log(`Page ${page}: ${hits.length} hits (total ${allHits.length}${totalFound ? `/${totalFound}` : ""})`);

    if (hits.length === 0 || (totalFound !== null && allHits.length >= totalFound) || page >= 50) break;
    page++;
  }

  return { hits: allHits, found: totalFound };
}

async function fetchSections(subjectCode: string, courseId: string): Promise<EnrollmentPackage[]> {
  return makeRequest<EnrollmentPackage[]>(
    `https://public.enroll.wisc.edu/api/search/v1/enrollmentPackages/${SELECTED_TERM}/${subjectCode}/${courseId}`,
    { headers: BASE_HEADERS, method: "GET" }
  );
}

// ── SQL dump generation ────────────────────────────────────────────

// ── Main entry point ────────────────────────────────────────────────

export async function extractCourses(): Promise<void> {
  const startTime = Date.now();
  log("Starting course extraction...");

  try {
    await initBrowser();

    const { hits, found } = await fetchAllCourses();
    let coursesToProcess = hits;
    if (TEST_MODE) {
      coursesToProcess = coursesToProcess.slice(0, TEST_COURSE_LIMIT);
    }
    log(`Processing ${coursesToProcess.length} courses (API reported ${found ?? "unknown"} total)`, "SUCCESS");

    if (coursesToProcess.length === 0) {
      log("Aborting: 0 courses returned — refusing to generate empty dump that would wipe the database", "ERROR");
      process.exit(1);
    }

    const courseRows = coursesToProcess.map(transformCourse);

    // Build subjects map
    const subjectMap = new Map<string, string | null>();
    for (const hit of coursesToProcess) {
      const code = hit.subject?.subjectCode;
      if (!code || subjectMap.has(code)) continue;
      const footnotes = hit.subject.footnotes?.join("\n") ?? null;
      subjectMap.set(code, footnotes);
    }

    // Fetch sections in batches
    log("Fetching section data...");
    const allSections: { courseUuid: string; prereqs: string | null; packages: EnrollmentPackage[] }[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < courseRows.length; i += BATCH_SIZE) {
      const batch = courseRows.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(courseRows.length / BATCH_SIZE);
      log(`Fetching sections batch ${batchNum}/${totalBatches}...`);

      const results = await Promise.allSettled(
        batch.map(async (course, idx) => {
          await delay(idx * 10);
          const packages = await fetchSections(course.subjectCode, course.courseId);
          return { courseUuid: course.courseUuid, prereqs: course.enrollmentPrerequisites, packages };
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled") {
          successCount++;
          allSections.push(r.value);
        } else {
          errorCount++;
          log(`Section fetch failed: ${r.reason}`, "ERROR");
        }
      }

      if (i + BATCH_SIZE < courseRows.length) await delay(200);
    }

    log(`Sections fetched: ${successCount} success, ${errorCount} errors`, "SUCCESS");

    // Format all section/meeting data
    const sectionsByCourse = new Map<string, { sections: SectionRow[]; meetings: MeetingRow[] }>();
    for (const { courseUuid, prereqs, packages } of allSections) {
      const formatted = formatSections(packages, courseUuid, prereqs);
      sectionsByCourse.set(courseUuid, formatted);
    }

    // Generate SQL dump
    log("Generating SQL dump...");
    const { SqlWriter, esc, escEnum } = await import("../utils/sql-writer.js");
    const sql = new SqlWriter();

    sql.comment("BadgerBase Course Data Dump");
    sql.comment(`Generated ${new Date().toISOString()}`);
    sql.comment(`${courseRows.length} courses, ${allSections.length} section sets`);
    sql.blank();

    sql.comment("Teardown — only course-related tables, leaves rmp/madgrades intact");
    sql.raw("TRUNCATE section_meetings, section_instructors, sections, courses, subjects CASCADE;");
    sql.blank();

    // Subjects
    sql.comment("Subjects");
    sql.insertBatch(
      "subjects",
      ["subject_code", "footnotes"],
      [...subjectMap.entries()].map(([code, fn]) => [esc(code), esc(fn)])
    );

    // Courses
    sql.comment("Courses");
    const courseColumns = [
      "course_id", "course_uuid", "subject_code", "course_designation",
      "full_course_designation", "course_title", "catalog_number",
      "course_description", "enrollment_prerequisites",
      "minimum_credits", "maximum_credits", "letters_and_science_credits",
      "ethnic_studies", "social_science", "humanities", "biological_science",
      "physical_science", "natural_science", "literature",
      "general_education", "level", "typically_offered",
      "workplace_experience_description", "grading_basis_description",
      "open_to_first_year", "repeatable_for_credit",
    ];
    sql.insertBatch(
      "courses",
      courseColumns,
      courseRows.map((c) => [
        esc(c.courseId), esc(c.courseUuid), esc(c.subjectCode), esc(c.courseDesignation),
        esc(c.fullCourseDesignation), esc(c.title), esc(c.catalogNumber),
        esc(c.description), esc(c.enrollmentPrerequisites),
        esc(c.minimumCredits), esc(c.maximumCredits), esc(c.lettersAndScienceCredits),
        esc(c.ethnicStudies), esc(c.socialScience), esc(c.humanities), esc(c.biologicalScience),
        esc(c.physicalScience), esc(c.naturalScience), esc(c.literature),
        esc(c.generalEducation), esc(c.level), esc(c.typicallyOffered),
        esc(c.workplaceExperienceDescription), esc(c.gradingBasisDescription),
        esc(c.openToFirstYear), esc(c.repeatableForCredit),
      ])
    );

    // Sections — subquery for course_ref FK, section_uuid for downstream lookups
    sql.comment("Sections");
    const sectionColumns = [
      "section_id", "section_uuid", "course_ref", "status", "available_seats", "waitlist_total",
      "capacity", "enrolled", "instruction_mode", "is_asynchronous", "section_requisites",
    ];
    const sectionRows: string[][] = [];
    for (const course of courseRows) {
      const data = sectionsByCourse.get(course.courseUuid);
      if (!data) continue;
      const courseRefSub = `(SELECT id FROM courses WHERE course_uuid = ${esc(course.courseUuid)})`;
      for (const s of data.sections) {
        sectionRows.push([
          esc(s.sectionId), esc(s.sectionUuid), courseRefSub, escEnum(s.status, "section_status"),
          esc(s.availableSeats), esc(s.waitlistTotal),
          esc(s.capacity), esc(s.enrolled), esc(s.instructionMode),
          esc(s.isAsynchronous), esc(s.sectionRequisites),
        ]);
      }
    }
    sql.insertBatch("sections", sectionColumns, sectionRows);

    // Instructors — resolve section FK via section_uuid
    sql.comment("Section Instructors");
    const instructorRows: string[][] = [];
    for (const course of courseRows) {
      const data = sectionsByCourse.get(course.courseUuid);
      if (!data) continue;
      for (const s of data.sections) {
        const sectionRefSub = `(SELECT id FROM sections WHERE section_uuid = ${esc(s.sectionUuid)})`;
        for (const name of s.instructors) {
          if (name.trim()) {
            instructorRows.push([sectionRefSub, esc(name)]);
          }
        }
      }
    }
    sql.insertBatch("section_instructors", ["section_id", "instructor_name"], instructorRows);

    // Meetings — resolve section FK via section_uuid
    sql.comment("Section Meetings");
    const meetingColumns = [
      "section_id", "meeting_number", "section_number", "meeting_type", "meeting_days",
      "start_time", "end_time", "building_name", "room", "location",
      "monday_meeting_start", "monday_meeting_end",
      "tuesday_meeting_start", "tuesday_meeting_end",
      "wednesday_meeting_start", "wednesday_meeting_end",
      "thursday_meeting_start", "thursday_meeting_end",
      "friday_meeting_start", "friday_meeting_end",
    ];
    const meetingRows: string[][] = [];
    for (const course of courseRows) {
      const data = sectionsByCourse.get(course.courseUuid);
      if (!data) continue;
      for (const m of data.meetings) {
        const sectionRefSub = `(SELECT id FROM sections WHERE section_uuid = ${esc(m.sectionUuid)})`;
        meetingRows.push([
          sectionRefSub, esc(m.meetingNumber), esc(m.sectionNumber),
          esc(m.meetingType), esc(m.meetingDays),
          esc(m.startTime), esc(m.endTime),
          esc(m.buildingName), esc(m.room), esc(m.location),
          esc(m.mondayMeetingStart), esc(m.mondayMeetingEnd),
          esc(m.tuesdayMeetingStart), esc(m.tuesdayMeetingEnd),
          esc(m.wednesdayMeetingStart), esc(m.wednesdayMeetingEnd),
          esc(m.thursdayMeetingStart), esc(m.thursdayMeetingEnd),
          esc(m.fridayMeetingStart), esc(m.fridayMeetingEnd),
        ]);
      }
    }
    sql.insertBatch("section_meetings", meetingColumns, meetingRows);

    const filePath = await sql.writeTo("courses.sql");
    log(`SQL dump written to ${filePath}`, "SUCCESS");
    log(`${courseRows.length} courses, ${sectionRows.length} sections, ${instructorRows.length} instructors, ${meetingRows.length} meetings`);
  } finally {
    await closeBrowser();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`Course extraction complete in ${elapsed}s`, "SUCCESS");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  extractCourses().catch((err) => {
    console.error("Course extraction failed:", err);
    process.exit(1);
  });
}
