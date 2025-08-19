import fs from 'fs';

// ====================================
// DEVELOPMENT CONFIGURATION
// ====================================
const DEV_CONFIG = {
    // Set to true for rapid testing - only fetches first few courses
    TEST_MODE: true,
    
    // Number of courses to fetch in test mode (1-10 recommended for quick testing)
    TEST_COURSE_LIMIT: 50,
    
    // Set to true to use mock data instead of API calls (instant testing)
    USE_MOCK_DATA: false,
    
    // Set to true to generate separate test database tables (prevents production conflicts)
    USE_TEST_TABLES: true,
    
    // Prefix for test tables (only used if USE_TEST_TABLES is true)
    TEST_TABLE_PREFIX: 'test_',
    
    // Set to true to skip section fetching entirely (courses only)
    SKIP_SECTIONS: false,
    
    // Verbose logging for debugging
    VERBOSE_LOGGING: true

    
};

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.5",
    "Content-Type": "application/json",
    "Authorization": "Basic dGVzdDp0ZXN0",
    "Sec-GPC": "1",
}

// Rate limiting configuration - reduced for dev mode
const RATE_LIMIT_DELAY = DEV_CONFIG.TEST_MODE ? 50 : 100; // milliseconds between requests
const BATCH_SIZE = DEV_CONFIG.TEST_MODE ? 3 : 50; // process in batches
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
            instructors: [{ name: { first: "John", last: "Doe" } }],
            instructionMode: "In Person",
            enrollmentStatus: { capacity: 30, currentlyEnrolled: 25 }
        }],
        packageEnrollmentStatus: { status: "OPEN", availableSeats: 5, waitlistTotal: 0 },
        classMeetings: [{
            meetingDays: "MWF",
            meetingTimeStart: 32400000, // 9:00 AM in milliseconds
            meetingTimeEnd: 36000000,   // 10:00 AM in milliseconds
            building: { buildingName: "Computer Sciences" },
            room: "1240"
        }],
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

// Utility function to make a request with retry logic
async function makeRequestWithRetry(url, options, retries = MAX_RETRIES) {
    if (DEV_CONFIG.USE_MOCK_DATA) {
        log(`Mock request for: ${url}`, 'DEBUG');
        await delay(10); // Simulate network delay
        return url.includes('enrollmentPackages') ? MOCK_SECTION_DATA : { hits: MOCK_COURSE_DATA };
    }

    for (let i = 0; i <= retries; i++) {
        try {
            log(`Attempting: ${url} (attempt ${i + 1}/${retries + 1})`);
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
            log(`Got data from: ${url}`, 'SUCCESS');
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

function formatSectionData(courseSections) {
    if (!courseSections || !Array.isArray(courseSections)) {
        return [];
    }

    const sections = [];
    const meetings = [];

    courseSections.forEach(section => {
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

        sections.push({
            sectionId: section.enrollmentClassNumber,
            courseId: section.courseId,
            subjectCode: section.subjectCode,
            catalogNumber: section.catalogNumber,
            instructors: instructors,
            status: section.packageEnrollmentStatus?.status || 'UNKNOWN',
            availableSeats: section.packageEnrollmentStatus?.availableSeats || 0,
            waitlistTotal: section.packageEnrollmentStatus?.waitlistTotal || 0,
            capacity: primarySection?.enrollmentStatus?.capacity || 0,
            enrolled: primarySection?.enrollmentStatus?.currentlyEnrolled || 0,
            instructionMode: primarySection?.instructionMode || 'UNKNOWN',
            isAsynchronous: section.isAsynchronous || false
        });

        section.sections?.forEach( nestedSection => {
            
            const firstClassMeeting = nestedSection.classMeetings?.find(meeting => 
                meeting.meetingType === 'CLASS'
            );

            if (firstClassMeeting) {

            const meetingData = {
                meetingType: nestedSection.type,
                meetingNumber: firstClassMeeting.meetingOrExamNumber,
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

function generateCSVFiles(courseData, sectionData) {
    const prefix = DEV_CONFIG.USE_TEST_TABLES ? DEV_CONFIG.TEST_TABLE_PREFIX : '';
    
    log('Generating CSV files...');
    
    // Generate courses CSV
    const coursesHeader = [
        'course_id', 'subject_code', 'course_designation', 'full_course_designation',
        'minimum_credits', 'maximum_credits', 'general_education', 'ethnic_studies',
        'social_science', 'humanities', 'biological_science', 'physical_science',
        'natural_science', 'literature', 'level'
    ];
    
    const coursesCsv = [
        coursesHeader.join(','),
        ...courseData.map(course => coursesHeader.map(field => escapeCsvValue(course[field])).join(','))
    ].join('\n');
    
    fs.writeFileSync(`${prefix}uw_madison_courses.csv`, coursesCsv);
    log(`Courses CSV written to ${prefix}uw_madison_courses.csv`, 'SUCCESS');
    
    // Generate sections CSV
    const sectionsHeader = [
        'section_id', 'course_id', 'subject_code', 'catalog_number',
        'instructors', 'status', 'available_seats', 'waitlist_total',
        'capacity', 'enrolled',
        'instruction_mode', 'is_asynchronous'
    ];
    
    const sectionsCsv = [
        sectionsHeader.join(','),
        ...sectionData.map(section => sectionsHeader.map(field => escapeCsvValue(section[field])).join(','))
    ].join('\n');
    
    fs.writeFileSync(`${prefix}uw_madison_sections.csv`, sectionsCsv);
    log(`Sections CSV written to ${prefix}uw_madison_sections.csv`, 'SUCCESS');
}

function generateSQLDump(courseData, sectionData, meetingData) {
    const tablePrefix = DEV_CONFIG.USE_TEST_TABLES ? DEV_CONFIG.TEST_TABLE_PREFIX : '';
    const coursesTable = `${tablePrefix}courses`;
    const sectionsTable = `${tablePrefix}sections`;
    const instructorsTable = `${tablePrefix}section_instructors`;
    const meetingsTable = `${tablePrefix}section_meetings`;
    
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

-- Create courses table
CREATE TABLE ${coursesTable} (
    course_id VARCHAR(50),
    subject_code VARCHAR(10) NOT NULL,
    course_designation VARCHAR(20) NOT NULL,
    course_title VARCHAR(100),
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create sections table
CREATE TABLE ${sectionsTable} (
    section_id VARCHAR(50),
    course_id VARCHAR(50) NOT NULL,
    subject_code VARCHAR(10) NOT NULL,
    catalog_number VARCHAR(20),
    status VARCHAR(20),
    available_seats INT,
    waitlist_total INT,
    capacity INT,
    enrolled INT,
    instruction_mode VARCHAR(50),
    is_asynchronous VARCHAR(5),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ${instructorsTable} (
    id INT AUTO_INCREMENT PRIMARY KEY,
    section_id VARCHAR(50) NOT NULL,
    instructor_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ${meetingsTable} (
    id INT AUTO_INCREMENT PRIMARY KEY,
    section_id VARCHAR(50) NOT NULL,
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

-- Insert course data
INSERT INTO ${coursesTable} (course_id, subject_code, course_title, course_description, enrollment_prerequisites, letters_and_science_credits, course_designation, full_course_designation, minimum_credits, maximum_credits, general_education, ethnic_studies, social_science, humanities, biological_science, physical_science, natural_science, literature, level) VALUES\n`;

    const chunkSize = 500; // Number of rows per INSERT statement

    // Generate course values
    const courseValues = courseData.map(course => {
        const values = [
            course.courseId,
            course.subjectCode,
            course.title,
            course.description,
            course.enrollmentPrerequisites,
            course.lettersAndScienceCredits,
            course.courseDesignation,
            course.fullCourseDesignation,
            course.minimumCredits,
            course.maximumCredits,
            course.generalEducation,
            course.ethnicStudies,
            course.socialScience,
            course.humanities,
            course.biologicalScience,
            course.physicalScience,
            course.naturalScience,
            course.literature,
            course.level
        ].map(val => val === null || val === undefined ? 'NULL' : `'${String(val).replace(/'/g, "''")}'`);
        
        return `(${values.join(', ')})`;
    }).join(',\n');

    sqlDump += courseValues + ';\n\n';

    // Insert section data
    if (sectionData.length > 0) {
        sqlDump += `-- Insert section data\nINSERT INTO ${sectionsTable} (section_id, course_id, subject_code, catalog_number, status, available_seats, waitlist_total, capacity, enrolled, instruction_mode, is_asynchronous) VALUES\n`;

        const sectionValues = sectionData.map(section => {
            const formatValue = (val, isNumeric = false) => {
                if (val === null || val === undefined) return 'NULL';
                if (isNumeric) return String(val); // Don't quote numeric values
                return `'${String(val).replace(/'/g, "''")}'`; // Quote string values
            };
        
            const values = [
                formatValue(section.sectionId),           // string
                formatValue(section.courseId),            // string  
                formatValue(section.subjectCode),         // string
                formatValue(section.catalogNumber),       // string
                formatValue(section.status),              // string
                formatValue(section.availableSeats, true),   // numeric - no quotes
                formatValue(section.waitlistTotal, true),    // numeric - no quotes  
                formatValue(section.capacity, true),         // numeric - no quotes
                formatValue(section.enrolled, true),         // numeric - no quotes
                formatValue(section.instructionMode),     // string
                formatValue(section.isAsynchronous)       // string
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
                        const instructorName = `'${String(instructor).replace(/'/g, "''")}'`;
                        sectionInstructorValues.push(`(${sectionId}, ${instructorName})`);
                    }
                });
            }
        });

        if (sectionInstructorValues.length > 0) {
            sqlDump += `-- Insert section instructor data\nINSERT INTO ${instructorsTable} (section_id, instructor_name) VALUES\n`;
            sqlDump += sectionInstructorValues.join(',\n') + ';\n\n';
        }
    }

    // Insert meeting data

    if (meetingData.length > 0) {
        const meetingValues = meetingData.map(meeting => {
            const formatValue = (val, isNumeric = false) => {
                if (val === null || val === undefined) return 'NULL';
                if (isNumeric) return String(val);
                return `'${String(val).replace(/'/g, "''")}'`;
            };

            const values = [
                formatValue(meeting.sectionId),
                formatValue(meeting.meetingNumber, true),
                formatValue(meeting.meetingDays),
                formatValue(meeting.startTime),
                formatValue(meeting.endTime),
                formatValue(meeting.buildingName),
                formatValue(meeting.meetingType),
                formatValue(meeting.room),
                formatValue(meeting.location),
                formatValue(meeting.mondayMeetingStart),
                formatValue(meeting.mondayMeetingEnd),
                formatValue(meeting.tuesdayMeetingStart),
                formatValue(meeting.tuesdayMeetingEnd),
                formatValue(meeting.wednesdayMeetingStart),
                formatValue(meeting.wednesdayMeetingEnd),
                formatValue(meeting.thursdayMeetingStart),
                formatValue(meeting.thursdayMeetingEnd),
                formatValue(meeting.fridayMeetingStart),
                formatValue(meeting.fridayMeetingEnd)
            ];
            
            return `(${values.join(', ')})`;
        });

        sqlDump += '\n-- Insert section meeting data (bulk insert)\n';
        sqlDump += 'INSERT INTO section_meetings (section_id, meeting_number, meeting_days, start_time, end_time, building_name, meeting_type, room, location, monday_meeting_start, monday_meeting_end, tuesday_meeting_start, tuesday_meeting_end, wednesday_meeting_start, wednesday_meeting_end, thursday_meeting_start, thursday_meeting_end, friday_meeting_start, friday_meeting_end) VALUES\n';
        
        // Split meeting data into chunks as well
        for (let i = 0; i < meetingValues.length; i += chunkSize) {
            const chunk = meetingValues.slice(i, i + chunkSize);
            sqlDump += chunk.join(',\n') + ';\n';
            
            // Add another INSERT statement if there are more rows
            if (i + chunkSize < meetingValues.length) {
                sqlDump += '\nINSERT INTO section_meetings (section_id, meeting_number, meeting_days, start_time, end_time, building_name, meeting_type, room, location, monday_meeting_start, monday_meeting_end, tuesday_meeting_start, tuesday_meeting_end, wednesday_meeting_start, wednesday_meeting_end, thursday_meeting_start, thursday_meeting_end, friday_meeting_start, friday_meeting_end) VALUES\n';
            }
        }
    } else {
        sqlDump += '\n-- No meeting data to insert\n';
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

    const filename = `${tablePrefix}uw_madison_courses.sql`;
    fs.writeFileSync(filename, sqlDump);
    log(`SQL dump written to ${filename}`, 'SUCCESS');
}

async function getAllCourseSearchAndEnrollData() {
    const startTime = Date.now();
    
    try {
        if (DEV_CONFIG.TEST_MODE) {
            log(`🚀 DEVELOPMENT MODE ACTIVE 🚀`, 'SUCCESS');
            log(`- Course limit: ${DEV_CONFIG.TEST_COURSE_LIMIT}`);
            log(`- Mock data: ${DEV_CONFIG.USE_MOCK_DATA ? 'ON' : 'OFF'}`);
            log(`- Test tables: ${DEV_CONFIG.USE_TEST_TABLES ? 'ON' : 'OFF'}`);
            log(`- Skip sections: ${DEV_CONFIG.SKIP_SECTIONS ? 'ON' : 'OFF'}`);
        }
        
        log('Fetching initial course search data...');
        
        let allCourseSearchAndEnrollData;
        
        if (DEV_CONFIG.USE_MOCK_DATA) {
            allCourseSearchAndEnrollData = { hits: MOCK_COURSE_DATA };
        } else {
            allCourseSearchAndEnrollData = await makeRequestWithRetry('https://public.enroll.wisc.edu/api/search/v1', {
                headers: HEADERS,
                method: 'POST',
                body: JSON.stringify({
                    "selectedTerm": "1262",
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
                    "pageSize": DEV_CONFIG.TEST_MODE ? DEV_CONFIG.TEST_COURSE_LIMIT : 10000,
                    "sortOrder": "SCORE"
                })
            });
        }

        let coursesToProcess = allCourseSearchAndEnrollData.hits;
        
        // Limit courses in test mode
        if (DEV_CONFIG.TEST_MODE && !DEV_CONFIG.USE_MOCK_DATA) {
            coursesToProcess = coursesToProcess.slice(0, DEV_CONFIG.TEST_COURSE_LIMIT);
        }

        log(`Found ${coursesToProcess.length} courses to process`, 'SUCCESS');

        const courseData = coursesToProcess.map(course => ({
            courseId: course.courseId,
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
        }));

        let allSectionData = [];
        let allMeetingData = [];

        if (!DEV_CONFIG.SKIP_SECTIONS) {
            log('Fetching section data...');
            
            if (DEV_CONFIG.USE_MOCK_DATA) {
                allSectionData = formatSectionData(MOCK_SECTION_DATA);
            } else {
                const sectionRequests = courseData.map((course) => {
                    return async () => {
                        const url = `https://public.enroll.wisc.edu/api/search/v1/enrollmentPackages/1262/${course.subjectCode}/${course.courseId}`;
                        try {
                            const data = await makeRequestWithRetry(url, {
                                headers: HEADERS,
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
                        const { sections, meetings } = formatSectionData(result.sections);
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

        // Generate files
        generateSQLDump(courseData, allSectionData, allMeetingData);
        generateCSVFiles(courseData, allSectionData, allMeetingData);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        log(`🎉 Data export completed in ${elapsed} seconds! 🎉`, 'SUCCESS');
        
        if (DEV_CONFIG.TEST_MODE) {
            log('💡 To run full production mode, set TEST_MODE to false in DEV_CONFIG', 'SUCCESS');
        }
        
    } catch (error) {
        log(`FATAL ERROR: ${error}`, 'ERROR');
        log(`Stack trace: ${error.stack}`, 'ERROR');
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