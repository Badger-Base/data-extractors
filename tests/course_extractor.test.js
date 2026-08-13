import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    getSmallestEnrollmentData,
    formatSectionData,
} from '../src/extractors/course_search_and_enroll_extractor.js';

// ─── getSmallestEnrollmentData ──────────────────────────────────────

describe('getSmallestEnrollmentData', () => {
    it('returns null for null input', () => {
        assert.equal(getSmallestEnrollmentData(null), null);
    });

    it('returns null for empty array', () => {
        assert.equal(getSmallestEnrollmentData([]), null);
    });

    it('returns null when no sections have enrollment data', () => {
        const sections = [{ type: 'LEC' }, { type: 'DIS' }];
        assert.equal(getSmallestEnrollmentData(sections), null);
    });

    it('returns null when capacity is 0', () => {
        const sections = [
            { enrollmentStatus: { capacity: 0, currentlyEnrolled: 0 } },
        ];
        assert.equal(getSmallestEnrollmentData(sections), null);
    });

    it('returns the only section enrollment', () => {
        const sections = [
            { enrollmentStatus: { capacity: 30, currentlyEnrolled: 25 } },
        ];
        const result = getSmallestEnrollmentData(sections);
        assert.equal(result.capacity, 30);
        assert.equal(result.currentlyEnrolled, 25);
    });

    it('returns smallest capacity among multiple sections', () => {
        const sections = [
            { enrollmentStatus: { capacity: 200, currentlyEnrolled: 150 } },
            { enrollmentStatus: { capacity: 30, currentlyEnrolled: 28 } },
            { enrollmentStatus: { capacity: 100, currentlyEnrolled: 90 } },
        ];
        const result = getSmallestEnrollmentData(sections);
        assert.equal(result.capacity, 30);
    });

    it('skips sections without enrollment data', () => {
        const sections = [
            { type: 'LEC' },
            { enrollmentStatus: { capacity: 50, currentlyEnrolled: 40 } },
            { type: 'DIS' },
        ];
        const result = getSmallestEnrollmentData(sections);
        assert.equal(result.capacity, 50);
    });
});

// ─── formatSectionData ──────────────────────────────────────────────

describe('formatSectionData', () => {
    it('returns empty arrays for null input', () => {
        const result = formatSectionData(null, 'uuid-1', 'None');
        assert.deepEqual(result, []);
    });

    it('returns empty arrays for non-array input', () => {
        const result = formatSectionData('not-an-array', 'uuid-1', 'None');
        assert.deepEqual(result, []);
    });

    it('formats a basic section with instructor and meeting', () => {
        const courseSections = [
            {
                enrollmentClassNumber: '12345',
                courseId: 'CS101',
                subjectCode: 'COMP',
                catalogNumber: '101',
                sections: [
                    {
                        type: 'LEC',
                        sectionNumber: '001',
                        instructors: [{ name: { first: 'Jane', last: 'Smith' } }],
                        instructionMode: 'In Person',
                        enrollmentStatus: { capacity: 30, currentlyEnrolled: 25 },
                        classMeetings: [
                            {
                                meetingType: 'CLASS',
                                meetingOrExamNumber: '1',
                                meetingDays: 'MWF',
                                meetingTimeStart: 54000000,
                                meetingTimeEnd: 57600000,
                                meetingDaysList: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
                                building: { buildingName: 'CS Building' },
                                room: '1240',
                            },
                        ],
                    },
                ],
                packageEnrollmentStatus: { status: 'OPEN', availableSeats: 5, waitlistTotal: 0 },
                isAsynchronous: false,
            },
        ];

        const result = formatSectionData(courseSections, 'uuid-1', 'None');
        const { sections, meetings } = result;

        assert.equal(sections.length, 1);
        assert.equal(sections[0].sectionId, '12345');
        assert.equal(sections[0].courseId, 'CS101');
        assert.equal(sections[0].status, 'OPEN');
        assert.equal(sections[0].availableSeats, 5);
        assert.deepEqual(sections[0].instructors, ['Jane Smith']);

        assert.equal(meetings.length, 1);
        assert.equal(meetings[0].meetingDays, 'MWF');
        assert.equal(meetings[0].buildingName, 'CS Building');
        assert.ok(meetings[0].mondayMeetingStart !== null);
        assert.ok(meetings[0].wednesdayMeetingStart !== null);
        assert.ok(meetings[0].fridayMeetingStart !== null);
        assert.equal(meetings[0].tuesdayMeetingStart, null);
        assert.equal(meetings[0].thursdayMeetingStart, null);
    });

    it('handles section with no instructors', () => {
        const courseSections = [
            {
                enrollmentClassNumber: '99999',
                courseId: 'MATH200',
                subjectCode: 'MATH',
                catalogNumber: '200',
                sections: [
                    {
                        type: 'LEC',
                        sectionNumber: '001',
                        instructionMode: 'Online',
                        enrollmentStatus: { capacity: 100, currentlyEnrolled: 80 },
                        classMeetings: [],
                    },
                ],
                packageEnrollmentStatus: { status: 'OPEN', availableSeats: 20, waitlistTotal: 0 },
                isAsynchronous: true,
            },
        ];

        const result = formatSectionData(courseSections, 'uuid-2', 'None');
        const { sections } = result;

        assert.equal(sections.length, 1);
        assert.deepEqual(sections[0].instructors, []);
        assert.equal(sections[0].isAsynchronous, true);
    });

    it('excludes section requisites that match course prerequisites', () => {
        const courseSections = [
            {
                enrollmentClassNumber: '55555',
                courseId: 'PHYS201',
                subjectCode: 'PHYS',
                catalogNumber: '201',
                sections: [
                    {
                        type: 'LEC',
                        sectionNumber: '001',
                        instructors: [],
                        instructionMode: 'In Person',
                        enrollmentStatus: { capacity: 50, currentlyEnrolled: 45 },
                        classMeetings: [],
                    },
                ],
                packageEnrollmentStatus: { status: 'OPEN', availableSeats: 5, waitlistTotal: 0 },
                enrollmentRequirementGroups: {
                    catalogRequirementGroups: [
                        { description: 'Sophomore standing' },
                    ],
                },
            },
        ];

        const result = formatSectionData(courseSections, 'uuid-3', 'Sophomore standing');
        const { sections } = result;

        assert.equal(sections[0].sectionRequisites, null);
    });

    it('includes section-specific requisites', () => {
        const courseSections = [
            {
                enrollmentClassNumber: '77777',
                courseId: 'BIO300',
                subjectCode: 'BIO',
                catalogNumber: '300',
                sections: [
                    {
                        type: 'LEC',
                        sectionNumber: '001',
                        instructors: [],
                        instructionMode: 'In Person',
                        enrollmentStatus: { capacity: 40, currentlyEnrolled: 35 },
                        classMeetings: [],
                    },
                ],
                packageEnrollmentStatus: { status: 'WAITLISTED', availableSeats: 0, waitlistTotal: 3 },
                enrollmentRequirementGroups: {
                    classAssociationRequirementGroups: [
                        { description: 'Must be enrolled in Biology major' },
                    ],
                },
            },
        ];

        const result = formatSectionData(courseSections, 'uuid-4', 'None');
        const { sections } = result;

        assert.equal(sections[0].sectionRequisites, 'Must be enrolled in Biology major');
    });
});
