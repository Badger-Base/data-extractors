# Current MySQL Schema

Reverse-engineered from extractors and `api.js`. This is the source of truth for the PostgreSQL migration.

## Tables

### `courses`
Source: `course_search_and_enroll_extractor.js`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| course_id | VARCHAR(50) | | UW system course ID |
| course_uuid | VARCHAR(50) | | Unique identifier used for joins |
| subject_code | VARCHAR(10) | NOT NULL | e.g. "COMP SCI", "MATH" |
| course_designation | VARCHAR(20) | NOT NULL | e.g. "SCI 101" |
| course_title | VARCHAR(100) | | |
| catalog_number | INT | | Numeric part of designation |
| course_description | TEXT | | |
| enrollment_prerequisites | TEXT | | Free text, e.g. "None", "Sophomore standing" |
| letters_and_science_credits | VARCHAR(1) | | "C" if counts |
| full_course_designation | VARCHAR(100) | | e.g. "COMP SCI 101" |
| minimum_credits | INT | | |
| maximum_credits | INT | | |
| general_education | VARCHAR(10) | | |
| ethnic_studies | VARCHAR(10) | | "ETHNIC ST" if qualifies |
| social_science | VARCHAR(10) | | "S" if qualifies |
| humanities | VARCHAR(10) | | "H" if qualifies |
| biological_science | VARCHAR(10) | | "B" if qualifies |
| physical_science | VARCHAR(10) | | "P" if qualifies |
| natural_science | VARCHAR(10) | | "N" if qualifies |
| literature | VARCHAR(10) | | "L" if qualifies |
| level | VARCHAR(10) | | e.g. "Elementary" |
| typically_offered | VARCHAR(100) | | |
| workplace_experience_description | VARCHAR(100) | | |
| grading_basis_description | VARCHAR(50) | | |
| open_to_first_year | VARCHAR(1) | | |
| repeatable_for_credit | VARCHAR(1) | | |
| status | INT | DEFAULT 0 | 0=closed, 1=waitlisted, 2=open |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | |

**No primary key defined.** No indexes.

---

### `sections`
Source: `course_search_and_enroll_extractor.js`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| section_id | VARCHAR(50) | | |
| unique_section_id | VARCHAR(50) | | Used for meeting/instructor joins |
| course_id | VARCHAR(50) | NOT NULL | FK to courses.course_id |
| course_uuid | VARCHAR(50) | | FK to courses.course_uuid |
| subject_code | VARCHAR(10) | NOT NULL | |
| catalog_number | VARCHAR(20) | | |
| status | VARCHAR(20) | | "OPEN", "CLOSED", "WAITLISTED" |
| available_seats | INT | | |
| waitlist_total | INT | | |
| capacity | INT | | |
| enrolled | INT | | |
| instruction_mode | VARCHAR(50) | | |
| is_asynchronous | VARCHAR(5) | | |
| section_requisites | TEXT | | |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | |

**No primary key defined.** No indexes.

---

### `section_instructors`
Source: `course_search_and_enroll_extractor.js`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | INT | AUTO_INCREMENT PRIMARY KEY | |
| section_id | VARCHAR(50) | NOT NULL | FK to sections.section_id |
| unique_section_id | VARCHAR(50) | NOT NULL | |
| instructor_name | VARCHAR(100) | NOT NULL | Joined to rmp_cleaned.full_name |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | |

---

### `section_meetings`
Source: `course_search_and_enroll_extractor.js`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | INT | AUTO_INCREMENT PRIMARY KEY | |
| section_id | VARCHAR(50) | NOT NULL | FK to sections.section_id |
| unique_section_id | VARCHAR(50) | NOT NULL | FK to sections.unique_section_id |
| section_number | VARCHAR(10) | | |
| meeting_type | VARCHAR(50) | NOT NULL | |
| meeting_number | INT | | |
| meeting_days | VARCHAR(10) | | e.g. "MWF", "TR" |
| start_time | VARCHAR(10) | | Human-readable |
| end_time | VARCHAR(10) | | Human-readable |
| building_name | VARCHAR(100) | | |
| room | VARCHAR(100) | | |
| location | VARCHAR(100) | | "ONLINE", "OFF CAMPUS", or building |
| monday_meeting_start | INT | | Milliseconds from midnight |
| monday_meeting_end | INT | | Milliseconds from midnight |
| tuesday_meeting_start | INT | | |
| tuesday_meeting_end | INT | | |
| wednesday_meeting_start | INT | | |
| wednesday_meeting_end | INT | | |
| thursday_meeting_start | INT | | |
| thursday_meeting_end | INT | | |
| friday_meeting_start | INT | | |
| friday_meeting_end | INT | | |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | |

---

### `subjects`
Source: `course_search_and_enroll_extractor.js`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| subject_code | VARCHAR(10) | PRIMARY KEY | |
| footnotes | TEXT | | |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | |

---

### `madgrades_course_grades`
Source: `madgrades_extractor.js`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | SERIAL | PRIMARY KEY | Auto-increment |
| course_uuid | VARCHAR(255) | NOT NULL | Madgrades UUID (not same as courses.course_uuid) |
| course_name | VARCHAR(255) | NOT NULL | Joined to courses.course_designation |
| cumulative_gpa | DECIMAL(3,2) | | |
| most_recent_gpa | DECIMAL(3,2) | | |
| median_grade | VARCHAR(255) | | e.g. "A", "AB", "B" |
| a_percentage | DECIMAL(3,2) | | |
| ab_percentage | DECIMAL(3,2) | | |
| b_percentage | DECIMAL(3,2) | | |
| bc_percentage | DECIMAL(3,2) | | |
| c_percentage | DECIMAL(3,2) | | |
| d_percentage | DECIMAL(3,2) | | |
| f_percentage | DECIMAL(3,2) | | |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | |

**Indexes:** `idx_madgrades_course_grades_uuid(course_uuid)`, `idx_madgrades_course_grades_cumulative(cumulative_gpa)`, `idx_madgrades_course_grades_recent(most_recent_gpa)`

---

### `rmp_cleaned`
Source: `rmp_preprocessor.py` (processed from `rmp_teachers`)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | VARCHAR(255) | PRIMARY KEY | Base64-encoded RMP teacher ID |
| legacy_id | VARCHAR(100) | | Numeric RMP ID |
| first_name | VARCHAR(100) | | Cleaned/normalized |
| last_name | VARCHAR(100) | | Cleaned/normalized |
| full_name | VARCHAR(200) | | Joined to section_instructors.instructor_name |
| department | VARCHAR(100) | | |
| avg_rating | FLOAT | | 0-5 scale |
| num_ratings | INT | | |
| avg_difficulty | FLOAT | | 0-5 scale |
| would_take_again_percent | FLOAT | | 0-100 |

---

### `rmp_teachers` (raw, pre-processing)
Source: `rmp-extractor.js`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| uid | VARCHAR(255) | PRIMARY KEY | |
| first_name | VARCHAR(255) | | |
| last_name | VARCHAR(255) | | |
| department | VARCHAR(255) | | |
| avg_rating | DECIMAL(3,2) | | |
| num_ratings | INTEGER | | |
| avg_difficulty | DECIMAL(3,2) | | |
| would_take_again_percent | DECIMAL(5,2) | | |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | |

---

## Relationships (implicit, no foreign keys enforced)

```
subjects.subject_code ←── courses.subject_code
courses.course_uuid ←── sections.course_uuid
courses.course_id ←── sections.course_id
sections.section_id ←── section_instructors.section_id
sections.unique_section_id ←── section_meetings.unique_section_id
courses.course_designation ←── madgrades_course_grades.course_name  (string join!)
section_instructors.instructor_name ←── rmp_cleaned.full_name  (string join!)
```

## Key observations

1. **No foreign keys enforced** — all relationships are implicit via string matching in queries.
2. **No primary keys on courses or sections** — the two largest tables have no PK.
3. **String-based joins** — `courses.course_designation = madgrades_course_grades.course_name` and `instructor_name = rmp_cleaned.full_name` are fragile string matches.
4. **Inconsistent types** — `courses.status` is INT (0/1/2), `sections.status` is VARCHAR ("OPEN"/"CLOSED").
5. **Breadth designators stored as single chars** — social_science="S", humanities="H", etc. Could be booleans or an enum.
6. **Day-specific meeting columns** — 10 INT columns for monday–friday start/end times (milliseconds). Could be normalized into a meetings-per-day table.
7. **rmp_teachers vs rmp_cleaned** — raw extraction table gets preprocessed into cleaned version. Only `rmp_cleaned` is used by the API.
8. **DECIMAL(3,2) for percentages** — max value 9.99, but percentages can be 0–100. Likely should be DECIMAL(5,2).
