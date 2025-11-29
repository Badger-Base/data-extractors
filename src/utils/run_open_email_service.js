import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const ELASTIC_EMAIL_API_KEY = process.env.ELASTIC_EMAIL_API_KEY;
const ELASTIC_EMAIL_API_URL = 'https://api.elasticemail.com/v2/email/send';
const FROM_EMAIL = process.env.FROM_EMAIL || 'notifications@sconniegrades.com';

// Email helper function using ElasticEmail API
async function sendEmail(to, subject, htmlBody) {
    if (!ELASTIC_EMAIL_API_KEY) {
        throw new Error('ELASTIC_EMAIL_API_KEY not configured');
    }

    if (!FROM_EMAIL) {
        throw new Error('FROM_EMAIL not configured');
    }

    const params = new URLSearchParams({
        apikey: ELASTIC_EMAIL_API_KEY,
        from: FROM_EMAIL,
        to: to,
        subject: subject,
        bodyHtml: htmlBody,
        isTransactional: true
    });

    try {
        const response = await fetch(`${ELASTIC_EMAIL_API_URL}?${params}`, {
            method: 'POST'
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`ElasticEmail API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const result = await response.json();
        console.log(`Email sent successfully to ${to}`);
        return result;
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
}

async function getUsersWithOpenSectionsAndCourses() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 3306
    });

    // Example query - adjust to your schema
    const [courses] = await connection.query(`
        SELECT 
            c.course_id as course_id,
            c.full_course_designation as full_course_designation,
            c.course_designation as course_designation,
            c.course_title as course_title,
            c.status as status,
            cs.email as email
        FROM courses c
        JOIN course_subscriptions cs ON c.course_id = cs.course_id
        WHERE c.status != 0
    `);

    const [sections] = await connection.query(`
        SELECT 
            c.full_course_designation as full_course_designation,
            c.course_designation as course_designation,
            c.course_title as course_title,
            s.section_id,
            ss.email as email,
            s.status as status,
            sm.section_number,
            sm.meeting_type
        FROM sections s
        JOIN section_subscriptions ss ON s.section_id = ss.section_id
        JOIN courses c ON s.course_id = c.course_id
        LEFT JOIN section_meetings sm ON s.unique_section_id = sm.unique_section_id
        WHERE s.status != 'CLOSED'
    `);

    await connection.end();
    return { courses, sections };
}



async function main() {
    console.log('Starting email notification service...');
    const startTime = Date.now();

    // Create database connection for deleting subscriptions
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 3306
    });

    try {
        // Get courses and sections with subscriptions
        console.log('Fetching subscriptions...');
        const { courses, sections } = await getUsersWithOpenSectionsAndCourses();
        console.log(`Found ${courses.length} course subscriptions`);
        console.log(`Found ${sections.length} section subscriptions`);

        let sent = 0;
        let failed = 0;
        let groupedSectionsList = [];
        let deleted = 0;
        
        // ======================
        // Send COURSE emails
        // ======================
        console.log('\n📧 Sending course opening emails...');
        for (const course of courses) {
            try {
                // Determine status message based on course.status
                // status: 0 = closed, 1 = waitlisted, 2 = open
                const isFullyOpen = course.status === 2;
                const statusMessage = isFullyOpen 
                    ? 'This course has completely open seats available!'
                    : 'This course has waitlist seats available!';
                const alertType = isFullyOpen ? 'Open' : 'Waitlist Available';
                
                const subject = `${course.full_course_designation} - ${alertType}!`;
                const htmlBody = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #C5050C; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
    .content { background-color: #f9f9f9; padding: 30px; border-radius: 0 0 5px 5px; }
    .course-info { background-color: white; padding: 20px; margin: 20px 0; border-left: 4px solid #C5050C; }
    .button { display: inline-block; padding: 12px 24px; background-color: #C5050C; color: white; text-decoration: none; border-radius: 5px; margin-top: 10px; }
    .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Course ${alertType}</h1>
    </div>
    <div class="content">
      <p>Hello,</p>
      <p>Great news! ${statusMessage}</p>
      <div class="course-info">
        <h2>${course.full_course_designation}</h2>
        <p>${course.course_title}</p>
      </div>
      <p>
        <a href="https://sconniegrades.com/courses/${course.course_id}" class="button">View Course Details</a>
      </p>
      <p>Enroll now before seats fill up!</p>
      <p>Thank you for using BadgerBase!</p>
    </div>
    <div class="footer">
      <p>This is an automated message. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;

                await sendEmail(course.email, subject, htmlBody);
                sent++;
                
                // Delete the subscription after successful send
                try {
                    await connection.execute(
                        'DELETE FROM course_subscriptions WHERE email = ? AND course_id = ?',
                        [course.email, course.course_id]
                    );
                    deleted++;
                    console.log(`  ✓ Deleted course subscription for ${course.email} - ${course.course_id}`);
                } catch (deleteError) {
                    console.error(`  Failed to delete course subscription: ${deleteError.message}`);
                }
                
                // Rate limit: 10 emails per second
                await new Promise(resolve => setTimeout(resolve, 100));
                
                if (sent % 10 === 0) {
                    console.log(`  Sent ${sent} emails...`);
                }
            } catch (error) {
                console.error(`  Failed to send course email to ${course.email}:`, error.message);
                failed++;
            }
        }

        // ======================
        // Send SECTION emails
        // ======================
        console.log('\n📧 Sending section opening emails...');
        
        // Group sections by section_id and email to combine meetings
        const groupedSections = sections.reduce((acc, row) => {
            const key = `${row.section_id}-${row.email}`;
            
            if (!acc[key]) {
                acc[key] = {
                    section_id: row.section_id,
                    email: row.email,
                    full_course_designation: row.full_course_designation,
                    course_designation: row.course_designation,
                    course_title: row.course_title,
                    status: row.status,
                    meetings: []
                };
            }
            
            // Add meeting if it exists and hasn't been added yet
            if (row.section_number && row.meeting_type) {
                const meetingLabel = `${row.meeting_type} ${row.section_number}`;
                if (!acc[key].meetings.includes(meetingLabel)) {
                    acc[key].meetings.push(meetingLabel);
                }
            }
            
            return acc;
        }, {});
        
        groupedSectionsList = Object.values(groupedSections);
        
        for (const section of groupedSectionsList) {
            try {
                // Create comma-separated string of meetings
                const meetingsDisplay = section.meetings.length > 0 
                    ? section.meetings.join(', ') 
                    : section.section_id;
                
                // Determine status message based on section.status
                const isFullyOpen = section.status === 'OPEN';
                const statusMessage = isFullyOpen 
                    ? 'This section has completely open seats available!'
                    : 'This section has waitlist seats available!';
                const alertType = isFullyOpen ? 'Open' : 'Waitlist Available';
                
                const subject = `${section.full_course_designation} Section - ${alertType}!`;
                const htmlBody = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #C5050C; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
    .content { background-color: #f9f9f9; padding: 30px; border-radius: 0 0 5px 5px; }
    .section-info { background-color: white; padding: 20px; margin: 20px 0; border-left: 4px solid #C5050C; }
    .button { display: inline-block; padding: 12px 24px; background-color: #C5050C; color: white; text-decoration: none; border-radius: 5px; margin-top: 10px; }
    .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Section ${alertType}</h1>
    </div>
    <div class="content">
      <p>Hello,</p>
      <p>Great news! ${statusMessage}</p>
      <div class="section-info">
        <h2>${section.full_course_designation}</h2>
        <p>${section.course_title}</p>
        <p><strong>Section:</strong> ${meetingsDisplay}</p>
      </div>
      <p>Enroll now before seats fill up!</p>
      <p>Thank you for using BadgerBase!</p>
    </div>
    <div class="footer">
      <p>This is an automated message. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;

                await sendEmail(section.email, subject, htmlBody);
                sent++;
                
                // Delete the subscription after successful send
                try {
                    await connection.execute(
                        'DELETE FROM section_subscriptions WHERE email = ? AND section_id = ?',
                        [section.email, section.section_id]
                    );
                    deleted++;
                    console.log(`  ✓ Deleted section subscription for ${section.email} - ${section.section_id}`);
                } catch (deleteError) {
                    console.error(`  Failed to delete section subscription: ${deleteError.message}`);
                }
                
                // Rate limit: 10 emails per second
                await new Promise(resolve => setTimeout(resolve, 100));
                
                if (sent % 10 === 0) {
                    console.log(`  Sent ${sent} emails...`);
                }
            } catch (error) {
                console.error(`  Failed to send section email to ${section.email}:`, error.message);
                failed++;
            }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n✅ Email service complete!`);
        console.log(`   Course emails: ${courses.length}`);
        console.log(`   Section emails: ${groupedSectionsList.length}`);
        console.log(`   Total sent: ${sent}`);
        console.log(`   Failed: ${failed}`);
        console.log(`   Subscriptions deleted: ${deleted}`);
        console.log(`   Time: ${elapsed}s`);
        
        await connection.end();
        process.exit(0);
        
    } catch (error) {
        console.error('Email service failed:', error);
        await connection.end();
        process.exit(1);
    }
}

main();