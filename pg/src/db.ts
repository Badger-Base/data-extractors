import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  console.error("Unexpected pool error:", err);
  process.exit(1);
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function truncateAll(client: pg.PoolClient): Promise<void> {
  await client.query(`
    TRUNCATE
      section_meetings,
      section_instructors,
      sections,
      courses,
      subjects,
      rmp_cleaned,
      madgrades_course_grades
    CASCADE
  `);
}

export async function end(): Promise<void> {
  await pool.end();
}

export default pool;
