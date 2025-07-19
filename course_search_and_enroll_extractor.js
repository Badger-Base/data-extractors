import fs from 'fs';

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.5",
    "Content-Type": "application/json",
    "Authorization": "Basic dGVzdDp0ZXN0",
    "Sec-GPC": "1",
}

// Rate limiting configuration
const RATE_LIMIT_DELAY = 100; // milliseconds between requests
const BATCH_SIZE = 50; // process in batches
const MAX_RETRIES = 3;

// Utility function to delay execution
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Utility function to make a request with retry logic
async function makeRequestWithRetry(url, options, retries = MAX_RETRIES) {
    for (let i = 0; i <= retries; i++) {
        try {
            console.log(`[REQUEST] Attempting: ${url} (attempt ${i + 1}/${retries + 1})`);
            const response = await fetch(url, options);
            
            // Check if response is OK
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            // Check content type to ensure it's JSON
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const text = await response.text();
                console.error(`[ERROR] Non-JSON response for ${url}:`);
                console.error(text.substring(0, 200) + '...');
                throw new Error(`Expected JSON but got: ${contentType}`);
            }
            
            const data = await response.json();
            console.log(`[SUCCESS] Got data from: ${url}`);
            return data;
            
        } catch (error) {
            console.error(`[ERROR] Request failed (attempt ${i + 1}): ${error.message}`);
            
            if (i === retries) {
                console.error(`[FINAL ERROR] Max retries reached for: ${url}`);
                throw error;
            }
            
            // Exponential backoff
            const backoffDelay = RATE_LIMIT_DELAY * Math.pow(2, i);
            console.log(`[RETRY] Waiting ${backoffDelay}ms before retry...`);
            await delay(backoffDelay);
        }
    }
}

// Process requests in batches to avoid overwhelming the server
async function processBatch(requests, batchSize = BATCH_SIZE) {
    const results = [];
    
    for (let i = 0; i < requests.length; i += batchSize) {
        const batch = requests.slice(i, i + batchSize);
        console.log(`[BATCH] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(requests.length / batchSize)} (${batch.length} requests)`);
        
        const batchPromises = batch.map(async (request, index) => {
            // Stagger requests within batch
            await delay(index * RATE_LIMIT_DELAY);
            return request();
        });
        
        try {
            const batchResults = await Promise.allSettled(batchPromises);
            
            batchResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                } else {
                    console.error(`[BATCH ERROR] Request ${i + index} failed:`, result.reason.message);
                    results.push(null); // placeholder for failed request
                }
            });
            
            // Delay between batches
            if (i + batchSize < requests.length) {
                console.log(`[BATCH] Waiting ${RATE_LIMIT_DELAY * 2}ms between batches...`);
                await delay(RATE_LIMIT_DELAY * 2);
            }
            
        } catch (error) {
            console.error(`[BATCH ERROR] Batch failed:`, error);
        }
    }
    
    return results;
}

function formatSectionData(courseSections) {
    if (!courseSections || !Array.isArray(courseSections)) {
        return [];
    }
    
    return courseSections.map(section => {
        const primarySection = section.sections?.[0];
        
        // Extract instructors
        const instructors = primarySection?.instructors?.map(instructor => 
            `${instructor.name?.first || ''} ${instructor.name?.last || ''}`.trim()
        ) || [];
        
        // Format meeting time
        const formatTime = (millis) => {
            if (!millis) return '';
            const hours = Math.floor(millis / 3600000);
            const minutes = Math.floor((millis % 3600000) / 60000);
            const period = hours >= 12 ? 'PM' : 'AM';
            const hour12 = hours % 12 || 12;
            return `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`;
        };
        
        const meeting = section.classMeetings?.[0];
        const meetingTime = meeting ? 
            `${meeting.meetingDays} ${formatTime(meeting.meetingTimeStart)}-${formatTime(meeting.meetingTimeEnd)}` : 
            'Online';
        
        return {
            sectionId: section.enrollmentClassNumber,
            courseId: section.courseId,
            subjectCode: section.subjectCode,
            catalogNumber: section.catalogNumber,
            instructors: instructors.join(', '),
            status: section.packageEnrollmentStatus?.status || 'UNKNOWN',
            availableSeats: section.packageEnrollmentStatus?.availableSeats || 0,
            waitlistTotal: section.packageEnrollmentStatus?.waitlistTotal || 0,
            capacity: primarySection?.enrollmentStatus?.capacity || 0,
            enrolled: primarySection?.enrollmentStatus?.currentlyEnrolled || 0,
            meetingTime: meetingTime,
            location: meeting ? `${meeting.building?.buildingName || ''} ${meeting.room || ''}`.trim() : 'Online',
            instructionMode: primarySection?.instructionMode || 'UNKNOWN',
            isAsynchronous: section.isAsynchronous || false
        };
    });
}

async function getAllCourseSearchAndEnrollData() {
    try {
        console.log('[START] Fetching initial course search data...');
        
        const allCourseSearchAndEnrollData = await makeRequestWithRetry('https://public.enroll.wisc.edu/api/search/v1', {
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
                "pageSize": 10000,
                "sortOrder": "SCORE"
            })
        });

        console.log(`[SUCCESS] Found ${allCourseSearchAndEnrollData.hits.length} courses`);

        const courseData = allCourseSearchAndEnrollData.hits.map(course => ({
            courseId: course.courseId,
            subjectCode: course.subject?.subjectCode,
            courseDesignation: course.courseDesignation,
            fullCourseDesignation: course.fullCourseDesignation,
            minimumCredits: course.minimumCredits,
            maximumCredits: course.maximumCredits,
            generalEducation: course.generalEd?.code,
            ethnicStudies: course.ethnicStudies?.code,
            socialScience: course.breadths?.find(b => b.code === 'S')?.code,
            humanities: course.breadths?.find(b => b.code === 'H')?.code,
            biologicalScience: course.breadths?.find(b => b.code === 'B')?.code,
            physicalScience: course.breadths?.find(b => b.code === 'P')?.code,
            naturalScience: course.breadths?.find(b => b.code === 'N')?.code,
            literature: course.breadths?.find(b => b.code === 'L')?.code,
            level: course.levels?.[0]?.code,
        }));

        console.log('[START] Fetching section data for all courses...');
        
        // Create request functions for batch processing
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
                    console.error(`[ERROR] Failed to fetch sections for ${course.subjectCode} ${course.courseId}:`, error.message);
                    return { course, sections: null };
                }
            };
        });

        // Process requests in batches
        const sectionResults = await processBatch(sectionRequests, BATCH_SIZE);
        
        // Process and format section data
        const allSectionData = [];
        let successCount = 0;
        let errorCount = 0;

        sectionResults.forEach(result => {
            if (result && result.sections) {
                successCount++;
                const formattedSections = formatSectionData(result.sections);
                allSectionData.push(...formattedSections);
            } else {
                errorCount++;
            }
        });

        console.log(`[SUMMARY] Successfully processed ${successCount} courses, ${errorCount} errors`);
        console.log(`[SUMMARY] Total sections found: ${allSectionData.length}`);

        // Generate SQL dump
        console.log('[START] Generating SQL dump...');
        generateSQLDump(courseData, allSectionData);

        console.log('[COMPLETE] SQL dump generated successfully!');
        
    } catch (error) {
        console.error('[FATAL ERROR] Error fetching course search and enroll data:', error);
        console.error('Stack trace:', error.stack);
    }
}

function generateSQLDump(courseData, sectionData) {
    let sqlDump = `-- UW-Madison Course and Section Data SQL Dump
-- Generated on: ${new Date().toISOString()}

-- Create courses table
CREATE TABLE courses (
    course_id VARCHAR(50) PRIMARY KEY,
    subject_code VARCHAR(10) NOT NULL,
    course_designation VARCHAR(20) NOT NULL,
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
CREATE TABLE sections (
    section_id VARCHAR(50) PRIMARY KEY,
    course_id VARCHAR(50) NOT NULL,
    subject_code VARCHAR(10) NOT NULL,
    catalog_number VARCHAR(20),
    instructors TEXT,
    status VARCHAR(20),
    available_seats INT,
    waitlist_total INT,
    capacity INT,
    enrolled INT,
    meeting_time VARCHAR(100),
    location VARCHAR(100),
    instruction_mode VARCHAR(50),
    is_asynchronous BOOLEAN,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES courses(course_id)
);

-- Insert course data

`;

    // Insert course data
    courseData.forEach(course => {
        const values = [
            course.courseId,
            course.subjectCode,
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

        sqlDump += `INSERT INTO courses (course_id, subject_code, course_designation, full_course_designation, minimum_credits, maximum_credits, general_education, ethnic_studies, social_science, humanities, biological_science, physical_science, natural_science, literature, level) VALUES (${values.join(', ')});\n`;
    });

    sqlDump += '\n-- Insert section data\n';

    // Insert section data
    sectionData.forEach(section => {
        const values = [
            section.sectionId,
            section.courseId,
            section.subjectCode,
            section.catalogNumber,
            section.instructors,
            section.status,
            section.availableSeats,
            section.waitlistTotal,
            section.capacity,
            section.enrolled,
            section.meetingTime,
            section.location,
            section.instructionMode,
            section.isAsynchronous
        ].map(val => val === null || val === undefined ? 'NULL' : `'${String(val).replace(/'/g, "''")}'`);

        sqlDump += `INSERT INTO sections (section_id, course_id, subject_code, catalog_number, instructors, status, available_seats, waitlist_total, capacity, enrolled, meeting_time, location, instruction_mode, is_asynchronous) VALUES (${values.join(', ')});\n`;
    });

    sqlDump += '\n-- Create indexes for better performance\n';
    sqlDump += 'CREATE INDEX idx_courses_subject_code ON courses(subject_code);\n';
    sqlDump += 'CREATE INDEX idx_courses_level ON courses(level);\n';
    sqlDump += 'CREATE INDEX idx_sections_course_id ON sections(course_id);\n';
    sqlDump += 'CREATE INDEX idx_sections_subject_code ON sections(subject_code);\n';
    sqlDump += 'CREATE INDEX idx_sections_status ON sections(status);\n';

    // Write to file
    fs.writeFileSync('uw_madison_courses.sql', sqlDump);
    console.log('[SUCCESS] SQL dump written to uw_madison_courses.sql');
}

await getAllCourseSearchAndEnrollData();