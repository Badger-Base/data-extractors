import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import puppeteer from 'puppeteer';

dotenv.config();

// ====================================
// DEVELOPMENT CONFIGURATION
// ====================================
const DEV_CONFIG = {
    // Set to true for rapid testing - only fetches first few courses
    TEST_MODE: false,
    
    // Number of courses to fetch in test mode (1-10 recommended for quick testing)
    TEST_COURSE_LIMIT: 50,
    
    // Set to true to use mock data instead of API calls (instant testing)
    USE_MOCK_DATA: false,
    
    // Set to true to generate separate test database tables (prevents production conflicts)
    USE_TEST_TABLES: false,
    
    // Prefix for test tables (only used if USE_TEST_TABLES is true)
    TEST_TABLE_PREFIX: '',
    
    // Set to true to skip section fetching entirely (courses only)
    SKIP_SECTIONS: false,
    
    // Verbose logging for debugging
    VERBOSE_LOGGING: true

    
};

// Browser session will be initialized at runtime
let browserSession = null;
let browserPage = null;

// Base headers (without WAF token - token will be added via browser session)
const BASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    "Authorization": "Basic dGVzdDp0ZXN0",
    "Sec-GPC": "1",
    "Referer": "https://public.enroll.wisc.edu/search"
};

// Rate limiting configuration - reduced for dev mode
const RATE_LIMIT_DELAY = DEV_CONFIG.TEST_MODE ? 50 : 10; // milliseconds between requests
const BATCH_SIZE = DEV_CONFIG.TEST_MODE ? 3 : 100; // process in batches
const MAX_RETRIES = DEV_CONFIG.TEST_MODE ? 1 : 3;

// Mock data for instant testing
const MOCK_COURSE_DATA = [
    {
        courseId: "TEST001",
        subject: { subjectCode: "COMP" },
        courseDesignation: "SCI 101",
        fullCourseDesignation: "COMP SCI 101",
        minimumCredits: 3,
        maximumCredits: 3,
        title: "Introduction to Computer Science",
        description: "Basic programming concepts and problem solving.",
        enrollmentPrerequisites: "None",
        generalEd: { code: "QR" },
        ethnicStudies: null,
        lettersAndScienceCredits: { code: "Y" },
        breadths: [{ code: "P" }],
        levels: [{ code: "Elementary" }]
    },
    {
        courseId: "TEST002",
        subject: { subjectCode: "MATH" },
        courseDesignation: "MATH 221",
        fullCourseDesignation: "MATH 221",
        minimumCredits: 4,
        maximumCredits: 4,
        title: "Calculus and Analytic Geometry 1",
        description: "Differential and integral calculus of functions of one variable.",
        enrollmentPrerequisites: "High school algebra and trigonometry",
        generalEd: { code: "QR" },
        ethnicStudies: null,
        lettersAndScienceCredits: { code: "Y" },
        breadths: [{ code: "P" }],
        levels: [{ code: "Elementary" }]
    }
];

const MOCK_SECTION_DATA = [
    {
        enrollmentClassNumber: "12345",
        courseId: "TEST001",
        subjectCode: "COMP",
        catalogNumber: "101",
        sections: [{
            type: "LEC",
            sectionNumber: "001",
            instructors: [{ name: { first: "John", last: "Doe" } }],
            instructionMode: "In Person",
            enrollmentStatus: { capacity: 30, currentlyEnrolled: 25 },
            classMeetings: [{
                meetingType: "CLASS",
                meetingOrExamNumber: "1",
                meetingDays: "MWF",
                meetingTimeStart: 32400000, // 9:00 AM in milliseconds
                meetingTimeEnd: 36000000,   // 10:00 AM in milliseconds
                building: { buildingName: "Computer Sciences" },
                room: "1240"
            }]
        }],
        packageEnrollmentStatus: { status: "OPEN", availableSeats: 5, waitlistTotal: 0 },
        isAsynchronous: false
    }
];

// Utility function to delay execution
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function log(message, level = 'INFO') {
    if (DEV_CONFIG.VERBOSE_LOGGING || level === 'ERROR' || level === 'SUCCESS') {
        const timestamp = new Date().toISOString().substring(11, 23);
        console.log(`[${timestamp}] [${level}] ${message}`);
    }
}

// Utility function to make a request with retry logic using browser session
async function makeRequestWithRetry(url, options, retries = MAX_RETRIES) {
    if (DEV_CONFIG.USE_MOCK_DATA) {
        log(`Mock request for: ${url}`, 'DEBUG');
        await delay(10); // Simulate network delay
        return url.includes('enrollmentPackages') ? MOCK_SECTION_DATA : { hits: MOCK_COURSE_DATA };
    }

    // If no browser session, fall back to regular fetch (for backwards compatibility)
    if (!browserPage) {
        log('⚠️  No browser session - using regular fetch (WAF token may not work)', 'WARNING');
        for (let i = 0; i <= retries; i++) {
            try {
                const response = await fetch(url, options);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) {
                    const text = await response.text();
                    log(`Non-JSON response for ${url}: ${text.substring(0, 200)}...`, 'ERROR');
                    throw new Error(`Expected JSON but got: ${contentType}`);
                }
                
                const data = await response.json();
                return data;
                
            } catch (error) {
                log(`Request failed (attempt ${i + 1}): ${error.message}`, 'ERROR');
                
                if (i === retries) {
                    log(`Max retries reached for: ${url}`, 'ERROR');
                    throw error;
                }
                
                const backoffDelay = RATE_LIMIT_DELAY * Math.pow(2, i);
                log(`Waiting ${backoffDelay}ms before retry...`);
                await delay(backoffDelay);
            }
        }
        return;
    }

    // Use browser session for requests (includes WAF token automatically)
    for (let i = 0; i <= retries; i++) {
        try {
            // Make request from browser context - cookies and WAF token are automatically included
            // Use page.evaluate to run fetch in the browser context
            const result = await browserPage.evaluate(async (requestUrl, method, headersObj, body) => {
                try {
                    // Convert headers object to Headers instance
                    const headers = new Headers();
                    for (const [key, value] of Object.entries(headersObj)) {
                        headers.set(key, value);
                    }
                    
                    // Build fetch options
                    const fetchOptions = {
                        method: method,
                        headers: headers,
                        credentials: 'include', // Include cookies (WAF token)
                        mode: 'cors',
                        cache: 'no-cache'
                    };
                    
                    if (body) {
                        fetchOptions.body = body;
                    }
                    
                    // Make the request
                    const response = await fetch(requestUrl, fetchOptions);
                    
                    // Get response text first
                    const responseText = await response.text();
                    
                    // Check status
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}. Response: ${responseText.substring(0, 500)}`);
                    }
                    
                    // Check content type
                    const contentType = response.headers.get('content-type') || '';
                    if (!contentType.includes('application/json')) {
                        throw new Error(`Expected JSON but got: ${contentType}. Response: ${responseText.substring(0, 500)}`);
                    }
                    
                    // Parse and return JSON
                    return JSON.parse(responseText);
                } catch (err) {
                    // Return error details for better debugging
                    return {
                        __error: true,
                        message: err.message,
                        stack: err.stack?.substring(0, 500)
                    };
                }
            }, url, options.method || 'GET', options.headers || {}, options.body);
            
            // Check for error in result
            if (result && result.__error) {
                throw new Error(result.message);
            }
            
            return result;
            
        } catch (error) {
            log(`Request failed (attempt ${i + 1}): ${error.message}`, 'ERROR');
            
            // Log more details on first attempt
            if (i === 0 && DEV_CONFIG.VERBOSE_LOGGING) {
                log(`URL: ${url}`, 'DEBUG');
                log(`Method: ${options.method || 'GET'}`, 'DEBUG');
                log(`Has body: ${!!options.body}`, 'DEBUG');
                if (error.stack) {
                    log(`Stack: ${error.stack.substring(0, 500)}`, 'DEBUG');
                }
            }
            
            if (i === retries) {
                log(`Max retries reached for: ${url}`, 'ERROR');
                throw error;
            }
            
            const backoffDelay = RATE_LIMIT_DELAY * Math.pow(2, i);
            log(`Waiting ${backoffDelay}ms before retry...`);
            await delay(backoffDelay);
        }
    }
}

async function processBatch(requests, batchSize = BATCH_SIZE) {
    const results = [];
    
    for (let i = 0; i < requests.length; i += batchSize) {
        const batch = requests.slice(i, i + batchSize);
        log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(requests.length / batchSize)} (${batch.length} requests)`);
        
        const batchPromises = batch.map(async (request, index) => {
            await delay(index * RATE_LIMIT_DELAY);
            return request();
        });
        
        try {
            const batchResults = await Promise.allSettled(batchPromises);
            
            batchResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                } else {
                    log(`Request ${i + index} failed: ${result.reason.message}`, 'ERROR');
                    results.push(null);
                }
            });
            
            if (i + batchSize < requests.length) {
                log(`Waiting ${RATE_LIMIT_DELAY * 2}ms between batches...`);
                await delay(RATE_LIMIT_DELAY * 2);
            }
            
        } catch (error) {
            log(`Batch failed: ${error}`, 'ERROR');
        }
    }
    
    return results;
}

// Helper function to find the smallest enrollment capacity among all sections
function getSmallestEnrollmentData(sections) {
    if (!sections || !Array.isArray(sections) || sections.length === 0) {
        return null;
    }
    
    // Filter sections that have enrollment data
    const sectionsWithEnrollment = sections.filter(section => 
        section.enrollmentStatus && 
        section.enrollmentStatus.capacity !== undefined && 
        section.enrollmentStatus.capacity > 0
    );
    
    if (sectionsWithEnrollment.length === 0) {
        return null;
    }
    
    // Find the section with the smallest capacity
    const smallestSection = sectionsWithEnrollment.reduce((smallest, current) => {
        if (!smallest || current.enrollmentStatus.capacity < smallest.enrollmentStatus.capacity) {
            return current;
        }
        return smallest;
    }, null);
    
    return smallestSection ? smallestSection.enrollmentStatus : null;
}

function formatSectionData(courseSections, courseUUID, coursePrerequisites) {
    if (!courseSections || !Array.isArray(courseSections)) {
        return [];
    }

    const sections = [];
    const meetings = [];

    // Normalize course prerequisites for comparison (trim, lowercase, remove common variations)
    const normalizePrereq = (prereq) => {
        if (!prereq) return '';
        return prereq.trim().toLowerCase()
            .replace(/\s+/g, ' ') // Normalize whitespace
            .replace(/^none$/i, ''); // Treat "None" as empty
    };
    const normalizedCoursePrereq = normalizePrereq(coursePrerequisites);

    courseSections.forEach(section => {
        const uniqueSectionId = uuidv4();
        const primarySection = section.sections?.[0];
        
        const instructors = primarySection?.instructors?.map(instructor => 
            `${instructor.name?.first || ''} ${instructor.name?.last || ''}`.trim()
        ) || [];
        
        function formatTime(millis) {
            if (!millis) return null;
            
            
            // Convert to CST by subtracting 6 hours
            const CST_OFFSET_MS = 6 * 60 * 60 * 1000;
            let adjusted = millis - CST_OFFSET_MS;
        
            // Wrap around if negative (before midnight)
            if (adjusted < 0) {
                adjusted += 24 * 60 * 60 * 1000;
            }       
            const hours = Math.floor(adjusted / 3600000);
            const minutes = Math.floor((adjusted % 3600000) / 60000);
            const period = hours >= 12 ? 'PM' : 'AM';
            const hour12 = hours % 12 || 12;
            return `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`;
        }
        
        const meeting = section.classMeetings?.[0];
        const meetingTime = meeting ? 
            `${meeting.meetingDays} ${formatTime(meeting.meetingTimeStart)}-${formatTime(meeting.meetingTimeEnd)}` : 
            'Online';

        // Use the smallest enrollment data instead of just the primary section
        const smallestEnrollment = getSmallestEnrollmentData(section.sections);
        const enrollmentToUse = smallestEnrollment || primarySection?.enrollmentStatus || {};

        // Extract section-level requisites from enrollmentRequirementGroups
        const sectionRequisites = [];
        
        // Only include catalogRequirementGroups if they differ from course-level prerequisites
        if (section.enrollmentRequirementGroups?.catalogRequirementGroups) {
            section.enrollmentRequirementGroups.catalogRequirementGroups.forEach(group => {
                if (group.description) {
                    const normalizedGroupDesc = normalizePrereq(group.description);
                    // Only add if it's different from course prerequisites
                    if (normalizedGroupDesc !== normalizedCoursePrereq && normalizedGroupDesc !== '') {
                        sectionRequisites.push(group.description);
                    }
                }
            });
        }
        
        // Always include classAssociationRequirementGroups (section-specific requirements)
        if (section.enrollmentRequirementGroups?.classAssociationRequirementGroups) {
            section.enrollmentRequirementGroups.classAssociationRequirementGroups.forEach(group => {
                if (group.description) {
                    sectionRequisites.push(group.description);
                }
            });
        }
        
        const sectionRequisitesText = sectionRequisites.length > 0 ? sectionRequisites.join('; ') : null;

        sections.push({
            uniqueSectionId: uniqueSectionId,
            courseUUID: courseUUID,
            sectionId: section.enrollmentClassNumber,
            courseId: section.courseId,
            subjectCode: section.subjectCode,
            catalogNumber: section.catalogNumber,
            instructors: instructors,
            status: section.packageEnrollmentStatus?.status || 'UNKNOWN',
            availableSeats: section.packageEnrollmentStatus?.availableSeats || 0,
            waitlistTotal: section.packageEnrollmentStatus?.waitlistTotal || 0,
            capacity: enrollmentToUse?.capacity || 0,
            enrolled: enrollmentToUse?.currentlyEnrolled || 0,
            instructionMode: primarySection?.instructionMode || 'UNKNOWN',
            isAsynchronous: section.isAsynchronous || false,
            sectionRequisites: sectionRequisitesText
        });

        section.sections?.forEach( nestedSection => {
            
            const firstClassMeeting = nestedSection.classMeetings?.find(meeting => 
                meeting.meetingType === 'CLASS'
            );

            if (firstClassMeeting) {

            const meetingData = {
                meetingType: nestedSection.type,
                meetingNumber: firstClassMeeting.meetingOrExamNumber,
                sectionNumber: nestedSection.sectionNumber,
                uniqueSectionId: uniqueSectionId,
                sectionId: section.enrollmentClassNumber,
                meetingDays: firstClassMeeting.meetingDays || null,
                startTime: formatTime(firstClassMeeting.meetingTimeStart),
                endTime: formatTime(firstClassMeeting.meetingTimeEnd),
                buildingName: firstClassMeeting.building?.buildingName || null,
                room: firstClassMeeting.room || null,
                location: firstClassMeeting.building ? 
                    `${firstClassMeeting.building.buildingName || ''} ${firstClassMeeting.room || ''}`.trim() : null,
                // Add individual day meeting times (weekdays only)
                mondayMeetingStart: null,
                mondayMeetingEnd: null,
                tuesdayMeetingStart: null,
                tuesdayMeetingEnd: null,
                wednesdayMeetingStart: null,
                wednesdayMeetingEnd: null,
                thursdayMeetingStart: null,
                thursdayMeetingEnd: null,
                fridayMeetingStart: null,
                fridayMeetingEnd: null
            };
            const meetingDays = firstClassMeeting.meetingDaysList || []; 

            const startTime = firstClassMeeting.meetingTimeStart;
            const endTime = firstClassMeeting.meetingTimeEnd;

            meetingDays.forEach(day => {
                switch(day.toUpperCase()) {
                    case 'MONDAY':
                        meetingData.mondayMeetingStart = startTime;
                        meetingData.mondayMeetingEnd = endTime;
                        break;
                    case 'TUESDAY':
                        meetingData.tuesdayMeetingStart = startTime;
                        meetingData.tuesdayMeetingEnd = endTime;
                        break;
                    case 'WEDNESDAY':
                        meetingData.wednesdayMeetingStart = startTime;
                        meetingData.wednesdayMeetingEnd = endTime;
                        break;
                    case 'THURSDAY':
                        meetingData.thursdayMeetingStart = startTime;
                        meetingData.thursdayMeetingEnd = endTime;
                        break;
                    case 'FRIDAY':
                        meetingData.fridayMeetingStart = startTime;
                        meetingData.fridayMeetingEnd = endTime;
                        break;
                }
            });
            
            meetings.push(meetingData);
            }
        });

    });

    return { sections, meetings };
}

function escapeCsvValue(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes('"') || str.includes(',') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function generateCSVFiles(courseData, sectionData, subjectData) {
    const prefix = DEV_CONFIG.USE_TEST_TABLES ? DEV_CONFIG.TEST_TABLE_PREFIX : '';
    
    log('Generating CSV files...');
    
    // Generate courses CSV
    const coursesHeader = [
        'course_id', 'subject_code', 'course_designation', 'full_course_designation',
        'minimum_credits', 'maximum_credits', 'general_education', 'ethnic_studies',
        'social_science', 'humanities', 'biological_science', 'physical_science',
        'natural_science', 'literature', 'level',
        'typically_offered', 'workplace_experience_description',
        'grading_basis_description', 'open_to_first_year',
        'repeatable_for_credit', 'status'
    ];
    
    const coursesCsv = [
        coursesHeader.join(','),
        ...courseData.map(course => coursesHeader.map(field => escapeCsvValue(course[field])).join(','))
    ].join('\n');
        
    fs.writeFileSync(`data/csv/${prefix}uw_madison_courses.csv`, coursesCsv);
    log(`Courses CSV written to ${prefix}uw_madison_courses.csv`, 'SUCCESS');
    
    // Generate sections CSV
    const sectionsHeader = [
        'section_id', 'course_id', 'subject_code', 'catalog_number',
        'instructors', 'status', 'available_seats', 'waitlist_total',
        'capacity', 'enrolled',
        'instruction_mode', 'is_asynchronous', 'section_requisites'
    ];
    
    const sectionsCsv = [
        sectionsHeader.join(','),
        ...sectionData.map(section => sectionsHeader.map(field => escapeCsvValue(section[field])).join(','))
    ].join('\n');
    
    fs.writeFileSync(`data/csv/${prefix}uw_madison_sections.csv`, sectionsCsv);
    log(`Sections CSV written to ${prefix}uw_madison_sections.csv`, 'SUCCESS');

    // Generate subjects CSV
    if (Array.isArray(subjectData) && subjectData.length > 0) {
        const subjectsHeader = ['subject_code', 'footnotes'];
        const subjectsCsv = [
            subjectsHeader.join(','),
            ...subjectData.map(subject => subjectsHeader.map(field => escapeCsvValue(subject[field])).join(','))
        ].join('\n');
        fs.writeFileSync(`data/csv/${prefix}uw_madison_subjects.csv`, subjectsCsv);
        log(`Subjects CSV written to ${prefix}uw_madison_subjects.csv`, 'SUCCESS');
    }
}

function generateSQLDump(courseData, sectionData, meetingData, subjectData) {
    const tablePrefix = DEV_CONFIG.USE_TEST_TABLES ? DEV_CONFIG.TEST_TABLE_PREFIX : '';
    const coursesTable = `${tablePrefix}courses`;
    const sectionsTable = `${tablePrefix}sections`;
    const instructorsTable = `${tablePrefix}section_instructors`;
    const meetingsTable = `${tablePrefix}section_meetings`;
    const subjectsTable = `${tablePrefix}subjects`;
    
    log('Generating SQL dump...');
    
    let sqlDump = `-- UW-Madison Course and Section Data SQL Dump
-- Generated on: ${new Date().toISOString()}
-- Development Mode: ${DEV_CONFIG.TEST_MODE ? 'ON' : 'OFF'}
-- Test Tables: ${DEV_CONFIG.USE_TEST_TABLES ? 'ON' : 'OFF'}
-- Mock Data: ${DEV_CONFIG.USE_MOCK_DATA ? 'ON' : 'OFF'}

DROP TABLE IF EXISTS ${instructorsTable};
DROP TABLE IF EXISTS ${sectionsTable};
DROP TABLE IF EXISTS ${coursesTable};
DROP TABLE IF EXISTS ${meetingsTable};
DROP TABLE IF EXISTS ${subjectsTable};

-- Create courses table
CREATE TABLE ${coursesTable} (
    course_id VARCHAR(50),
    course_uuid VARCHAR(50),
    subject_code VARCHAR(10) NOT NULL,
    course_designation VARCHAR(20) NOT NULL,
    course_title VARCHAR(100),
    catalog_number INT, 
    course_description TEXT,
    enrollment_prerequisites TEXT,
    letters_and_science_credits VARCHAR(1),
    full_course_designation VARCHAR(100),
    minimum_credits INT,
    maximum_credits INT,
    general_education VARCHAR(10),
    ethnic_studies VARCHAR(10),
    social_science VARCHAR(10),
    humanities VARCHAR(10),
    biological_science VARCHAR(10),
    physical_science VARCHAR(10),
    natural_science VARCHAR(10),
    literature VARCHAR(10),
    level VARCHAR(10),
    typically_offered VARCHAR(100),
    workplace_experience_description VARCHAR(100),
    grading_basis_description VARCHAR(50),
    open_to_first_year VARCHAR(1),
    repeatable_for_credit VARCHAR(1),
    status INT DEFAULT 0 COMMENT '0=closed, 1=waitlisted, 2=open',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create sections table
CREATE TABLE ${sectionsTable} (
    section_id VARCHAR(50),
    unique_section_id VARCHAR(50),
    course_id VARCHAR(50) NOT NULL,
    course_uuid VARCHAR(50),
    subject_code VARCHAR(10) NOT NULL,
    catalog_number VARCHAR(20),
    status VARCHAR(20),
    available_seats INT,
    waitlist_total INT,
    capacity INT,
    enrolled INT,
    instruction_mode VARCHAR(50),
    is_asynchronous VARCHAR(5),
    section_requisites TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ${instructorsTable} (
    id INT AUTO_INCREMENT PRIMARY KEY,
    section_id VARCHAR(50) NOT NULL,
    unique_section_id VARCHAR(50) NOT NULL,
    instructor_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ${meetingsTable} (
    id INT AUTO_INCREMENT PRIMARY KEY,
    section_id VARCHAR(50) NOT NULL,
    unique_section_id VARCHAR(50) NOT NULL,
    section_number VARCHAR(10),
    meeting_type VARCHAR(50) NOT NULL,
    meeting_number INT,
    meeting_days VARCHAR(10),
    start_time VARCHAR(10),
    end_time VARCHAR(10),
    building_name VARCHAR(100),
    room VARCHAR(100),
    location VARCHAR(100),
    monday_meeting_start INT,
    monday_meeting_end INT,
    tuesday_meeting_start INT,
    tuesday_meeting_end INT,
    wednesday_meeting_start INT,
    wednesday_meeting_end INT,
    thursday_meeting_start INT,
    thursday_meeting_end INT,
    friday_meeting_start INT,
    friday_meeting_end INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create subjects table
CREATE TABLE ${subjectsTable} (
    subject_code VARCHAR(10) PRIMARY KEY,
    footnotes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert course data
INSERT INTO ${coursesTable} (course_id, course_uuid, subject_code, course_title, course_description, enrollment_prerequisites, letters_and_science_credits, course_designation, full_course_designation, minimum_credits, maximum_credits, general_education, ethnic_studies, social_science, humanities, biological_science, physical_science, natural_science, literature, level, typically_offered, workplace_experience_description, grading_basis_description, open_to_first_year, repeatable_for_credit, catalog_number, status) VALUES\n`;

    const chunkSize = 500; // Number of rows per INSERT statement

    // Generate course values
    const courseValues = courseData.map(course => {
        // Helper function to format values properly
        const formatValue = (val, isNumeric = false) => {
            if (val === null || val === undefined) return 'NULL';
            if (isNumeric) return String(val); // Don't quote numeric values
            return `'${String(val).replace(/'/g, "''")}'`; // Quote string values
        };
    
        const values = [
            formatValue(course.courseId),                    // string
            formatValue(course.courseUUID),                  // string  
            formatValue(course.subjectCode),                 // string
            formatValue(course.title),                       // string
            formatValue(course.description),                 // string
            formatValue(course.enrollmentPrerequisites),     // string
            formatValue(course.lettersAndScienceCredits),    // string
            formatValue(course.courseDesignation),           // string
            formatValue(course.fullCourseDesignation),       // string
            formatValue(course.minimumCredits, true),        // numeric - no quotes
            formatValue(course.maximumCredits, true),        // numeric - no quotes
            formatValue(course.generalEducation),            // string
            formatValue(course.ethnicStudies),               // string
            formatValue(course.socialScience),               // string
            formatValue(course.humanities),                  // string
            formatValue(course.biologicalScience),           // string
            formatValue(course.physicalScience),             // string
            formatValue(course.naturalScience),              // string
            formatValue(course.literature),                  // string
            formatValue(course.level),                       // string
            formatValue(course.typicallyOffered),            // string
            formatValue(course.workplaceExperienceDescription), // string
            formatValue(course.gradingBasisDescription),     // string
            formatValue(course.openToFirstYear),             // string ('Y'/'N')
            formatValue(course.repeatableForCredit),         // string ('Y'/'N')
            formatValue(course.catalogNumber, true),         // numeric - no quotes
            formatValue(course.status, true)                 // numeric - no quotes (0, 1, or 2)
        ];
        
        return `(${values.join(', ')})`;
    }).join(',\n');

    sqlDump += courseValues + ';\n\n';

    // Insert subjects data
    if (Array.isArray(subjectData) && subjectData.length > 0) {
        sqlDump += `-- Insert subjects data\nINSERT INTO ${subjectsTable} (subject_code, footnotes) VALUES\n`;
        const subjectValues = subjectData.map(s => {
            const formatValue = (val) => {
                if (val === null || val === undefined) return 'NULL';
                return `'${String(val).replace(/'/g, "''")}'`;
            };
            return `(${formatValue(s.subject_code)}, ${formatValue(s.footnotes)})`;
        }).join(',\n');
        sqlDump += subjectValues + ';\n\n';
    }

    // Insert section data
    if (sectionData.length > 0) {
        sqlDump += `-- Insert section data\nINSERT INTO ${sectionsTable} (section_id, unique_section_id, course_id, course_uuid, subject_code, catalog_number, status, available_seats, waitlist_total, capacity, enrolled, instruction_mode, is_asynchronous, section_requisites) VALUES\n`;

        const sectionValues = sectionData.map(section => {
            const formatValue = (val, isNumeric = false) => {
                if (val === null || val === undefined) return 'NULL';
                if (isNumeric) return String(val); // Don't quote numeric values
                return `'${String(val).replace(/'/g, "''")}'`; // Quote string values
            };
        
            const values = [
                formatValue(section.sectionId),           // string
                formatValue(section.uniqueSectionId),     // string
                formatValue(section.courseId),            // string  
                formatValue(section.courseUUID),          // string
                formatValue(section.subjectCode),         // string
                formatValue(section.catalogNumber),       // string
                formatValue(section.status),              // string
                formatValue(section.availableSeats, true),   // numeric - no quotes
                formatValue(section.waitlistTotal, true),    // numeric - no quotes  
                formatValue(section.capacity, true),         // numeric - no quotes
                formatValue(section.enrolled, true),         // numeric - no quotes
                formatValue(section.instructionMode),     // string
                formatValue(section.isAsynchronous),      // string
                formatValue(section.sectionRequisites)    // string (TEXT)
            ];
            
            return `(${values.join(', ')})`;
        }).join(',\n');

        sqlDump += sectionValues + ';\n\n';

        // Insert instructor data
        const sectionInstructorValues = [];
        sectionData.forEach(section => {
            if (section.instructors && Array.isArray(section.instructors) && section.instructors.length > 0) {
                section.instructors.forEach(instructor => {
                    if (instructor && instructor.trim() !== '') {
                        const sectionId = section.sectionId === null || section.sectionId === undefined ? 'NULL' : `'${String(section.sectionId).replace(/'/g, "''")}'`;
                        const uniqueSectionId = section.uniqueSectionId === null || section.uniqueSectionId === undefined ? 'NULL' : `'${String(section.uniqueSectionId).replace(/'/g, "''")}'`;
                        const instructorName = `'${String(instructor).replace(/'/g, "''")}'`;
                        sectionInstructorValues.push(`(${sectionId}, ${uniqueSectionId}, ${instructorName})`);
                    }
                });
            }
        });

        if (sectionInstructorValues.length > 0) {
            sqlDump += `-- Insert section instructor data\nINSERT INTO ${instructorsTable} (section_id, unique_section_id, instructor_name) VALUES\n`;
            sqlDump += sectionInstructorValues.join(',\n') + ';\n\n';
        }
    }

    // Insert meeting data

    // In the generateSQLDump function, replace the meeting data insertion part with:

if (meetingData.length > 0) {
    sqlDump += `\n-- Insert ${meetingsTable} data\n`;
    sqlDump += `INSERT INTO ${meetingsTable} (section_id, unique_section_id, section_number, meeting_type, meeting_number, meeting_days, start_time, end_time, building_name, room, location, monday_meeting_start, monday_meeting_end, tuesday_meeting_start, tuesday_meeting_end, wednesday_meeting_start, wednesday_meeting_end, thursday_meeting_start, thursday_meeting_end, friday_meeting_start, friday_meeting_end) VALUES\n`;
    
    const meetingValues = meetingData.map(meeting => {
        const formatValue = (val, isNumeric = false) => {
            if (val === null || val === undefined) return 'NULL';
            if (isNumeric) return String(val);
            return `'${String(val).replace(/'/g, "''")}'`;
        };

        const values = [
            formatValue(meeting.sectionId),
            formatValue(meeting.uniqueSectionId),
            formatValue(meeting.sectionNumber),
            formatValue(meeting.meetingType),
            formatValue(meeting.meetingNumber, true),
            formatValue(meeting.meetingDays),
            formatValue(meeting.startTime),
            formatValue(meeting.endTime),
            formatValue(meeting.buildingName),
            formatValue(meeting.room),
            formatValue(meeting.location),
            formatValue(meeting.mondayMeetingStart, true),
            formatValue(meeting.mondayMeetingEnd, true),
            formatValue(meeting.tuesdayMeetingStart, true),
            formatValue(meeting.tuesdayMeetingEnd, true),
            formatValue(meeting.wednesdayMeetingStart, true),
            formatValue(meeting.wednesdayMeetingEnd, true),
            formatValue(meeting.thursdayMeetingStart, true),
            formatValue(meeting.thursdayMeetingEnd, true),
            formatValue(meeting.fridayMeetingStart, true),
            formatValue(meeting.fridayMeetingEnd, true)
        ];
        
        return `(${values.join(', ')})`;
    });

    // Split into chunks to avoid too-long SQL statements
    const chunkSize = 100;
    for (let i = 0; i < meetingValues.length; i += chunkSize) {
        const chunk = meetingValues.slice(i, i + chunkSize);
        sqlDump += chunk.join(',\n') + ';\n';
        
        if (i + chunkSize < meetingValues.length) {
            sqlDump += `\nINSERT INTO ${meetingsTable} (section_id, unique_section_id, section_number, meeting_type, meeting_number, meeting_days, start_time, end_time, building_name, room, location, monday_meeting_start, monday_meeting_end, tuesday_meeting_start, tuesday_meeting_end, wednesday_meeting_start, wednesday_meeting_end, thursday_meeting_start, thursday_meeting_end, friday_meeting_start, friday_meeting_end) VALUES\n`;
        }
    }
}

    // Add indexes
    sqlDump += `-- Create indexes for better performance\n`;
    sqlDump += `CREATE INDEX idx_${tablePrefix}courses_subject_code ON ${coursesTable}(subject_code);\n`;
    sqlDump += `CREATE INDEX idx_${tablePrefix}courses_level ON ${coursesTable}(level);\n`;
    sqlDump += `CREATE INDEX idx_${tablePrefix}sections_course_id ON ${sectionsTable}(course_id);\n`;
    sqlDump += `CREATE INDEX idx_${tablePrefix}sections_subject_code ON ${sectionsTable}(subject_code);\n`;
    sqlDump += `CREATE INDEX idx_${tablePrefix}sections_status ON ${sectionsTable}(status);\n`;
    sqlDump += `CREATE INDEX idx_${tablePrefix}section_instructors_section_id ON ${instructorsTable}(section_id);\n`;
    sqlDump += `CREATE INDEX idx_${tablePrefix}section_instructors_name ON ${instructorsTable}(instructor_name);\n`;

    const filename = `data/sql/${tablePrefix}uw_madison_courses.sql`;
    fs.writeFileSync(filename, sqlDump);
    log(`SQL dump written to ${filename}`, 'SUCCESS');
}

async function getAllCourseSearchAndEnrollData() {
    const startTime = Date.now();
    
    // Initialize browser session for WAF token
    // Allow headless mode to be disabled for CAPTCHA solving
    let isHeadlessMode = true; // Default to headless
    if (!DEV_CONFIG.USE_MOCK_DATA) {
        try {
            log('🌐 Initializing browser session for WAF token...', 'INFO');
            isHeadlessMode = process.env.PUPPETEER_HEADLESS !== 'false';
            browserSession = await puppeteer.launch({
                headless: isHeadlessMode,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
            
            if (!isHeadlessMode) {
                log('👀 Running in non-headless mode (PUPPETEER_HEADLESS=false)', 'INFO');
            }
            
            browserPage = await browserSession.newPage();
            await browserPage.setViewport({ width: 1920, height: 1080 });
            await browserPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // Navigate to enrollment site to get WAF token
            log('📡 Navigating to enrollment site to generate WAF token...', 'INFO');
            
            await browserPage.goto('https://public.enroll.wisc.edu/search', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            
            // Wait a moment for page to load
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Check if we're facing a visual CAPTCHA challenge
            const pageTitle = await browserPage.title();
            const hasCaptcha = await browserPage.evaluate(() => {
                // Check for common CAPTCHA indicators
                const bodyText = document.body?.innerText || '';
                const hasTrafficCone = bodyText.toLowerCase().includes('traffic cone') || 
                                      bodyText.toLowerCase().includes('select all');
                const hasChallenge = document.querySelector('[data-captcha]') || 
                                    document.querySelector('.challenge-container') ||
                                    document.querySelector('#challenge-form');
                return hasTrafficCone || hasChallenge || bodyText.includes('Please select');
            });
            
            if (pageTitle === 'Human Verification' || hasCaptcha) {
                log('🚧 Visual CAPTCHA challenge detected!', 'WARNING');
                
                if (isHeadlessMode) {
                    log('⚠️  Running in headless mode - CAPTCHA cannot be solved automatically', 'ERROR');
                    log('💡 Solutions:', 'INFO');
                    log('   1. Use a CAPTCHA solving service (2captcha, anti-captcha)', 'INFO');
                    log('   2. Run with headless: false to solve manually', 'INFO');
                    log('   3. Use a proxy service that handles CAPTCHAs', 'INFO');
                    log('', 'INFO');
                    log('   For now, waiting up to 5 minutes for manual intervention...', 'INFO');
                    log('   If running locally, switch to non-headless mode:', 'INFO');
                    log('   headless: false in puppeteer.launch()', 'INFO');
                    
                    // Wait up to 5 minutes for challenge to be solved
                    let challengeSolved = false;
                    let waitAttempts = 0;
                    const maxWaitAttempts = 300; // 5 minutes
                    
                    while (!challengeSolved && waitAttempts < maxWaitAttempts) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        waitAttempts++;
                        
                        const currentTitle = await browserPage.title();
                        const currentUrl = browserPage.url();
                        
                        // Check if challenge is solved
                        if (currentTitle !== 'Human Verification' && !currentTitle.includes('Verification')) {
                            if (currentUrl.includes('/search')) {
                                // Test API access
                                try {
                                    const testResult = await browserPage.evaluate(async () => {
                                        try {
                                            const testResponse = await fetch('https://public.enroll.wisc.edu/api/search/v1/enrollmentPackages/1272/240/003275', {
                                                method: 'GET',
                                                credentials: 'include',
                                                headers: {
                                                    'Accept': 'application/json',
                                                    'Referer': 'https://public.enroll.wisc.edu/search'
                                                }
                                            });
                                            const contentType = testResponse.headers.get('content-type') || '';
                                            return {
                                                status: testResponse.status,
                                                ok: testResponse.ok,
                                                isJson: contentType.includes('application/json')
                                            };
                                        } catch (e) {
                                            return { error: e.message };
                                        }
                                    });
                                    
                                    if (testResult.ok && testResult.isJson) {
                                        challengeSolved = true;
                                        log(`✅ CAPTCHA solved! (${waitAttempts}s)`, 'SUCCESS');
                                        break;
                                    }
                                } catch (e) {
                                    // Continue waiting
                                }
                            }
                        }
                        
                        if (waitAttempts % 30 === 0) {
                            log(`   Still waiting for CAPTCHA to be solved... (${waitAttempts}s / 300s)`, 'INFO');
                        }
                    }
                    
                    if (!challengeSolved) {
                        throw new Error('CAPTCHA challenge not solved within 5 minutes. Please run in non-headless mode or use a CAPTCHA solving service.');
                    }
                } else {
                    // Non-headless mode - wait for manual solving
                    log('👀 Browser is visible - please solve the CAPTCHA challenge manually', 'INFO');
                    log('   Waiting for challenge to be completed...', 'INFO');
                    
                    let challengeSolved = false;
                    let waitAttempts = 0;
                    const maxWaitAttempts = 600; // 10 minutes for manual solving
                    
                    while (!challengeSolved && waitAttempts < maxWaitAttempts) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        waitAttempts += 2;
                        
                        const currentTitle = await browserPage.title();
                        const currentUrl = browserPage.url();
                        
                        // Check if challenge is solved
                        if (currentTitle !== 'Human Verification' && !currentTitle.includes('Verification')) {
                            if (currentUrl.includes('/search')) {
                                // Test API access
                                try {
                                    const testResult = await browserPage.evaluate(async () => {
                                        try {
                                            const testResponse = await fetch('https://public.enroll.wisc.edu/api/search/v1/enrollmentPackages/1272/240/003275', {
                                                method: 'GET',
                                                credentials: 'include',
                                                headers: {
                                                    'Accept': 'application/json',
                                                    'Referer': 'https://public.enroll.wisc.edu/search'
                                                }
                                            });
                                            const contentType = testResponse.headers.get('content-type') || '';
                                            return {
                                                status: testResponse.status,
                                                ok: testResponse.ok,
                                                isJson: contentType.includes('application/json')
                                            };
                                        } catch (e) {
                                            return { error: e.message };
                                        }
                                    });
                                    
                                    if (testResult.ok && testResult.isJson) {
                                        challengeSolved = true;
                                        log(`✅ CAPTCHA solved! Continuing...`, 'SUCCESS');
                                        break;
                                    }
                                } catch (e) {
                                    // Continue waiting
                                }
                            }
                        }
                        
                        if (waitAttempts % 10 === 0) {
                            log(`   Still waiting... (${waitAttempts}s)`, 'DEBUG');
                        }
                    }
                    
                    if (!challengeSolved) {
                        throw new Error('CAPTCHA challenge not solved within 10 minutes.');
                    }
                }
            } else {
                log('✅ No CAPTCHA challenge detected, proceeding...', 'SUCCESS');
            }
            
            // Verify token exists
            const cookies = await browserPage.cookies();
            const wafToken = cookies.find(c => c.name === 'aws-waf-token');
            if (wafToken) {
                log('✅ WAF token found', 'SUCCESS');
                log(`   Token (first 50 chars): ${wafToken.value.substring(0, 50)}...`, 'DEBUG');
            } else {
                log('⚠️  WAF token not found', 'WARNING');
            }
            
            // Verify we're on the right page
            const currentUrl = browserPage.url();
            const finalPageTitle = await browserPage.title();
            log(`   Current page: ${currentUrl}`, 'DEBUG');
            log(`   Page title: ${finalPageTitle}`, 'DEBUG');
        } catch (error) {
            log(`⚠️  Failed to initialize browser session: ${error.message}`, 'WARNING');
            log('   Falling back to regular fetch (may not work without WAF token)', 'WARNING');
            // Continue without browser session
        }
    }
    
    try {
        if (DEV_CONFIG.TEST_MODE) {
            log(`DEVELOPMENT MODE ACTIVE `, 'SUCCESS');
            log(`- Course limit: ${DEV_CONFIG.TEST_COURSE_LIMIT}`);
            log(`- Mock data: ${DEV_CONFIG.USE_MOCK_DATA ? 'ON' : 'OFF'}`);
            log(`- Test tables: ${DEV_CONFIG.USE_TEST_TABLES ? 'ON' : 'OFF'}`);
            log(`- Skip sections: ${DEV_CONFIG.SKIP_SECTIONS ? 'ON' : 'OFF'}`);
        }

        log('Fetching initial course search data...', 'INFO');

        let allCourseSearchAndEnrollData;

        if (DEV_CONFIG.USE_MOCK_DATA) {
            allCourseSearchAndEnrollData = { hits: MOCK_COURSE_DATA, found: MOCK_COURSE_DATA.length };
        } else if (DEV_CONFIG.TEST_MODE) {
            // In test mode, keep a single-page fetch for speed
            const pageSize = DEV_CONFIG.TEST_COURSE_LIMIT;
            allCourseSearchAndEnrollData = await makeRequestWithRetry('https://public.enroll.wisc.edu/api/search/v1', {
                headers: BASE_HEADERS,
                method: 'POST',
                body: JSON.stringify({
                    "selectedTerm": "1272",
                    "queryString": "*",
                    "filters": [
                        {
                            "has_child": {
                                "type": "enrollmentPackage",
                                "query": {
                                    "bool": {
                                        "must": [
                                            {
                                                "match": {
                                                    "packageEnrollmentStatus.status": "OPEN WAITLISTED CLOSED"
                                                }
                                            },
                                            {
                                                "match": {
                                                    "published": true
                                                }
                                            }
                                        ]
                                    }
                                }
                            }
                        }
                    ],
                    "page": 1,
                    "pageSize": pageSize,
                    "sortOrder": "SCORE"
                })
            });
        } else {
            // In production mode, paginate through all results since the API caps hits per page (~500)
            const accumulatedHits = [];
            let page = 1;
            const requestedPageSize = 10000;
            let totalFound = null;

            while (true) {
                log(`Requesting course page ${page}...`, 'INFO');

                const response = await makeRequestWithRetry('https://public.enroll.wisc.edu/api/search/v1', {
                    headers: BASE_HEADERS,
                    method: 'POST',
                    body: JSON.stringify({
                        "selectedTerm": "1272",
                        "queryString": "*",
                        "filters": [
                            {
                                "has_child": {
                                    "type": "enrollmentPackage",
                                    "query": {
                                        "bool": {
                                            "must": [
                                                {
                                                    "match": {
                                                        "packageEnrollmentStatus.status": "OPEN WAITLISTED CLOSED"
                                                    }
                                                },
                                                {
                                                    "match": {
                                                        "published": true
                                                    }
                                                }
                                            ]
                                        }
                                    }
                                }
                            }
                        ],
                        "page": page,
                        "pageSize": requestedPageSize,
                        "sortOrder": "SCORE"
                    })
                });

                const hits = response?.hits || [];
                const pageFound = response?.found ?? response?.totalHits ?? null;
                if (totalFound == null && pageFound != null) {
                    totalFound = pageFound;
                }

                accumulatedHits.push(...hits);
                log(`Page ${page}: received ${hits.length} hits (accumulated ${accumulatedHits.length}${totalFound != null ? `/${totalFound}` : ''})`, 'INFO');

                // Stop when no more hits, or we've reached the reported total, or a safety page cap
                if (hits.length === 0) {
                    log(`No hits returned for page ${page}, stopping pagination.`, 'INFO');
                    break;
                }
                if (totalFound != null && accumulatedHits.length >= totalFound) {
                    log(`Reached reported total (${totalFound}) after page ${page}, stopping pagination.`, 'INFO');
                    break;
                }
                if (page >= 50) {
                    log(`Reached maximum page limit (50), stopping pagination.`, 'WARNING');
                    break;
                }

                page += 1;
            }

            allCourseSearchAndEnrollData = {
                hits: accumulatedHits,
                found: totalFound
            };
        }

        log(`Raw course hits from API (after pagination): ${allCourseSearchAndEnrollData?.hits?.length ?? 'unknown'}`, 'INFO');
        log(`API found/totalHits: ${allCourseSearchAndEnrollData?.found ?? allCourseSearchAndEnrollData?.totalHits ?? 'unknown'}`, 'INFO');

        let coursesToProcess = allCourseSearchAndEnrollData.hits;

        log(`DEV_CONFIG.TEST_MODE = ${DEV_CONFIG.TEST_MODE}`, 'INFO');
        log(`DEV_CONFIG.TEST_COURSE_LIMIT = ${DEV_CONFIG.TEST_COURSE_LIMIT}`, 'INFO');
        log(`DEV_CONFIG.USE_MOCK_DATA = ${DEV_CONFIG.USE_MOCK_DATA}`, 'INFO');
        log(`coursesToProcess length before test-mode limiting: ${coursesToProcess?.length ?? 'unknown'}`, 'INFO');

        // Limit courses in test mode
        if (DEV_CONFIG.TEST_MODE && !DEV_CONFIG.USE_MOCK_DATA) {
            coursesToProcess = coursesToProcess.slice(0, DEV_CONFIG.TEST_COURSE_LIMIT);
            log(`coursesToProcess length AFTER test-mode limiting: ${coursesToProcess.length}`, 'INFO');
        }

        log(`Found ${coursesToProcess.length} courses to process`, 'SUCCESS');

        const courseData = coursesToProcess.map(course => ({
            courseId: course.courseId,
            courseUUID: uuidv4(),
            catalogNumber: parseInt(course.catalogNumber),
            subjectCode: course.subject?.subjectCode,
            courseDesignation: course.courseDesignation,
            fullCourseDesignation: course.fullCourseDesignation,
            minimumCredits: course.minimumCredits,
            title: course.title,
            description: course.description,
            enrollmentPrerequisites: course.enrollmentPrerequisites,
            maximumCredits: course.maximumCredits,
            generalEducation: course.generalEd?.code,
            ethnicStudies: course.ethnicStudies?.code,
            lettersAndScienceCredits: course.lettersAndScienceCredits === null ? null : course.lettersAndScienceCredits.code,
            socialScience: course.breadths?.find(b => b.code === 'S')?.code,
            humanities: course.breadths?.find(b => b.code === 'H')?.code,
            biologicalScience: course.breadths?.find(b => b.code === 'B')?.code,
            physicalScience: course.breadths?.find(b => b.code === 'P')?.code,
            naturalScience: course.breadths?.find(b => b.code === 'N')?.code,
            literature: course.breadths?.find(b => b.code === 'L')?.code,
            level: course.levels?.[0]?.code,
            // New attributes
            typicallyOffered: course.typicallyOffered || null,
            workplaceExperienceDescription: course.workplaceExperience?.description || null,
            gradingBasisDescription: course.gradingBasis?.description || null,
            openToFirstYear: course.openToFirstYear ? 'Y' : 'N',
            repeatableForCredit: course.repeatable === 'Y' || course.repeatable === true ? 'Y' : 'N',
            status: 0, // Default to closed, will be updated based on sections
        }));

        // Build subjects data (subject_code, footnotes)
        const subjectMap = new Map();
        for (const c of coursesToProcess) {
            const code = c.subject?.subjectCode;
            if (!code) continue;
            const footnotesArr = Array.isArray(c.subject?.footnotes) ? c.subject.footnotes : [];
            const footnotesText = footnotesArr.join('\n');
            if (!subjectMap.has(code)) {
                subjectMap.set(code, { subject_code: code, footnotes: footnotesText || null });
            } else if (footnotesText) {
                // Merge additional footnotes if any not yet captured
                const existing = subjectMap.get(code);
                if (!existing.footnotes) {
                    existing.footnotes = footnotesText;
                }
            }
        }
        const subjectData = Array.from(subjectMap.values());

        let allSectionData = [];
        let allMeetingData = [];

        if (!DEV_CONFIG.SKIP_SECTIONS) {
            log('Fetching section data...');
            
            if (DEV_CONFIG.USE_MOCK_DATA) {
                // For mock data, find matching course or use empty prerequisites
                const mockCourse = courseData.find(c => c.courseId === MOCK_SECTION_DATA[0]?.courseId);
                const mockPrereq = mockCourse?.enrollmentPrerequisites || null;
                const { sections, meetings } = formatSectionData(MOCK_SECTION_DATA, mockCourse?.courseUUID || uuidv4(), mockPrereq);
                allSectionData = sections;
                allMeetingData = meetings;
            } else {
                const sectionRequests = courseData.map((course) => {
                    return async () => {
                        const url = `https://public.enroll.wisc.edu/api/search/v1/enrollmentPackages/1272/${course.subjectCode}/${course.courseId}`;
                        try {
                            const data = await makeRequestWithRetry(url, {
                                headers: BASE_HEADERS,
                                method: 'GET',
                            });

                            

                            return { course, sections: data };
                        } catch (error) {
                            log(`Failed to fetch sections for ${course.subjectCode} ${course.courseId}: ${error.message}`, 'ERROR');
                            return { course, sections: null };
                        }
                    };
                });

                const sectionResults = await processBatch(sectionRequests, BATCH_SIZE);
                
                let successCount = 0;
                let errorCount = 0;

                sectionResults.forEach(result => {
                    if (result && result.sections) {
                        successCount++;
                        const { sections, meetings } = formatSectionData(
                            result.sections, 
                            result.course.courseUUID,
                            result.course.enrollmentPrerequisites
                        );
                        allSectionData.push(...sections);
                        allMeetingData.push(...meetings);
                    } else {
                        errorCount++;
                    }
                });

                log(`Successfully processed ${successCount} courses, ${errorCount} errors`, 'SUCCESS');
            }
        } else {
            log('Skipping section data (SKIP_SECTIONS = true)');
        }

        log(`Total sections found: ${allSectionData.length}`, 'SUCCESS');

        // Calculate denormalized status for each course based on sections
        courseData.forEach(course => {
            const courseSections = allSectionData.filter(section => section.courseUUID === course.courseUUID);
            
            if (courseSections.length === 0) {
                course.status = 0; // No sections means closed
            } else {
                // Check if ANY section is OPEN
                const hasOpen = courseSections.some(section => section.status === 'OPEN');
                if (hasOpen) {
                    course.status = 2;
                } else {
                    // Check if ANY section is WAITLISTED
                    const hasWaitlisted = courseSections.some(section => section.status === 'WAITLISTED');
                    course.status = hasWaitlisted ? 1 : 0;
                }
            }
        });

        log('Calculated denormalized status for courses', 'SUCCESS');

        // Generate files
        generateSQLDump(courseData, allSectionData, allMeetingData, subjectData);
        generateCSVFiles(courseData, allSectionData, subjectData);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        log(`Data export completed in ${elapsed} seconds! `, 'SUCCESS');
        
        if (DEV_CONFIG.TEST_MODE) {
            log('To run full production mode, set TEST_MODE to false in DEV_CONFIG', 'SUCCESS');
        }
        
    } catch (error) {
        log(`FATAL ERROR: ${error}`, 'ERROR');
        log(`Stack trace: ${error.stack}`, 'ERROR');
    } finally {
        // Close browser session
        if (browserSession) {
            try {
                log('🔒 Closing browser session...', 'INFO');
                await browserSession.close();
                browserSession = null;
                browserPage = null;
            } catch (closeError) {
                log(`Warning: Error closing browser: ${closeError.message}`, 'WARNING');
            }
        }
    }
}

// Quick development helpers
function runQuickTest() {
    console.log('🚀 Running quick test with mock data...');
    const originalConfig = { ...DEV_CONFIG };
    
    // Override config for quickest possible test
    DEV_CONFIG.USE_MOCK_DATA = true;
    DEV_CONFIG.TEST_MODE = true;
    DEV_CONFIG.USE_TEST_TABLES = true;
    DEV_CONFIG.VERBOSE_LOGGING = true;
    
    return getAllCourseSearchAndEnrollData().finally(() => {
        // Restore original config
        Object.assign(DEV_CONFIG, originalConfig);
    });
}

// Export for testing
if (process.argv.includes('--quick-test')) {
    runQuickTest();
} else {
    await getAllCourseSearchAndEnrollData();
}