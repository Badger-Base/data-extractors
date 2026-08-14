import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateGrade,
    getGradesPercentages,
    findMedianGrade,
    transformGrades,
    parseGrades,
} from '../src/extractors/madgrades_extractor.js';

// ─── calculateGrade ─────────────────────────────────────────────────

describe('calculateGrade', () => {
    it('calculates GPA for all A grades', () => {
        const grades = { aCount: 100, abCount: 0, bCount: 0, bcCount: 0, cCount: 0, dCount: 0, fCount: 0 };
        assert.equal(calculateGrade(grades), 4.0);
    });

    it('calculates GPA for mixed grades', () => {
        const grades = { aCount: 50, abCount: 20, bCount: 15, bcCount: 5, cCount: 5, dCount: 3, fCount: 2 };
        const gpa = calculateGrade(grades);
        assert.ok(gpa > 3.0 && gpa < 4.0, `Expected GPA between 3.0 and 4.0, got ${gpa}`);
    });

    it('calculates GPA for all F grades', () => {
        const grades = { aCount: 0, abCount: 0, bCount: 0, bcCount: 0, cCount: 0, dCount: 0, fCount: 100 };
        assert.equal(calculateGrade(grades), 0);
    });

    it('handles single student', () => {
        const grades = { aCount: 0, abCount: 0, bCount: 1, bcCount: 0, cCount: 0, dCount: 0, fCount: 0 };
        assert.equal(calculateGrade(grades), 3.0);
    });

    it('weighs AB as 3.5', () => {
        const grades = { aCount: 0, abCount: 1, bCount: 0, bcCount: 0, cCount: 0, dCount: 0, fCount: 0 };
        assert.equal(calculateGrade(grades), 3.5);
    });

    it('weighs BC as 2.5', () => {
        const grades = { aCount: 0, abCount: 0, bCount: 0, bcCount: 1, cCount: 0, dCount: 0, fCount: 0 };
        assert.equal(calculateGrade(grades), 2.5);
    });
});

// ─── getGradesPercentages ───────────────────────────────────────────

describe('getGradesPercentages', () => {
    it('returns zeros when all counts are zero', () => {
        const grades = { aCount: 0, abCount: 0, bCount: 0, bcCount: 0, cCount: 0, dCount: 0, fCount: 0 };
        const result = getGradesPercentages(grades);
        assert.deepEqual(result, { a: 0, ab: 0, b: 0, bc: 0, c: 0, d: 0, f: 0 });
    });

    it('returns 100% for single grade type', () => {
        const grades = { aCount: 50, abCount: 0, bCount: 0, bcCount: 0, cCount: 0, dCount: 0, fCount: 0 };
        const result = getGradesPercentages(grades);
        assert.equal(result.a, 1.0);
        assert.equal(result.b, 0);
    });

    it('calculates correct percentages for even split', () => {
        const grades = { aCount: 10, abCount: 10, bCount: 10, bcCount: 10, cCount: 10, dCount: 10, fCount: 10 };
        const result = getGradesPercentages(grades);
        const expected = 10 / 70;
        assert.ok(Math.abs(result.a - expected) < 0.001);
        assert.ok(Math.abs(result.f - expected) < 0.001);
    });

    it('percentages sum to 1.0', () => {
        const grades = { aCount: 30, abCount: 20, bCount: 15, bcCount: 10, cCount: 10, dCount: 10, fCount: 5 };
        const result = getGradesPercentages(grades);
        const sum = result.a + result.ab + result.b + result.bc + result.c + result.d + result.f;
        assert.ok(Math.abs(sum - 1.0) < 0.0001, `Percentages sum to ${sum}, expected 1.0`);
    });
});

// ─── findMedianGrade ────────────────────────────────────────────────

describe('findMedianGrade', () => {
    it('finds median for skewed-A distribution', () => {
        const grades = { aCount: 80, abCount: 10, bCount: 5, bcCount: 3, cCount: 1, dCount: 1, fCount: 0 };
        assert.equal(findMedianGrade(grades), 'A');
    });

    it('finds median for skewed-C distribution', () => {
        const grades = { aCount: 5, abCount: 5, bCount: 10, bcCount: 10, cCount: 50, dCount: 15, fCount: 5 };
        assert.equal(findMedianGrade(grades), 'C');
    });

    it('finds median for single grade', () => {
        const grades = { aCount: 0, abCount: 0, bCount: 1, bcCount: 0, cCount: 0, dCount: 0, fCount: 0 };
        assert.equal(findMedianGrade(grades), 'B');
    });

    it('returns undefined for empty grades', () => {
        const grades = { aCount: 0, abCount: 0, bCount: 0, bcCount: 0, cCount: 0, dCount: 0, fCount: 0 };
        assert.equal(findMedianGrade(grades), undefined);
    });

    it('handles even number of grades', () => {
        const grades = { aCount: 1, abCount: 0, bCount: 0, bcCount: 0, cCount: 0, dCount: 0, fCount: 1 };
        const result = findMedianGrade(grades);
        assert.ok(result === 'A' || result === 'F', `Expected A or F, got ${result}`);
    });
});

// ─── transformGrades ────────────────────────────────────────────────

describe('transformGrades', () => {
    it('transforms grade data with cumulative and most recent', () => {
        const input = {
            courseUuid: 'test-uuid-123',
            cumulative: { aCount: 50, abCount: 20, bCount: 15, bcCount: 5, cCount: 5, dCount: 3, fCount: 2 },
            courseOfferings: [
                { cumulative: { aCount: 30, abCount: 10, bCount: 5, bcCount: 2, cCount: 2, dCount: 1, fCount: 0 } }
            ],
        };
        const result = transformGrades(input);

        assert.equal(result.uuid, 'test-uuid-123');
        assert.ok(parseFloat(result.cumulative) > 0);
        assert.ok(parseFloat(result.mostRecent) > 0);
        assert.ok(result.aPercentage > 0);
        assert.equal(result.median, 'A');
    });

    it('handles missing courseOfferings', () => {
        const input = {
            courseUuid: 'uuid-no-recent',
            cumulative: { aCount: 10, abCount: 10, bCount: 10, bcCount: 10, cCount: 10, dCount: 10, fCount: 10 },
        };
        const result = transformGrades(input);

        assert.equal(result.mostRecent, null);
    });

    it('handles empty courseOfferings array', () => {
        const input = {
            courseUuid: 'uuid-empty-offerings',
            cumulative: { aCount: 10, abCount: 0, bCount: 0, bcCount: 0, cCount: 0, dCount: 0, fCount: 0 },
            courseOfferings: [],
        };
        const result = transformGrades(input);

        assert.equal(result.mostRecent, null);
    });
});

// ─── parseGrades ────────────────────────────────────────────────────

describe('parseGrades', () => {
    it('expands grades across multiple abbreviations', async () => {
        const input = [
            {
                uuid: 'uuid-1',
                number: '101',
                abbreviations: ['COMP SCI', 'E C E'],
                grades: { cumulative: 3.5 },
            },
        ];
        const result = await parseGrades(input);

        assert.equal(result.length, 2);
        assert.equal(result[0].name, 'COMP SCI 101');
        assert.equal(result[1].name, 'E C E 101');
    });

    it('handles single abbreviation', async () => {
        const input = [
            {
                uuid: 'uuid-2',
                number: '200',
                abbreviations: ['MATH'],
                grades: { cumulative: 3.0 },
            },
        ];
        const result = await parseGrades(input);

        assert.equal(result.length, 1);
        assert.equal(result[0].name, 'MATH 200');
    });

    it('handles empty input', async () => {
        const result = await parseGrades([]);
        assert.equal(result.length, 0);
    });
});
