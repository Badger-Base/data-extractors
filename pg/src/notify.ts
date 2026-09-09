import { query, end } from "./db.js";
import dotenv from "dotenv";
import { pathToFileURL } from "node:url";
import { sendEmail } from "./mailer.js";

dotenv.config();

export interface CourseHit {
  subscription_id: number;
  course_ref: number;
  email: string;
  full_course_designation: string;
  course_title: string;
  course_id: string;
  has_open: boolean;
  has_waitlisted: boolean;
}

export interface SectionHit {
  subscription_id: number;
  section_ref: number;
  email: string;
  full_course_designation: string;
  course_title: string;
  section_id: string;
  status: string;
  section_number: string | null;
  meeting_type: string | null;
}

export async function getOpenCourseSubscriptions(): Promise<CourseHit[]> {
  const { rows } = await query<CourseHit>(`
    SELECT
      cs.id AS subscription_id,
      cs.course_id AS course_ref,
      cs.email,
      c.full_course_designation,
      c.course_title,
      c.course_id,
      bool_or(s.status = 'OPEN') AS has_open,
      bool_or(s.status = 'WAITLISTED') AS has_waitlisted
    FROM course_subscriptions cs
    JOIN courses c ON c.id = cs.course_id
    JOIN sections s ON s.course_ref = c.id
    WHERE s.status != 'CLOSED'
    GROUP BY cs.id, cs.course_id, cs.email,
             c.full_course_designation, c.course_title, c.course_id
  `);
  return rows;
}

export async function getOpenSectionSubscriptions(): Promise<SectionHit[]> {
  const { rows } = await query<SectionHit>(`
    SELECT
      ss.id AS subscription_id,
      ss.section_id AS section_ref,
      ss.email,
      c.full_course_designation,
      c.course_title,
      s.section_id,
      s.status,
      sm.section_number,
      sm.meeting_type
    FROM section_subscriptions ss
    JOIN sections s ON s.id = ss.section_id
    JOIN courses c ON c.id = s.course_ref
    LEFT JOIN section_meetings sm ON sm.section_id = s.id
    WHERE s.status != 'CLOSED'
  `);
  return rows;
}

export function buildCourseEmailHtml(course: CourseHit): string {
  const isOpen = course.has_open;
  const statusMessage = isOpen
    ? "This course has completely open seats available!"
    : "This course has waitlist seats available!";
  const alertType = isOpen ? "Open" : "Waitlist Available";

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #C5050C; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0;">
      <h1>Course ${alertType}</h1>
    </div>
    <div style="background-color: #f9f9f9; padding: 30px; border-radius: 0 0 5px 5px;">
      <p>Hello,</p>
      <p>Great news! ${statusMessage}</p>
      <div style="background-color: white; padding: 20px; margin: 20px 0; border-left: 4px solid #C5050C;">
        <h2>${course.full_course_designation}</h2>
        <p>${course.course_title}</p>
      </div>
      <p>Enroll now before seats fill up!</p>
      <p>Thank you for using BadgerBase!</p>
    </div>
    <div style="text-align: center; margin-top: 20px; color: #666; font-size: 12px;">
      <p>This is an automated message. Please do not reply to this email.</p>
    </div>
  </div>
</body></html>`;
}

export interface GroupedSection {
  subscription_id: number;
  section_ref: number;
  email: string;
  full_course_designation: string;
  course_title: string;
  section_id: string;
  status: string;
  meetings: string[];
}

export function buildSectionEmailHtml(section: GroupedSection): string {
  const isOpen = section.status === "OPEN";
  const statusMessage = isOpen
    ? "This section has completely open seats available!"
    : "This section has waitlist seats available!";
  const alertType = isOpen ? "Open" : "Waitlist Available";
  // Defensive: nobody watches this job, so a throw here means a subscriber
  // silently never hears that their seat opened.
  const meetingsDisplay =
    section.meetings && section.meetings.length > 0
      ? section.meetings.join(", ")
      : section.section_id;

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #C5050C; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0;">
      <h1>Section ${alertType}</h1>
    </div>
    <div style="background-color: #f9f9f9; padding: 30px; border-radius: 0 0 5px 5px;">
      <p>Hello,</p>
      <p>Great news! ${statusMessage}</p>
      <div style="background-color: white; padding: 20px; margin: 20px 0; border-left: 4px solid #C5050C;">
        <h2>${section.full_course_designation}</h2>
        <p>${section.course_title}</p>
        <p><strong>Section:</strong> ${meetingsDisplay}</p>
      </div>
      <p>Enroll now before seats fill up!</p>
      <p>Thank you for using BadgerBase!</p>
    </div>
    <div style="text-align: center; margin-top: 20px; color: #666; font-size: 12px;">
      <p>This is an automated message. Please do not reply to this email.</p>
    </div>
  </div>
</body></html>`;
}

async function main() {
  console.log("Starting Postgres notification service...\n");
  const startTime = Date.now();

  let sent = 0;
  let failed = 0;
  let deleted = 0;

  // --- Course subscriptions ---
  const courses = await getOpenCourseSubscriptions();
  console.log(`Found ${courses.length} course subscriptions with non-closed sections`);

  for (const course of courses) {
    try {
      const isOpen = course.has_open;
      const alertType = isOpen ? "Open" : "Waitlist Available";
      const subject = `${course.full_course_designation} - ${alertType}!`;

      await sendEmail(course.email, subject, buildCourseEmailHtml(course));
      sent++;

      await query("DELETE FROM course_subscriptions WHERE id = $1", [course.subscription_id]);
      deleted++;
      console.log(`  Deleted course sub ${course.subscription_id} for ${course.email}`);

      await new Promise((r) => setTimeout(r, 100));
    } catch (error: any) {
      console.error(`  Failed course email to ${course.email}: ${error.message}`);
      failed++;
    }
  }

  // --- Section subscriptions ---
  const sectionRows = await getOpenSectionSubscriptions();
  console.log(`\nFound ${sectionRows.length} section subscription rows with non-closed status`);

  const grouped = new Map<string, GroupedSection>();
  for (const row of sectionRows) {
    const key = `${row.subscription_id}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        subscription_id: row.subscription_id,
        section_ref: row.section_ref,
        email: row.email,
        full_course_designation: row.full_course_designation,
        course_title: row.course_title,
        section_id: row.section_id,
        status: row.status,
        meetings: [],
      });
    }
    if (row.section_number && row.meeting_type) {
      const label = `${row.meeting_type} ${row.section_number}`;
      const g = grouped.get(key)!;
      if (!g.meetings.includes(label)) g.meetings.push(label);
    }
  }

  const sections = [...grouped.values()];
  console.log(`Grouped into ${sections.length} unique section subscriptions`);

  for (const section of sections) {
    try {
      const isOpen = section.status === "OPEN";
      const alertType = isOpen ? "Open" : "Waitlist Available";
      const subject = `${section.full_course_designation} Section - ${alertType}!`;

      await sendEmail(section.email, subject, buildSectionEmailHtml(section));
      sent++;

      await query("DELETE FROM section_subscriptions WHERE id = $1", [section.subscription_id]);
      deleted++;
      console.log(`  Deleted section sub ${section.subscription_id} for ${section.email}`);

      await new Promise((r) => setTimeout(r, 100));
    } catch (error: any) {
      console.error(`  Failed section email to ${section.email}: ${error.message}`);
      failed++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nNotification service complete in ${elapsed}s`);
  console.log(`  Course hits: ${courses.length}`);
  console.log(`  Section hits: ${sections.length}`);
  console.log(`  Emails sent: ${sent}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Subscriptions deleted: ${deleted}`);

  await end();
}

// Only run when invoked directly. Importing this module used to execute the
// whole job as a side effect, which meant the queries and the email bodies
// could not be tested without connecting to a database and sending mail.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Notification service failed:", err);
    process.exit(1);
  });
}
