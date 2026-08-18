import * as fuzzball from "fuzzball";
import { query, withTransaction } from "../db.js";
import config from "../config.js";
import type pg from "pg";

const HEADERS = config.apis.rateMyProfessor.headers;
const SCHOOL_ID = config.apis.rateMyProfessor.schoolId;

// ── Types ───────────────────────────────────────────────────────────

interface TeacherNode {
  id: string;
  legacyId: number;
  firstName: string;
  lastName: string;
  department: string;
  avgRating: number;
  numRatings: number;
  avgDifficulty: number;
  wouldTakeAgainPercent: number;
}

interface TeacherEdge {
  cursor: string;
  node: TeacherNode;
}

interface RmpResponse {
  data: {
    search: {
      teachers: {
        edges: TeacherEdge[];
        pageInfo: { hasNextPage: boolean; endCursor: string };
        resultCount: number;
      };
    };
  };
  errors?: unknown[];
}

interface ResolvedTeacher {
  fullName: string;
  avgRating: number;
  avgDifficulty: number;
  numRatings: number;
  wouldTakeAgainPercent: number | null;
  legacyId: string;
}

// ── GraphQL query ───────────────────────────────────────────────────

const TEACHER_QUERY = `query TeacherSearchResultsPageQuery(
  $query: TeacherSearchQuery!
  $schoolID: ID
  $includeSchoolFilter: Boolean!
  $after: String
) {
  search: newSearch {
    ...TeacherSearchPagination_search_1ZLmLD
  }
  school: node(id: $schoolID) @include(if: $includeSchoolFilter) {
    __typename
    ... on School { name }
    id
  }
}

fragment TeacherSearchPagination_search_1ZLmLD on newSearch {
  teachers(query: $query, first: 1000, after: $after) {
    didFallback
    edges {
      cursor
      node {
        ...TeacherCard_teacher
        id
        __typename
      }
    }
    pageInfo { hasNextPage endCursor }
    resultCount
    filters { field options { value id } }
  }
}

fragment TeacherCard_teacher on Teacher {
  id
  legacyId
  avgRating
  numRatings
  ...CardFeedback_teacher
  ...CardSchool_teacher
  ...CardName_teacher
  ...TeacherBookmark_teacher
}

fragment CardFeedback_teacher on Teacher { wouldTakeAgainPercent avgDifficulty }
fragment CardSchool_teacher on Teacher { department school { name id } }
fragment CardName_teacher on Teacher { firstName lastName }
fragment TeacherBookmark_teacher on Teacher { id isSaved }`;

// ── Name cleaning (from rmp_preprocessor.py) ───────────────────────

function cleanName(name: string | null | undefined): string {
  if (!name) return "";
  let cleaned = name.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(/\s*\([^)]+\)\s*/g, " ");
  cleaned = cleaned.replace(
    /^(Dr\.?|Professor|Prof\.?|Mr\.?|Ms\.?|Mrs\.?)\s+/i,
    ""
  );
  cleaned = cleaned.replace(/[.,]+$/, "");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned;
}

function createNameVariations(name: string): string[] {
  const cleaned = cleanName(name);
  if (!cleaned) return [];

  const variations = new Set<string>();
  variations.add(cleaned);

  const parts = cleaned.split(" ");
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];

    variations.add(`${first} ${last}`);
    variations.add(`${last}, ${first}`);

    if (parts.length > 2) {
      const middles = parts.slice(1, -1);
      variations.add(`${first} ${middles.join(" ")} ${last}`);
      const initials = middles.map((p) => (p ? p[0] + "." : "")).join(" ");
      variations.add(`${first} ${initials} ${last}`);
    }
  }

  return [...variations];
}

// ── API fetching ────────────────────────────────────────────────────

async function fetchAllTeachers(): Promise<TeacherEdge[]> {
  const allTeachers: TeacherEdge[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  let pageCount = 0;

  while (hasNextPage) {
    pageCount++;
    console.log(`[rmp] Fetching page ${pageCount}...`);

    const resp = await fetch("https://www.ratemyprofessors.com/graphql", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        query: TEACHER_QUERY,
        variables: {
          query: { text: "", schoolID: SCHOOL_ID, fallback: true, departmentID: null },
          schoolID: SCHOOL_ID,
          includeSchoolFilter: true,
          after: cursor,
        },
      }),
    });

    if (!resp.ok) throw new Error(`RMP HTTP ${resp.status}`);
    const data = (await resp.json()) as RmpResponse;

    if (data.errors) {
      console.error("[rmp] GraphQL errors:", data.errors);
      break;
    }

    const teachers = data.data.search.teachers;
    if (!teachers?.edges) break;

    console.log(`[rmp] Found ${teachers.edges.length} teachers on page ${pageCount}`);
    allTeachers.push(...teachers.edges);

    hasNextPage = teachers.pageInfo.hasNextPage;
    cursor = teachers.pageInfo.endCursor;

    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`[rmp] Total teachers: ${allTeachers.length}`);
  return allTeachers;
}

// ── Fuzzy matching (in-memory, against section_instructors) ─────────

function resolveNames(
  teachers: TeacherEdge[],
  courseInstructors: string[]
): ResolvedTeacher[] {
  const instructorSet = new Set(courseInstructors.map((n) => cleanName(n)));
  const instructorList = [...instructorSet].filter(Boolean);
  const resolved: ResolvedTeacher[] = [];

  console.log(
    `[rmp] Fuzzy matching ${teachers.length} RMP records against ${instructorList.length} instructor names...`
  );

  let exact = 0;
  let fuzzy = 0;
  let unmatched = 0;

  for (const edge of teachers) {
    const t = edge.node;
    const rmpName = `${t.firstName} ${t.lastName}`.trim();
    if (!rmpName) continue;

    const variations = createNameVariations(rmpName);
    let bestMatch = rmpName;
    let bestScore = 0;

    for (const variation of variations) {
      if (!variation) continue;

      if (instructorSet.has(variation)) {
        bestMatch = variation;
        bestScore = 100;
        break;
      }

      const result = fuzzball.extract(variation, instructorList, {
        scorer: fuzzball.token_sort_ratio,
        cutoff: 80,
        limit: 1,
      });

      if (result.length > 0 && result[0][1] > bestScore) {
        bestMatch = result[0][0] as string;
        bestScore = result[0][1];
        if (bestScore >= 95) break;
      }
    }

    if (bestScore >= 80) {
      if (bestScore === 100) exact++;
      else fuzzy++;
    } else {
      unmatched++;
      bestMatch = rmpName;
    }

    resolved.push({
      fullName: bestMatch,
      avgRating: t.avgRating,
      avgDifficulty: t.avgDifficulty,
      numRatings: t.numRatings,
      wouldTakeAgainPercent: t.wouldTakeAgainPercent === -1 ? null : t.wouldTakeAgainPercent,
      legacyId: String(t.legacyId),
    });
  }

  console.log(`[rmp] Match results: ${exact} exact, ${fuzzy} fuzzy, ${unmatched} unmatched`);
  return resolved;
}

// ── Main entry point ────────────────────────────────────────────────

export async function extractAndLoadRmp(): Promise<void> {
  const startTime = Date.now();
  console.log("[rmp] Starting extraction...");

  // 1. Scrape all RMP teachers into memory
  const teachers = await fetchAllTeachers();

  // 2. Load instructor names from section_instructors (already populated by course extractor)
  const instructorResult = await query<{ instructor_name: string }>(
    "SELECT DISTINCT instructor_name FROM section_instructors WHERE instructor_name IS NOT NULL AND instructor_name != ''"
  );
  const courseInstructors = instructorResult.rows.map((r) => r.instructor_name);
  console.log(`[rmp] Loaded ${courseInstructors.length} unique instructor names from DB`);

  // 3. Fuzzy match in memory — resolve RMP names to instructor names
  const resolved = resolveNames(teachers, courseInstructors);

  // 4. Insert everything in one transaction — names are already matched
  console.log(`[rmp] Inserting ${resolved.length} matched records...`);

  await withTransaction(async (client: pg.PoolClient) => {
    for (const t of resolved) {
      await client.query(
        `INSERT INTO rmp_cleaned (
           full_name, avg_rating, avg_difficulty, num_ratings,
           would_take_again_percent, legacy_id
         ) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (full_name) DO UPDATE SET
           avg_rating = EXCLUDED.avg_rating,
           avg_difficulty = EXCLUDED.avg_difficulty,
           num_ratings = EXCLUDED.num_ratings,
           would_take_again_percent = EXCLUDED.would_take_again_percent,
           legacy_id = EXCLUDED.legacy_id`,
        [
          t.fullName,
          t.avgRating,
          t.avgDifficulty,
          t.numRatings,
          t.wouldTakeAgainPercent,
          t.legacyId,
        ]
      );
    }
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[rmp] Done: ${resolved.length} records in ${elapsed}s`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  extractAndLoadRmp().catch((err) => {
    console.error("RMP extraction failed:", err);
    process.exit(1);
  });
}
