# Data Schema Documentation

This document describes the data schemas for each extractor in the UW-Madison Data Extractors system.

## MadGrades Data Schema

### Grades Table
- `uuid` (VARCHAR): Course UUID from MadGrades API
- `cumulative_gpa` (DECIMAL): Cumulative GPA for the course
- `most_recent_gpa` (DECIMAL): Most recent offering GPA
- `median_grade` (VARCHAR): Median letter grade
- `a_percentage` (DECIMAL): Percentage of A grades
- `ab_percentage` (DECIMAL): Percentage of AB grades
- `b_percentage` (DECIMAL): Percentage of B grades
- `bc_percentage` (DECIMAL): Percentage of BC grades
- `c_percentage` (DECIMAL): Percentage of C grades
- `d_percentage` (DECIMAL): Percentage of D grades
- `f_percentage` (DECIMAL): Percentage of F grades
- `extracted_at` (TIMESTAMP): When data was extracted

## Course Search & Enroll Data Schema

### Courses Table
- `course_id` (VARCHAR): Unique course identifier
- `subject_code` (VARCHAR): Subject abbreviation (e.g., 'COMP SCI')
- `course_designation` (VARCHAR): Course number designation
- `full_course_designation` (VARCHAR): Full course code
- `minimum_credits` (INT): Minimum credit hours
- `maximum_credits` (INT): Maximum credit hours
- `title` (VARCHAR): Course title
- `description` (TEXT): Course description
- `enrollment_prerequisites` (TEXT): Prerequisites
- `general_education` (VARCHAR): GenEd requirements
- `ethnic_studies` (BOOLEAN): Ethnic studies requirement
- `letters_and_science_credits` (BOOLEAN): L&S credit eligible
- `breadths` (JSON): Breadth requirements
- `levels` (JSON): Course levels
- `extracted_at` (TIMESTAMP): When data was extracted

### Sections Table
- `section_id` (VARCHAR): Unique section identifier
- `course_id` (VARCHAR): Foreign key to courses table
- `subject_code` (VARCHAR): Subject abbreviation
- `catalog_number` (VARCHAR): Catalog number
- `instructors` (JSON): Array of instructor names
- `status` (VARCHAR): Enrollment status (OPEN, CLOSED, WAITLIST)
- `available_seats` (INT): Available seats
- `waitlist_total` (INT): Waitlist count
- `capacity` (INT): Total capacity
- `enrolled` (INT): Currently enrolled
- `meeting_time` (VARCHAR): Meeting schedule
- `location` (VARCHAR): Meeting location
- `instruction_mode` (VARCHAR): Mode of instruction
- `is_asynchronous` (BOOLEAN): Asynchronous delivery
- `extracted_at` (TIMESTAMP): When data was extracted

## Rate My Professor Data Schema

### Teachers Table
- `id` (VARCHAR): RMP teacher ID
- `legacy_id` (VARCHAR): Legacy RMP ID
- `first_name` (VARCHAR): Teacher's first name
- `last_name` (VARCHAR): Teacher's last name
- `department` (VARCHAR): Academic department
- `avg_rating` (DECIMAL): Average rating (1-5)
- `num_ratings` (INT): Number of ratings
- `avg_difficulty` (DECIMAL): Average difficulty (1-5)
- `would_take_again_percent` (DECIMAL): Would take again percentage
- `extracted_at` (TIMESTAMP): When data was extracted

### Processed Teachers Table (after preprocessing)
- `id` (VARCHAR): RMP teacher ID
- `standardized_first_name` (VARCHAR): Cleaned first name
- `standardized_last_name` (VARCHAR): Cleaned last name
- `standardized_department` (VARCHAR): Mapped department name
- `department_codes` (JSON): Array of possible department codes
- `name_variations` (JSON): Array of name variations
- `confidence_score` (DECIMAL): Matching confidence score
- `avg_rating` (DECIMAL): Average rating
- `num_ratings` (INT): Number of ratings
- `avg_difficulty` (DECIMAL): Average difficulty
- `would_take_again_percent` (DECIMAL): Would take again percentage
- `processed_at` (TIMESTAMP): When data was processed

## Data Relationships

### Course-Grade Relationship
Courses can be linked to grades using the MadGrades UUID when available.

### Course-Section Relationship
Sections belong to courses via the `course_id` foreign key.

### Section-Teacher Relationship
Teachers can be linked to sections through instructor names (fuzzy matching may be required).

## Data Quality Notes

### MadGrades
- Some courses may not have grade data available
- Historical data goes back several years
- GPA calculations exclude withdrawals and incompletes

### Course Search & Enroll
- Data reflects current academic year offerings
- Section data changes frequently during registration periods
- Some courses may have multiple sections with different instructors

### Rate My Professor
- Not all instructors may be present in RMP
- Ratings are subjective and may not represent all students
- Department mappings may require manual verification
- Name matching between systems may need fuzzy logic

## Database Indexes

Recommended indexes for optimal performance:

```sql
-- Courses
CREATE INDEX idx_courses_subject ON courses(subject_code);
CREATE INDEX idx_courses_designation ON courses(course_designation);

-- Sections
CREATE INDEX idx_sections_course_id ON sections(course_id);
CREATE INDEX idx_sections_status ON sections(status);

-- Teachers
CREATE INDEX idx_teachers_department ON teachers(department);
CREATE INDEX idx_teachers_name ON teachers(last_name, first_name);

-- Grades
CREATE INDEX idx_grades_uuid ON grades(uuid);
```
