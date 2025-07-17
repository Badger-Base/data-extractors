import fs from 'fs';

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.5",
    "Content-Type": "application/json",
    "Authorization": "Basic dGVzdDp0ZXN0",
    "Sec-GPC": "1",
}

async function getAllCourseSearchAndEnrollData() {
    try {
        const allCourseSearchAndEnrollData = await fetch('https://public.enroll.wisc.edu/api/search/v1', {
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

        const data = await allCourseSearchAndEnrollData.json();

        console.log(data);

        const courseData = data.hits.map(course => ({
            courseId: course.courseId,
            subjectCode: course.subjectCode,
            courseDesignation: course.courseDesignation,
            fullCourseDesignation: course.fullCourseDesignation, // Fixed duplicate key
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
    
        const sectionPromises = courseData.map(async (course) => {
            return fetch(`https://public.enroll.wisc.edu/api/search/v1/enrollmentPackages/1262/${course.subjectCode}/${course.courseId}`, {
                headers: HEADERS,
                method: 'GET',
            });
        });

        const results = await Promise.all(sectionPromises);
        
        // Fixed: await all JSON parsing
        const sectionResponses = await Promise.all(results.map(result => result.json()));
        
        const sectionData = sectionResponses.flatMap(response => 
            console.log(response),   
            response.map(section => ({
                courseId: section.courseId,

            }))      
        );


        // Generate SQL dump
        generateSQLDump(courseData);

        console.log('SQL dump generated successfully!');
        
    } catch (error) {
        console.error('Error fetching course search and enroll data:', error);
    }
}

function generateSQLDump(courseData) {
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

        sqlDump += `INSERT INTO courses (course_id, subject_code, course_designation, full_course_designation, minimum_credits, maximum_credits, social_science, humanities, biological_science, physical_science, natural_science, literature, level) VALUES (${values.join(', ')});\n`;
    });

    sqlDump += '\n-- Insert section data\n';


    // Insert section data
    sectionData.forEach(section => {
        const values = [
            section.courseId,
   
        ].map(val => val === null || val === undefined ? 'NULL' : `'${String(val).replace(/'/g, "''")}'`);

          sqlDump += `INSERT INTO sections (course_id) VALUES (${values.join(', ')});\n`;
    });

    sqlDump += '\n-- Create indexes for better performance\n';
    sqlDump += 'CREATE INDEX idx_courses_subject_code ON courses(subject_code);\n';
    sqlDump += 'CREATE INDEX idx_courses_level ON courses(level);\n';
    sqlDump += 'CREATE INDEX idx_sections_course_id ON sections(course_id);\n';


    // Write to file
    fs.writeFileSync('uw_madison_courses.sql', sqlDump);
    console.log('SQL dump written to uw_madison_courses.sql');
}

await getAllCourseSearchAndEnrollData();