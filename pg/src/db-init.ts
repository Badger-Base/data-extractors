import fs from "fs/promises";
import path from "path";
import { query, end } from "./db.js";

async function init() {
  const sqlPath = path.resolve(import.meta.dirname, "../schema/001_init.sql");
  const sql = await fs.readFile(sqlPath, "utf-8");

  console.log("Dropping existing schema...");
  await query(`
    DROP TABLE IF EXISTS
      section_subscriptions, course_subscriptions,
      madgrades_course_grades, rmp_cleaned,
      section_meetings, section_instructors,
      sections, courses, subjects
    CASCADE;
    DROP TYPE IF EXISTS section_status CASCADE;
    DROP FUNCTION IF EXISTS update_updated_at() CASCADE;
  `);

  console.log("Applying schema...");
  await query(sql);
  console.log("Schema applied successfully.");
  await end();
}

init().catch((err) => {
  console.error("Schema init failed:", err);
  process.exit(1);
});
