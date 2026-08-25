import config from "../config.js";
import { getMadgradesToken } from "../utils/get-madgrades-token.js";

let API_TOKEN = config.apis.madgrades.token;

// ── Types ───────────────────────────────────────────────────────────

interface MadgradesCourse {
  uuid: string;
  number: string;
  name: string;
  subjects: { abbreviation: string }[];
}

export interface GradeCounts {
  aCount: number;
  abCount: number;
  bCount: number;
  bcCount: number;
  cCount: number;
  dCount: number;
  fCount: number;
}

interface GradesResponse {
  courseUuid: string;
  cumulative: GradeCounts;
  courseOfferings?: { cumulative: GradeCounts }[];
}

interface ParsedGrade {
  courseName: string;
  courseUuid: string;
  medianGrade: string | null;
  aPercentage: number;
  abPercentage: number;
  bPercentage: number;
  bcPercentage: number;
  cPercentage: number;
  dPercentage: number;
  fPercentage: number;
  cumulativeGpa: number;
  mostRecentGpa: number | null;
}

// ── Pure grade functions (ported from original) ─────────────────────

export function calculateGrade(grades: GradeCounts): number {
  let total = 0;
  let totalCount = 0;
  total += grades.aCount * 4;
  totalCount += grades.aCount;
  total += grades.abCount * 3.5;
  totalCount += grades.abCount;
  total += grades.bCount * 3;
  totalCount += grades.bCount;
  total += grades.bcCount * 2.5;
  totalCount += grades.bcCount;
  total += grades.cCount * 2;
  totalCount += grades.cCount;
  total += grades.dCount * 1;
  totalCount += grades.dCount;
  totalCount += grades.fCount;
  return totalCount === 0 ? 0 : total / totalCount;
}

export function getGradePercentages(grades: GradeCounts) {
  let totalCount = 0;
  totalCount += grades.aCount;
  totalCount += grades.abCount;
  totalCount += grades.bCount;
  totalCount += grades.bcCount;
  totalCount += grades.cCount;
  totalCount += grades.dCount;
  totalCount += grades.fCount;
  if (totalCount === 0) return { a: 0, ab: 0, b: 0, bc: 0, c: 0, d: 0, f: 0 };
  return {
    a: grades.aCount / totalCount,
    ab: grades.abCount / totalCount,
    b: grades.bCount / totalCount,
    bc: grades.bcCount / totalCount,
    c: grades.cCount / totalCount,
    d: grades.dCount / totalCount,
    f: grades.fCount / totalCount,
  };
}

export function findMedianGrade(gradeData: GradeCounts): string | null {
  const allGrades: string[] = [];
  const gradeOrder: (keyof GradeCounts)[] = [
    "fCount", "dCount", "cCount", "bcCount", "bCount", "abCount", "aCount",
  ];
  const gradeLabels: Record<string, string> = {
    fCount: "F", dCount: "D", cCount: "C", bcCount: "BC", bCount: "B", abCount: "AB", aCount: "A",
  };

  for (const key of gradeOrder) {
    const count = gradeData[key] || 0;
    for (let i = 0; i < count; i++) allGrades.push(gradeLabels[key]);
  }

  if (allGrades.length === 0) return null;
  return allGrades[Math.floor(allGrades.length / 2)];
}

// ── API fetching ────────────────────────────────────────────────────

async function fetchAllCourseUuids(): Promise<MadgradesCourse[]> {
  const allCourses: MadgradesCourse[] = [];
  let hasNext = true;
  let page = 1;

  while (hasNext) {
    console.log(`[madgrades] Fetching course page ${page}...`);
    const resp = await fetch(`https://api.madgrades.com/v1/courses?page=${page}&per_page=500`, {
      headers: { Authorization: `Token token=${API_TOKEN}`, Accept: "application/json" },
    });
    const json = (await resp.json()) as { results: MadgradesCourse[]; nextPageUrl: string | null };
    allCourses.push(...json.results);
    hasNext = json.nextPageUrl !== null;
    page++;
  }

  console.log(`[madgrades] Total courses: ${allCourses.length}`);
  return allCourses;
}

async function fetchGrades(uuid: string): Promise<GradesResponse | null> {
  try {
    const resp = await fetch(`https://api.madgrades.com/v1/courses/${uuid}/grades`, {
      headers: { Authorization: `Token token=${API_TOKEN}`, Accept: "application/json" },
    });
    if (!resp.ok) return null;
    return (await resp.json()) as GradesResponse;
  } catch {
    return null;
  }
}

// ── Concurrency-limited fetch ──────────────────────────────────────

const CONCURRENCY = 200;

async function fetchAllGrades(
  courses: MadgradesCourse[]
): Promise<Map<string, GradesResponse | null>> {
  const results = new Map<string, GradesResponse | null>();
  let completed = 0;
  let idx = 0;
  const lastLog = { count: 0 };

  return new Promise((resolve, reject) => {
    function launch() {
      while (idx < courses.length && activeCount() < CONCURRENCY) {
        const course = courses[idx++];
        fetchGrades(course.uuid)
          .then((res) => {
            results.set(course.uuid, res);
            completed++;
            if (completed - lastLog.count >= 500 || completed === courses.length) {
              console.log(`[madgrades] Fetched grades: ${completed}/${courses.length}`);
              lastLog.count = completed;
            }
            launch();
          })
          .catch(reject);
      }
      if (completed === courses.length) resolve(results);
    }

    function activeCount() {
      return idx - completed;
    }

    launch();
  });
}

// ── Main entry point ────────────────────────────────────────────────

export async function extractMadgrades(): Promise<void> {
  const startTime = Date.now();
  console.log("[madgrades] Starting extraction...");

  if (!API_TOKEN) {
    console.log("[madgrades] No MADGRADES_API_TOKEN set, fetching fresh token via GitHub OAuth...");
    API_TOKEN = await getMadgradesToken();
  }

  const courses = await fetchAllCourseUuids();

  console.log(`[madgrades] Fetching grades for ${courses.length} courses (concurrency: ${CONCURRENCY})...`);
  const gradeMap = await fetchAllGrades(courses);

  const allParsed: ParsedGrade[] = [];

  for (const course of courses) {
    const grades = gradeMap.get(course.uuid);
    if (!grades?.cumulative) continue;

    const pct = getGradePercentages(grades.cumulative);
    const cumulativeGpa = calculateGrade(grades.cumulative);
    const mostRecentGpa =
      grades.courseOfferings?.length ? calculateGrade(grades.courseOfferings[0].cumulative) : null;
    const median = findMedianGrade(grades.cumulative);

    for (const subject of course.subjects) {
      allParsed.push({
        courseName: `${subject.abbreviation} ${course.number}`,
        courseUuid: grades.courseUuid,
        medianGrade: median,
        aPercentage: pct.a,
        abPercentage: pct.ab,
        bPercentage: pct.b,
        bcPercentage: pct.bc,
        cPercentage: pct.c,
        dPercentage: pct.d,
        fPercentage: pct.f,
        cumulativeGpa,
        mostRecentGpa,
      });
    }
  }

  if (allParsed.length === 0) {
    console.error("[madgrades] Aborting: 0 grade records — refusing to generate empty dump that would wipe the database");
    process.exit(1);
  }

  console.log(`[madgrades] Generating SQL dump for ${allParsed.length} grade records...`);

  const { SqlWriter, esc } = await import("../utils/sql-writer.js");
  const sql = new SqlWriter();

  sql.comment("Madgrades Course Grades Dump");
  sql.comment(`Generated ${new Date().toISOString()}`);
  sql.comment(`${allParsed.length} grade records`);
  sql.blank();

  sql.comment("Teardown — only madgrades table");
  sql.raw("TRUNCATE madgrades_course_grades CASCADE;");
  sql.blank();

  const columns = [
    "course_name", "course_uuid", "median_grade",
    "a_percentage", "ab_percentage", "b_percentage", "bc_percentage",
    "c_percentage", "d_percentage", "f_percentage",
    "cumulative_gpa", "most_recent_gpa",
  ];
  sql.insertBatch(
    "madgrades_course_grades",
    columns,
    allParsed.map((g) => [
      esc(g.courseName), esc(g.courseUuid), esc(g.medianGrade),
      esc(g.aPercentage), esc(g.abPercentage), esc(g.bPercentage), esc(g.bcPercentage),
      esc(g.cPercentage), esc(g.dPercentage), esc(g.fPercentage),
      esc(g.cumulativeGpa), esc(g.mostRecentGpa),
    ])
  );

  const filePath = await sql.writeTo("madgrades.sql");
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[madgrades] Done: ${allParsed.length} records written to ${filePath} in ${elapsed}s`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  extractMadgrades().catch((err) => {
    console.error("Madgrades extraction failed:", err);
    process.exit(1);
  });
}
