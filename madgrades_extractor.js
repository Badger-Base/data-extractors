const fs = require('fs');
const path = require('path');

async function main() {
    // Get all courses
    let course_data = [];
    
    let hasNext = true;
    let page = 1;
    
    // First, collect all course UUIDs
    while (hasNext) {
        console.log(`Fetching page ${page}`);
        console.log(`https://api.madgrades.com/v1/courses?page=${page}&per_page=500`);
        
        const response = await fetch(`https://api.madgrades.com/v1/courses?page=${page}&per_page=500`, {
            method: "GET",
            headers: {
                "Authorization": "Token token=db0b773feba0467688172d87b38f3f95",
                "Accept": "application/json"
            }
        });
        
        const coursesJson = await response.json();
        
        // Extract UUIDs from this page
        const data = coursesJson.results.map(course => ({
            uuid: course.uuid,
            number: course.number,
            name: course.name,
            abbreviations: course.subjects.map(subject => subject.abbreviation)
        }));
        
        course_data.push(...data);
        
        if (coursesJson.nextPageUrl === null) {
            hasNext = false;
        }
        
        page++;
    }
    
    console.log(`Total courses found: ${course_data}`);
    
    // Define batch size before using it
    const batchSize = 100; // Start aggressive - 100 courses at a time
    console.log(`Starting aggressive batch processing with ${batchSize} courses per batch...`);

    const ripOutCumulativeGradeAndMostRecentGrade = (grades) => {
        return {
            uuid: grades.courseUuid,
            cumulative: calculateGrade(grades.cumulative).toFixed(2),
            mostRecent: grades.courseOfferings && grades.courseOfferings.length > 0 
                ? calculateGrade(grades.courseOfferings[0].cumulative).toFixed(2)
                : null
        }
    }
    
    const calculateGrade = (grades) => {
        let total = 0
        let totalCount = 0
        total += grades.aCount * 4
        totalCount += grades.aCount
        total += grades.abCount * 3.5
        totalCount += grades.abCount
        total += grades.bCount * 3
        totalCount += grades.bCount
        total += grades.bcCount * 2.5
        totalCount += grades.bcCount
        total += grades.cCount * 2
        totalCount += grades.cCount
        total += grades.dCount * 1
        totalCount += grades.dCount
        totalCount += grades.fCount
        return total / totalCount
    }
    
    const startTime = Date.now();
    
    // Now batch process grades for each course UUID
    const allGrades = [];
    
    for (let i = 0; i < course_data.length; i += batchSize) {
        const batch = course_data.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(course_data.length/batchSize)} (courses ${i + 1}-${Math.min(i + batchSize, course_data.length)})`);
        
        // Process batch concurrently
        const batchPromises = batch.map(async (course_data) => {
            try {
                const gradesResponse = await fetch(`https://api.madgrades.com/v1/courses/${course_data.uuid}/grades`, {
                    method: "GET",
                    headers: {
                        "Authorization": "Token token=db0b773feba0467688172d87b38f3f95",
                        "Accept": "application/json"
                    }
                });
                
                if (!gradesResponse.ok) {
                    console.warn(`Failed to fetch grades for course ${course_data.uuid}: ${gradesResponse.status}`);
                    return null;
                }
                
                const gradesJson = await gradesResponse.json();
                return {
                    uuid: course_data.uuid,
                    number: course_data.number,
                    abbreviations: course_data.abbreviations,
                    grades: gradesJson
                };
            } catch (error) {
                console.error(`Error fetching grades for course ${course_data.uuid}:`, error.message);
                return null;
            }
        });
        
        const batchResults = await Promise.all(batchPromises);
        
        // Filter out null results and add to allGrades
        const results = batchResults.filter(result => result !== null);
        results.forEach(result => {
            result.grades = ripOutCumulativeGradeAndMostRecentGrade(result.grades)
        })
        allGrades.push(...results);

        // Small delay between batches to be respectful to the API
        if (i + batchSize < course_data.length) {
            await new Promise(resolve => setTimeout(resolve, 50)); // Reduced delay
        }
    }
    
    console.log(`Successfully fetched grades for ${allGrades.length} courses`);
    
    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 1000;
    console.log(`Total processing time: ${totalTime}s (${(totalTime/60).toFixed(1)} minutes)`);
    console.log(`Average time per course: ${(totalTime/allGrades.length).toFixed(3)}s`);
    
    console.log("Sample grades data:", allGrades.slice(0, 2)); // Show first 2 for inspection

    const parsed_grades = parseGrades(allGrades);
    
    // Generate and save SQL dump
    await generateAndSaveSQLDump(parsed_grades);
    
    return allGrades;
}

async function parseGrades(allGrades) {
    let parsed_grades = []

    for (const grade of allGrades) {
        for (const abbreviation of grade.abbreviations) {
            parsed_grades.push({
                uuid: grade.uuid,
                grades: grade.grades,
                name: abbreviation + " " + grade.number,
            })
        }
    }
    
    return parsed_grades;
}

async function generateAndSaveSQLDump(parsed_grades) {
    console.log('\n=== GENERATING SQL DUMP ===\n');
    
    // Create the SQL dump content
    let sqlContent = '';
    
    // Add header comment
    sqlContent += `-- Course Grades SQL Dump\n`;
    sqlContent += `-- Generated on: ${new Date().toISOString()}\n`;
    sqlContent += `-- Total records: ${parsed_grades.length}\n\n`;
    
    // Create table
    sqlContent += `-- Create table for course grades\n`;
    sqlContent += `DROP TABLE IF EXISTS course_grades;\n\n`;
    sqlContent += `CREATE TABLE course_grades (\n`;
    sqlContent += `    id SERIAL PRIMARY KEY,\n`;
    sqlContent += `    course_uuid VARCHAR(255) NOT NULL UNIQUE,\n`;
    sqlContent += `    course_name VARCHAR(255) NOT NULL,\n`;
    sqlContent += `    cumulative_gpa DECIMAL(3,2),\n`;
    sqlContent += `    most_recent_gpa DECIMAL(3,2),\n`;
    sqlContent += `    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n`;
    sqlContent += `);\n\n`;
    
    // Add indexes
    sqlContent += `-- Create indexes\n`;
    sqlContent += `CREATE INDEX idx_course_grades_uuid ON course_grades(course_uuid);\n`;
    sqlContent += `CREATE INDEX idx_course_grades_cumulative ON course_grades(cumulative_gpa);\n`;
    sqlContent += `CREATE INDEX idx_course_grades_recent ON course_grades(most_recent_gpa);\n\n`;
    
    // Prepare data insertion in batches of 500
    const validGrades = parsed_grades.filter(grade => grade && grade.grades && grade.grades.uuid);
    const batchSize = 500;
    
    sqlContent += `-- Insert course grades data in batches\n`;
    
    for (let i = 0; i < validGrades.length; i += batchSize) {
        const batch = validGrades.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(validGrades.length / batchSize);
        
        sqlContent += `\n-- Batch ${batchNumber}/${totalBatches} (records ${i + 1}-${Math.min(i + batchSize, validGrades.length)})\n`;
        sqlContent += `INSERT INTO course_grades (course_uuid, course_name, cumulative_gpa, most_recent_gpa) VALUES\n`;
        
        const insertValues = batch.map((grade, index) => {
            const uuid = grade.grades.uuid;
            const name = grade.name;
            const cumulative = grade.grades.cumulative ? parseFloat(grade.grades.cumulative) : null;
            const mostRecent = grade.grades.mostRecent ? parseFloat(grade.grades.mostRecent) : null;
            
            // Escape single quotes in UUID (though UUIDs shouldn't have them)
            const escapedUuid = uuid.replace(/'/g, "''");
            
            const cumulativeValue = cumulative !== null && !isNaN(cumulative) ? cumulative.toFixed(2) : 'NULL';
            const mostRecentValue = mostRecent !== null && !isNaN(mostRecent) ? mostRecent.toFixed(2) : 'NULL';
            
            const isLast = index === batch.length - 1;
            return `    ('${escapedUuid}', '${name}', ${cumulativeValue}, ${mostRecentValue})${isLast ? ';' : ','}`;
        }).join('\n');
        
        sqlContent += insertValues + '\n';
    }
    
    // Add some statistics queries
    sqlContent += `\n\n-- Statistics queries\n`;
    sqlContent += `-- Total courses with grades\n`;
    sqlContent += `SELECT COUNT(*) as total_courses FROM course_grades;\n\n`;
    sqlContent += `-- Average cumulative GPA\n`;
    sqlContent += `SELECT AVG(cumulative_gpa) as avg_cumulative_gpa FROM course_grades WHERE cumulative_gpa IS NOT NULL;\n\n`;
    sqlContent += `-- Average most recent GPA\n`;
    sqlContent += `SELECT AVG(most_recent_gpa) as avg_recent_gpa FROM course_grades WHERE most_recent_gpa IS NOT NULL;\n\n`;
    sqlContent += `-- GPA distribution (cumulative)\n`;
    sqlContent += `SELECT \n`;
    sqlContent += `    CASE \n`;
    sqlContent += `        WHEN cumulative_gpa >= 3.75 THEN 'A (3.75-4.0)'\n`;
    sqlContent += `        WHEN cumulative_gpa >= 3.25 THEN 'B (3.25-3.74)'\n`;
    sqlContent += `        WHEN cumulative_gpa >= 2.75 THEN 'C (2.75-3.24)'\n`;
    sqlContent += `        WHEN cumulative_gpa >= 2.25 THEN 'D (2.25-2.74)'\n`;
    sqlContent += `        ELSE 'F (0-2.24)'\n`;
    sqlContent += `    END as grade_range,\n`;
    sqlContent += `    COUNT(*) as course_count,\n`;
    sqlContent += `    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM course_grades WHERE cumulative_gpa IS NOT NULL), 2) as percentage\n`;
    sqlContent += `FROM course_grades \n`;
    sqlContent += `WHERE cumulative_gpa IS NOT NULL \n`;
    sqlContent += `GROUP BY grade_range \n`;
    sqlContent += `ORDER BY MIN(cumulative_gpa) DESC;\n`;
    
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
    const filename = `course_grades_dump_${timestamp}.sql`;
    const filepath = path.join(process.cwd(), filename);
    
    try {
        // Write SQL dump to file
        await fs.promises.writeFile(filepath, sqlContent, 'utf8');
        
        console.log(`\n=== SQL DUMP SAVED SUCCESSFULLY ===`);
        console.log(`File: ${filename}`);
        console.log(`Full path: ${filepath}`);
        console.log(`File size: ${(sqlContent.length / 1024).toFixed(2)} KB`);
        
        // Statistics
        console.log(`\n=== DUMP STATISTICS ===`);
        console.log(`Total records processed: ${validGrades.length}`);
        console.log(`Records with cumulative GPA: ${validGrades.filter(g => g.grades.cumulative !== null).length}`);
        console.log(`Records with most recent GPA: ${validGrades.filter(g => g.grades.mostRecent !== null).length}`); 
        
        // Preview first few lines
        const lines = sqlContent.split('\n');
        console.log(`\n=== FILE PREVIEW (first 10 lines) ===`);
        lines.slice(0, 10).forEach((line, index) => {
            console.log(`${(index + 1).toString().padStart(2)}: ${line}`);
        });
        
    } catch (error) {
        console.error('Error saving SQL dump:', error);
        
        // Fallback: save to a default location
        const fallbackFilename = 'course_grades_dump.sql';
        try {
            await fs.promises.writeFile(fallbackFilename, sqlContent, 'utf8');
            console.log(`Saved to fallback location: ${fallbackFilename}`);
        } catch (fallbackError) {
            console.error('Fallback save also failed:', fallbackError);
            console.log('\n=== SQL CONTENT (since file save failed) ===');
            console.log(sqlContent.substring(0, 2000) + '...[truncated]');
        }
    }
    
    return sqlContent;
}

// Run the script
main().catch(console.error);