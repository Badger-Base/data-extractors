const HEADERS = { 
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0", 
    "Accept": "*/*", 
    "Accept-Language": "en-US,en;q=0.5", 
    "Content-Type": "application/json", 
    "Authorization": "Basic dGVzdDp0ZXN0", 
    "Sec-GPC": "1", 
};

import fs from 'fs';

const url = `https://public.enroll.wisc.edu/api/search/v1/enrollmentPackages/1262/270/022973`;

const response = await fetch(url, { 
    method: 'GET', 
    headers: HEADERS, 
});

const data = await response.json();
const sectionData = extractSectionData(data);

// Convert to CSV and save to file
const csvOutput = convertToCSV(sectionData);
saveToCsvFile(csvOutput, 'course_sections.csv');

function extractSectionData(courseSections) {
    return courseSections.map(section => {
        const primarySection = section.sections[0];
        
        // Extract instructors
        const instructors = section.sections[0].instructors.map(instructor => 
            `${instructor.name.first} ${instructor.name.last}`
        );
        
        // Format meeting time
        const formatTime = (millis) => {
            const hours = Math.floor(millis / 3600000);
            const minutes = Math.floor((millis % 3600000) / 60000);
            const period = hours >= 12 ? 'PM' : 'AM';
            const hour12 = hours % 12 || 12;
            return `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`;
        };
        
        const meeting = section.classMeetings[0];
        const meetingTime = meeting ? 
            `${meeting.meetingDays} ${formatTime(meeting.meetingTimeStart)}-${formatTime(meeting.meetingTimeEnd)}` : 
            'Online';
        
        return {
            sectionId: section.enrollmentClassNumber,
            courseId: section.courseId,
            subjectCode: section.subjectCode,
            catalogNumber: section.catalogNumber,
            instructors: instructors,
            status: section.packageEnrollmentStatus.status,
            availableSeats: section.packageEnrollmentStatus.availableSeats,
            waitlistTotal: section.packageEnrollmentStatus.waitlistTotal,
            capacity: primarySection.enrollmentStatus.capacity,
            enrolled: primarySection.enrollmentStatus.currentlyEnrolled,
            meetingTime: meetingTime,
            location: meeting ? `${meeting.building.buildingName} ${meeting.room}` : 'Online',
            instructionMode: primarySection.instructionMode,
            isAsynchronous: section.isAsynchronous
        };
    });
}

function convertToCSV(sectionData) {
    const headers = [
        'sectionId', 'courseId', 'subjectCode', 'catalogNumber', 'instructors',
        'status', 'availableSeats', 'waitlistTotal', 'capacity', 'enrolled',
        'meetingTime', 'location', 'instructionMode', 'isAsynchronous'
    ];
    
    const csvRows = [headers.join(',')];
    
    sectionData.forEach(section => {
        const row = [
            section.sectionId,
            section.courseId,
            section.subjectCode,
            section.catalogNumber,
            `"${section.instructors.join(', ')}"`,
            section.status,
            section.availableSeats,
            section.waitlistTotal,
            section.capacity,
            section.enrolled,
            `"${section.meetingTime}"`,
            `"${section.location}"`,
            section.instructionMode,
            section.isAsynchronous
        ];
        csvRows.push(row.join(','));
    });
    
    return csvRows.join('\n');
}

function saveToCsvFile(csvData, filename) {
    try {
        fs.writeFileSync(filename, csvData, 'utf8');
        console.log(`CSV data successfully saved to ${filename}`);
        console.log(`Total rows: ${csvData.split('\n').length - 1} (excluding header)`);
    } catch (error) {
        console.error('Error saving CSV file:', error);
    }
}