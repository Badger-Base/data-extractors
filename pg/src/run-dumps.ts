import fs from "fs/promises";
import path from "path";
import { withTransaction, end } from "./db.js";
import type pg from "pg";

const SQL_DIR = path.resolve(import.meta.dirname, "../data/sql");

const DUMP_ORDER = ["courses.sql", "madgrades.sql", "rmp.sql"];

async function runDumps() {
  const startTime = Date.now();
  const files = process.argv.slice(2);
  const toRun = files.length > 0 ? files : DUMP_ORDER;

  console.log("Checking for dump files...");
  for (const file of toRun) {
    const filePath = path.join(SQL_DIR, file);
    try {
      await fs.access(filePath);
    } catch {
      console.error(`Dump file not found: ${filePath}`);
      console.error("Run the extractors first to generate dump files.");
      process.exit(1);
    }
  }

  await withTransaction(async (client: pg.PoolClient) => {
    for (const file of toRun) {
      const filePath = path.join(SQL_DIR, file);
      const sql = await fs.readFile(filePath, "utf-8");
      const size = (sql.length / 1024).toFixed(0);
      console.log(`Executing ${file} (${size} KB)...`);
      const t = Date.now();
      await client.query(sql);
      console.log(`  Done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
    }
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nAll dumps loaded in ${elapsed}s`);
  await end();
}

runDumps().catch((err) => {
  console.error("Run dumps failed:", err);
  process.exit(1);
});
