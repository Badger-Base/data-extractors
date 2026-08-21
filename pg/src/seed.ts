import fs from "fs/promises";
import path from "path";
import { extractCourses } from "./extractors/courses.js";
import { extractMadgrades } from "./extractors/madgrades.js";
import { extractRmp } from "./extractors/rmp.js";
import { withTransaction, end } from "./db.js";
import type pg from "pg";

const SQL_DIR = path.resolve(import.meta.dirname, "../data/sql");

async function loadDump(client: pg.PoolClient, file: string) {
  const filePath = path.join(SQL_DIR, file);
  const sql = await fs.readFile(filePath, "utf-8");
  const size = (sql.length / 1024).toFixed(0);
  console.log(`Executing ${file} (${size} KB)...`);
  const t = Date.now();
  await client.query(sql);
  console.log(`  Done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
}

async function seed() {
  const startTime = Date.now();
  console.log("Starting full ETL pipeline...\n");

  // Extract courses + madgrades (no DB dependency)
  await extractCourses();
  console.log("");
  await extractMadgrades();
  console.log("");

  // Load courses dump so RMP can read instructor names for fuzzy matching
  console.log("Loading courses dump for RMP name matching...");
  await withTransaction(async (client) => {
    await loadDump(client, "courses.sql");
  });
  console.log("");

  // Extract RMP (reads section_instructors from DB, writes rmp.sql)
  await extractRmp();
  console.log("");

  // Final load — each dump truncates only its own tables
  console.log("── Loading all dumps ──────────────────────────────\n");
  await withTransaction(async (client) => {
    await loadDump(client, "courses.sql");
    await loadDump(client, "madgrades.sql");
    await loadDump(client, "rmp.sql");
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nETL pipeline complete in ${elapsed}s`);
  await end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
