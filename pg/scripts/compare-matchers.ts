import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";
import * as fuzzball from "fuzzball";

const CSV_DIR = path.resolve(import.meta.dirname, "../../data/csv");
const TEACHERS_CSV = path.join(CSV_DIR, "madison_teachers_2025-07-23.csv");
const SECTIONS_CSV = path.join(CSV_DIR, "uw_madison_sections.csv");

// ── CSV parsing (minimal, no deps) ─────────────────────────────────

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = values[i] ?? ""));
    return row;
  });
}

// ── Name cleaning (same logic as both matchers) ────────────────────

function cleanName(name: string): string {
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

// ── TS matcher (fuzzball) ──────────────────────────────────────────

interface MatchResult {
  rmpName: string;
  matchedName: string;
  score: number;
}

function tsMatch(rmpNames: string[], instructorNames: string[]): MatchResult[] {
  const instructorSet = new Set(instructorNames.map((n) => cleanName(n)));
  const instructorList = [...instructorSet].filter(Boolean);
  const results: MatchResult[] = [];

  for (const rmpName of rmpNames) {
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

    results.push({
      rmpName,
      matchedName: bestScore >= 80 ? bestMatch : rmpName,
      score: bestScore,
    });
  }

  return results;
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log("Loading CSV data...\n");

  const teachersRaw = await fs.readFile(TEACHERS_CSV, "utf-8");
  const sectionsRaw = await fs.readFile(SECTIONS_CSV, "utf-8");

  const teachers = parseCSV(teachersRaw);
  const sections = parseCSV(sectionsRaw);

  const rmpNames = teachers
    .map((t) => `${t.FirstName} ${t.LastName}`.trim())
    .filter(Boolean);

  const instructorNames = [
    ...new Set(
      sections
        .flatMap((s) => (s.instructors || "").split(",").map((n: string) => n.trim()))
        .filter(Boolean)
    ),
  ];

  console.log(`RMP teachers:    ${rmpNames.length}`);
  console.log(`Instructor names: ${instructorNames.length}\n`);

  // ── Run TS matcher ───────────────────────────────────────────────
  console.log("Running TypeScript matcher (fuzzball)...");
  const tsStart = Date.now();
  const tsResults = tsMatch(rmpNames, instructorNames);
  const tsMs = Date.now() - tsStart;
  console.log(`  Done in ${(tsMs / 1000).toFixed(1)}s\n`);

  // ── Run Python matcher ───────────────────────────────────────────
  console.log("Running Python matcher (fuzzywuzzy)...");
  const inputFile = path.join(import.meta.dirname, "_compare_input.json");
  await fs.writeFile(inputFile, JSON.stringify({ rmpNames, instructorNames }));

  const pyStart = Date.now();
  const pyScript = path.join(import.meta.dirname, "python_matcher.py");
  let pyResults: MatchResult[];
  try {
    const venvPython = path.join(import.meta.dirname, ".venv/bin/python3");
    const pyOut = execSync(`"${venvPython}" "${pyScript}" "${inputFile}"`, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 600_000,
    });
    pyResults = JSON.parse(pyOut.toString());
  } catch (err) {
    console.error("  Python matcher failed. Is fuzzywuzzy installed?");
    console.error("  pip3 install fuzzywuzzy python-Levenshtein");
    await fs.unlink(inputFile).catch(() => {});
    process.exit(1);
  }
  const pyMs = Date.now() - pyStart;
  console.log(`  Done in ${(pyMs / 1000).toFixed(1)}s\n`);

  await fs.unlink(inputFile).catch(() => {});

  // ── Compare ──────────────────────────────────────────────────────
  const tsMatched = tsResults.filter((r) => r.score >= 80);
  const pyMatched = pyResults.filter((r) => r.score >= 80);
  const tsExact = tsResults.filter((r) => r.score === 100);
  const pyExact = pyResults.filter((r) => r.score === 100);
  const tsHigh = tsResults.filter((r) => r.score >= 90 && r.score < 100);
  const pyHigh = pyResults.filter((r) => r.score >= 90 && r.score < 100);
  const tsMedium = tsResults.filter((r) => r.score >= 80 && r.score < 90);
  const pyMedium = pyResults.filter((r) => r.score >= 80 && r.score < 90);

  console.log("═══════════════════════════════════════════════════");
  console.log("                COMPARISON RESULTS                ");
  console.log("═══════════════════════════════════════════════════\n");

  console.log(`${"Metric".padEnd(30)} ${"Python".padStart(8)} ${"TypeScript".padStart(10)}`);
  console.log("─".repeat(50));
  console.log(`${"Total RMP names".padEnd(30)} ${String(rmpNames.length).padStart(8)} ${String(rmpNames.length).padStart(10)}`);
  console.log(`${"Matched (>=80)".padEnd(30)} ${String(pyMatched.length).padStart(8)} ${String(tsMatched.length).padStart(10)}`);
  console.log(`${"Exact (100)".padEnd(30)} ${String(pyExact.length).padStart(8)} ${String(tsExact.length).padStart(10)}`);
  console.log(`${"High confidence (90-99)".padEnd(30)} ${String(pyHigh.length).padStart(8)} ${String(tsHigh.length).padStart(10)}`);
  console.log(`${"Medium confidence (80-89)".padEnd(30)} ${String(pyMedium.length).padStart(8)} ${String(tsMedium.length).padStart(10)}`);
  console.log(`${"Unmatched (<80)".padEnd(30)} ${String(rmpNames.length - pyMatched.length).padStart(8)} ${String(rmpNames.length - tsMatched.length).padStart(10)}`);
  console.log(`${"Runtime".padEnd(30)} ${(pyMs / 1000).toFixed(1).padStart(7)}s ${(tsMs / 1000).toFixed(1).padStart(9)}s`);

  // ── Find disagreements ───────────────────────────────────────────
  const disagreements: {
    rmpName: string;
    pyMatch: string;
    pyScore: number;
    tsMatch: string;
    tsScore: number;
  }[] = [];

  for (let i = 0; i < rmpNames.length; i++) {
    const py = pyResults[i];
    const ts = tsResults[i];
    if (py.matchedName !== ts.matchedName || Math.abs(py.score - ts.score) > 5) {
      disagreements.push({
        rmpName: rmpNames[i],
        pyMatch: py.matchedName,
        pyScore: py.score,
        tsMatch: ts.matchedName,
        tsScore: ts.score,
      });
    }
  }

  console.log(`\nDisagreements: ${disagreements.length} / ${rmpNames.length}`);

  if (disagreements.length > 0) {
    console.log(`\n${"RMP Name".padEnd(25)} ${"Py Match".padEnd(25)} ${"Py".padStart(3)} ${"TS Match".padEnd(25)} ${"TS".padStart(3)}`);
    console.log("─".repeat(85));
    const show = disagreements.slice(0, 50);
    for (const d of show) {
      console.log(
        `${d.rmpName.slice(0, 24).padEnd(25)} ${d.pyMatch.slice(0, 24).padEnd(25)} ${String(d.pyScore).padStart(3)} ${d.tsMatch.slice(0, 24).padEnd(25)} ${String(d.tsScore).padStart(3)}`
      );
    }
    if (disagreements.length > 50) {
      console.log(`\n  ... and ${disagreements.length - 50} more`);
    }
  }

  // ── TS-only and Python-only matches ──────────────────────────────
  const tsOnly: MatchResult[] = [];
  const pyOnly: MatchResult[] = [];
  for (let i = 0; i < rmpNames.length; i++) {
    const py = pyResults[i];
    const ts = tsResults[i];
    if (ts.score >= 80 && py.score < 80) tsOnly.push(ts);
    if (py.score >= 80 && ts.score < 80) pyOnly.push(py);
  }

  if (tsOnly.length > 0) {
    console.log(`\nTS matched but Python didn't (${tsOnly.length}):`);
    for (const r of tsOnly.slice(0, 20)) {
      console.log(`  ${r.rmpName} → ${r.matchedName} (${r.score})`);
    }
  }

  if (pyOnly.length > 0) {
    console.log(`\nPython matched but TS didn't (${pyOnly.length}):`);
    for (const r of pyOnly.slice(0, 20)) {
      console.log(`  ${r.rmpName} → ${r.matchedName} (${r.score})`);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
