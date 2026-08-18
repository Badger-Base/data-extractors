import fs from "fs/promises";
import path from "path";
import { query, end } from "./db.js";

async function init() {
  const sqlPath = path.resolve(import.meta.dirname, "../schema/001_init.sql");
  const sql = await fs.readFile(sqlPath, "utf-8");
  console.log("Applying schema...");
  await query(sql);
  console.log("Schema applied successfully.");
  await end();
}

init().catch((err) => {
  console.error("Schema init failed:", err);
  process.exit(1);
});
