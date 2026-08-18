import { withTransaction } from "../db.js";
import config from "../config.js";
import type pg from "pg";

const API_TOKEN = config.apis.madgrades.token;
const BATCH_SIZE = config.apis.madgrades.batchSize;

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

// ── Main entry point ────────────────────────────────────────────────

export async function extractAndLoadMadgrades(): Promise<void> {
  const startTime = Date.now();
  console.log("[madgrades] Starting extraction...");

  const courses = await fetchAllCourseUuids();

  const allParsed: ParsedGrade[] = [];

  for (let i = 0; i < courses.length; i += BATCH_SIZE) {
    const batch = courses.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(courses.length / BATCH_SIZE);
    console.log(`[madgrades] Processing grades batch ${batchNum}/${totalBatches}...`);

    const results = await Promise.all(batch.map((c) => fetchGrades(c.uuid)));

    for (let j = 0; j < batch.length; j++) {
      const course = batch[j];
      const grades = results[j];
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

    if (i + BATCH_SIZE < courses.length) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  console.log(`[madgrades] Inserting ${allParsed.length} grade records...`);

  await withTransaction(async (client: pg.PoolClient) => {
    for (const g of allParsed) {
      await client.query(
        `INSERT INTO madgrades_course_grades (
           course_name, course_uuid, median_grade,
           a_percentage, ab_percentage, b_percentage, bc_percentage,
           c_percentage, d_percentage, f_percentage,
           cumulative_gpa, most_recent_gpa
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          g.courseName,
          g.courseUuid,
          g.medianGrade,
          g.aPercentage,
          g.abPercentage,
          g.bPercentage,
          g.bcPercentage,
          g.cPercentage,
          g.dPercentage,
          g.fPercentage,
          g.cumulativeGpa,
          g.mostRecentGpa,
        ]
      );
    }
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[madgrades] Done: ${allParsed.length} records in ${elapsed}s`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  extractAndLoadMadgrades().catch((err) => {
    console.error("Madgrades extraction failed:", err);
    process.exit(1);
  });
}
