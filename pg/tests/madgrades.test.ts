import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateGrade,
  getGradePercentages,
  findMedianGrade,
  type GradeCounts,
} from "../src/extractors/madgrades.js";

// ─── calculateGrade ────────────────────────────────────────────────

describe("calculateGrade", () => {
  it("calculates GPA for all A grades", () => {
    const grades: GradeCounts = {
      aCount: 100,
      abCount: 0,
      bCount: 0,
      bcCount: 0,
      cCount: 0,
      dCount: 0,
      fCount: 0,
    };
    assert.equal(calculateGrade(grades), 4.0);
  });

  it("calculates GPA for mixed grades", () => {
    const grades: GradeCounts = {
      aCount: 50,
      abCount: 20,
      bCount: 15,
      bcCount: 5,
      cCount: 5,
      dCount: 3,
      fCount: 2,
    };
    const gpa = calculateGrade(grades);
    assert.ok(
      gpa > 3.0 && gpa < 4.0,
      `Expected GPA between 3.0 and 4.0, got ${gpa}`
    );
  });

  it("calculates GPA for all F grades", () => {
    const grades: GradeCounts = {
      aCount: 0,
      abCount: 0,
      bCount: 0,
      bcCount: 0,
      cCount: 0,
      dCount: 0,
      fCount: 100,
    };
    assert.equal(calculateGrade(grades), 0);
  });

  it("handles single student", () => {
    const grades: GradeCounts = {
      aCount: 0,
      abCount: 0,
      bCount: 1,
      bcCount: 0,
      cCount: 0,
      dCount: 0,
      fCount: 0,
    };
    assert.equal(calculateGrade(grades), 3.0);
  });

  it("weighs AB as 3.5", () => {
    const grades: GradeCounts = {
      aCount: 0,
      abCount: 1,
      bCount: 0,
      bcCount: 0,
      cCount: 0,
      dCount: 0,
      fCount: 0,
    };
    assert.equal(calculateGrade(grades), 3.5);
  });

  it("weighs BC as 2.5", () => {
    const grades: GradeCounts = {
      aCount: 0,
      abCount: 0,
      bCount: 0,
      bcCount: 1,
      cCount: 0,
      dCount: 0,
      fCount: 0,
    };
    assert.equal(calculateGrade(grades), 2.5);
  });

  it("returns 0 for all-zero counts", () => {
    const grades: GradeCounts = {
      aCount: 0,
      abCount: 0,
      bCount: 0,
      bcCount: 0,
      cCount: 0,
      dCount: 0,
      fCount: 0,
    };
    assert.equal(calculateGrade(grades), 0);
  });
});

// ─── getGradePercentages ──────────────────────────────────────────

describe("getGradePercentages", () => {
  it("returns zeros when all counts are zero", () => {
    const grades: GradeCounts = {
      aCount: 0,
      abCount: 0,
      bCount: 0,
      bcCount: 0,
      cCount: 0,
      dCount: 0,
      fCount: 0,
    };
    const result = getGradePercentages(grades);
    assert.deepEqual(result, { a: 0, ab: 0, b: 0, bc: 0, c: 0, d: 0, f: 0 });
  });

  it("returns 100% for single grade type", () => {
    const grades: GradeCounts = {
      aCount: 50,
      abCount: 0,
      bCount: 0,
      bcCount: 0,
      cCount: 0,
      dCount: 0,
      fCount: 0,
    };
    const result = getGradePercentages(grades);
    assert.equal(result.a, 1.0);
    assert.equal(result.b, 0);
  });

  it("calculates correct percentages for even split", () => {
    const grades: GradeCounts = {
      aCount: 10,
      abCount: 10,
      bCount: 10,
      bcCount: 10,
      cCount: 10,
      dCount: 10,
      fCount: 10,
    };
    const result = getGradePercentages(grades);
    const expected = 10 / 70;
    assert.ok(Math.abs(result.a - expected) < 0.001);
    assert.ok(Math.abs(result.f - expected) < 0.001);
  });

  it("percentages sum to 1.0", () => {
    const grades: GradeCounts = {
      aCount: 30,
      abCount: 20,
      bCount: 15,
      bcCount: 10,
      cCount: 10,
      dCount: 10,
      fCount: 5,
    };
    const result = getGradePercentages(grades);
    const sum =
      result.a +
      result.ab +
      result.b +
      result.bc +
      result.c +
      result.d +
      result.f;
    assert.ok(
      Math.abs(sum - 1.0) < 0.0001,
      `Percentages sum to ${sum}, expected 1.0`
    );
  });
});

// ─── findMedianGrade ──────────────────────────────────────────────

describe("findMedianGrade", () => {
  it("finds median for skewed-A distribution", () => {
    const grades: GradeCounts = {
      aCount: 80,
      abCount: 10,
      bCount: 5,
      bcCount: 3,
      cCount: 1,
      dCount: 1,
      fCount: 0,
    };
    assert.equal(findMedianGrade(grades), "A");
  });

  it("finds median for skewed-C distribution", () => {
    const grades: GradeCounts = {
      aCount: 5,
      abCount: 5,
      bCount: 10,
      bcCount: 10,
      cCount: 50,
      dCount: 15,
      fCount: 5,
    };
    assert.equal(findMedianGrade(grades), "C");
  });

  it("finds median for single grade", () => {
    const grades: GradeCounts = {
      aCount: 0,
      abCount: 0,
      bCount: 1,
      bcCount: 0,
      cCount: 0,
      dCount: 0,
      fCount: 0,
    };
    assert.equal(findMedianGrade(grades), "B");
  });

  it("returns null for empty grades", () => {
    const grades: GradeCounts = {
      aCount: 0,
      abCount: 0,
      bCount: 0,
      bcCount: 0,
      cCount: 0,
      dCount: 0,
      fCount: 0,
    };
    assert.equal(findMedianGrade(grades), null);
  });

  it("handles even number of grades", () => {
    const grades: GradeCounts = {
      aCount: 1,
      abCount: 0,
      bCount: 0,
      bcCount: 0,
      cCount: 0,
      dCount: 0,
      fCount: 1,
    };
    const result = findMedianGrade(grades);
    assert.ok(
      result === "A" || result === "F",
      `Expected A or F, got ${result}`
    );
  });
});
