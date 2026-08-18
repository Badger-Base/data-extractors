import { withTransaction, truncateAll, end } from "./db.js";
import { extractAndLoadCourses } from "./extractors/courses.js";
import { extractAndLoadMadgrades } from "./extractors/madgrades.js";
import { extractAndLoadRmp } from "./extractors/rmp.js";

async function seed() {
  const startTime = Date.now();
  console.log("Starting full ETL pipeline...\n");

  await withTransaction(async (client) => {
    console.log("Truncating all tables...");
    await truncateAll(client);
    console.log("Tables truncated.\n");
  });

  // Courses must run first — populates section_instructors,
  // which the RMP extractor needs for fuzzy name matching
  await extractAndLoadCourses();
  console.log("");

  // RMP needs section_instructors to exist for name matching.
  // Madgrades has no such dependency, so run it in parallel with RMP.
  await Promise.all([
    extractAndLoadMadgrades(),
    extractAndLoadRmp(),
  ]);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nETL pipeline complete in ${elapsed}s`);
  await end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
