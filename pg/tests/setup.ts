import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.resolve(__dirname, "../schema");

/**
 * Database harness for the notifier tests.
 *
 * Runs against a real Postgres rather than a SQLite stand-in. The notifier's
 * value is entirely in its SQL — multi-table joins, `bool_or` aggregation
 * over section status, an enum column, `ON DELETE CASCADE` — and a
 * translation layer would have to fake exactly the behaviour worth testing.
 * The database is cheap: CI runs one as a service container.
 *
 * Each test seeds a fixture into a truncated database, so fixtures compose
 * and no test depends on another having run.
 */
export interface TestDb {
  pool: pg.Pool;
  seed(fixture: Fixture): Promise<void>;
  truncate(): Promise<void>;
  teardown(): Promise<void>;
}

export interface Fixture {
  subjects?: Array<{ subject_code: string }>;
  courses?: Array<Record<string, unknown>>;
  sections?: Array<Record<string, unknown>>;
  section_meetings?: Array<Record<string, unknown>>;
  course_subscriptions?: Array<{ email: string; course_id: number }>;
  section_subscriptions?: Array<{ email: string; section_id: number }>;
}

// Truncated in dependency order; RESTART IDENTITY keeps fixture ids stable
// across tests, which is what lets fixtures hardcode course_id: 1.
const TABLES = [
  "section_subscriptions",
  "course_subscriptions",
  "section_meetings",
  "sections",
  "courses",
  "subjects",
];

async function applySchema(pool: pg.Pool): Promise<void> {
  const files = readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(path.join(SCHEMA_DIR, file), "utf8");
    try {
      await pool.query(sql);
    } catch (err) {
      // 42P07 duplicate_table / 42710 duplicate_object: the schema is already
      // there from a previous run. Anything else is a real failure.
      const code = (err as { code?: string }).code;
      if (code !== "42P07" && code !== "42710") throw err;
    }
  }
}

async function insert(
  pool: pg.Pool,
  table: string,
  rows: Array<Record<string, unknown>>
): Promise<void> {
  for (const row of rows) {
    const cols = Object.keys(row);
    const params = cols.map((_, i) => `$${i + 1}`).join(", ");
    await pool.query(
      `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${params})`,
      Object.values(row)
    );
  }
}

export async function setupTestDb(): Promise<TestDb> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error("TEST_DATABASE_URL is required to run the notifier tests");
  }
  const pool = new pg.Pool({ connectionString });
  await applySchema(pool);

  const truncate = async () => {
    await pool.query(
      `TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`
    );
  };

  return {
    pool,
    truncate,
    async seed(fixture: Fixture) {
      await truncate();
      await insert(pool, "subjects", fixture.subjects ?? []);
      await insert(pool, "courses", fixture.courses ?? []);
      await insert(pool, "sections", fixture.sections ?? []);
      await insert(pool, "section_meetings", fixture.section_meetings ?? []);
      await insert(pool, "course_subscriptions", fixture.course_subscriptions ?? []);
      await insert(pool, "section_subscriptions", fixture.section_subscriptions ?? []);
    },
    async teardown() {
      await pool.end();
    },
  };
}
