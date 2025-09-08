# API Documentation

This document provides detailed information about the APIs used by the UW-Madison Data Extractors.

## MadGrades API

### Base URL
`https://api.madgrades.com/v1`

### Authentication
- **Type**: Token-based
- **Header**: `Authorization: Token token=YOUR_TOKEN`

### Endpoints

#### Get All Courses
```
GET /courses?page={page}&per_page={per_page}
```

**Parameters:**
- `page` (int): Page number (starts at 1)
- `per_page` (int): Items per page (max 500)

**Response:**
```json
{
  "results": [
    {
      "uuid": "course-uuid",
      "number": "101",
      "name": "Introduction to Computer Science",
      "subjects": [
        {
          "abbreviation": "COMP SCI"
        }
      ]
    }
  ],
  "nextPageUrl": "url-to-next-page-or-null"
}
```

#### Get Course Grades
```
GET /courses/{uuid}/grades
```

**Response:**
```json
{
  "courseUuid": "course-uuid",
  "cumulative": {
    "aCount": 150,
    "abCount": 120,
    "bCount": 100,
    "bcCount": 80,
    "cCount": 50,
    "dCount": 20,
    "fCount": 10
  },
  "courseOfferings": [
    {
      "cumulative": {
        "aCount": 25,
        "abCount": 20,
        // ... similar structure
      }
    }
  ]
}
```

### Rate Limits
- Recommended: 100ms delay between requests
- Batch processing: 100 courses per batch

## Course Search & Enroll API

### Base URL
`https://api.wisc.edu/course-search-and-enroll/v1` (example)

### Authentication
- **Type**: Basic Authentication
- **Header**: `Authorization: Basic dGVzdDp0ZXN0`

### Headers
```javascript
{
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.5",
  "Content-Type": "application/json",
  "Authorization": "Basic dGVzdDp0ZXN0",
  "Sec-GPC": "1"
}
```

### Endpoints

#### Get Courses
```
GET /courses
```

**Response:**
```json
{
  "courses": [
    {
      "courseId": "unique-id",
      "subject": { "subjectCode": "COMP SCI" },
      "courseDesignation": "101",
      "fullCourseDesignation": "COMP SCI 101",
      "minimumCredits": 3,
      "maximumCredits": 3,
      "title": "Introduction to Computer Science",
      "description": "Course description...",
      "enrollmentPrerequisites": "Prerequisites...",
      "generalEd": { "code": "QR" },
      "ethnicStudies": null,
      "lettersAndScienceCredits": { "code": "Y" },
      "breadths": [{ "code": "P" }],
      "levels": [{ "code": "Elementary" }]
    }
  ]
}
```

#### Get Sections
```
GET /sections/{courseId}
```

**Response:**
```json
{
  "sections": [
    {
      "enrollmentClassNumber": "12345",
      "courseId": "course-id",
      "subjectCode": "COMP SCI",
      "catalogNumber": "101",
      "sections": [
        {
          "instructors": [
            {
              "name": {
                "first": "John",
                "last": "Doe"
              }
            }
          ],
          "instructionMode": "In Person",
          "enrollmentStatus": {
            "capacity": 30,
            "currentlyEnrolled": 25
          }
        }
      ],
      "packageEnrollmentStatus": {
        "status": "OPEN",
        "availableSeats": 5,
        "waitlistTotal": 0
      },
      "classMeetings": [
        {
          "meetingDays": "MWF",
          "meetingTimeStart": 32400000,
          "meetingTimeEnd": 36000000,
          "building": {
            "buildingName": "Computer Sciences"
          },
          "room": "1240"
        }
      ]
    }
  ]
}
```

### Rate Limits
- Recommended: 100ms delay between requests
- Batch processing: 50 courses per batch

## Rate My Professor GraphQL API

### Base URL
`https://www.ratemyprofessors.com/graphql`

### Headers
```javascript
{
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.5",
  "Content-Type": "application/json",
  "Sec-GPC": "1",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Priority": "u=4"
}
```

### School ID
- **UW-Madison**: `U2Nob29sLTE4NDI=`

### GraphQL Query
```graphql
query TeacherSearchResultsPageQuery(
  $query: TeacherSearchQuery!
  $schoolID: ID
  $includeSchoolFilter: Boolean!
  $after: String
) {
  search: newSearch {
    teachers(query: $query, first: 1000, after: $after) {
      didFallback
      edges {
        cursor
        node {
          id
          legacyId
          avgRating
          numRatings
          wouldTakeAgainPercent
          avgDifficulty
          department
          firstName
          lastName
          school {
            name
            id
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      resultCount
    }
  }
  school: node(id: $schoolID) @include(if: $includeSchoolFilter) {
    __typename
    ... on School {
      name
    }
    id
  }
}
```

### Variables
```json
{
  "query": {
    "text": "",
    "schoolID": "U2Nob29sLTE4NDI=",
    "fallback": true,
    "departmentID": null
  },
  "schoolID": "U2Nob29sLTE4NDI=",
  "includeSchoolFilter": true,
  "after": null
}
```

### Response
```json
{
  "data": {
    "search": {
      "teachers": {
        "edges": [
          {
            "cursor": "cursor-string",
            "node": {
              "id": "teacher-id",
              "legacyId": "123456",
              "avgRating": 4.5,
              "numRatings": 25,
              "wouldTakeAgainPercent": 85.7,
              "avgDifficulty": 3.2,
              "department": "Computer Science",
              "firstName": "John",
              "lastName": "Doe",
              "school": {
                "name": "University of Wisconsin - Madison",
                "id": "U2Nob29sLTE4NDI="
              }
            }
          }
        ],
        "pageInfo": {
          "hasNextPage": true,
          "endCursor": "next-cursor"
        },
        "resultCount": 1500
      }
    }
  }
}
```

### Rate Limits
- Be respectful of rate limits
- Implement delays between requests
- Use pagination cursors properly

## Error Handling

### Common HTTP Status Codes
- `200 OK`: Successful request
- `400 Bad Request`: Invalid parameters
- `401 Unauthorized`: Authentication failed
- `403 Forbidden`: Access denied
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Server error

### Retry Strategy
1. Exponential backoff for 5xx errors
2. Respect rate limits for 429 errors
3. Log all errors for debugging
4. Maximum retry attempts: 3

### Example Error Response
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please wait before retrying.",
    "details": {
      "retryAfter": 60
    }
  }
}
```

## Security Considerations

1. **API Keys**: Store in environment variables, never in code
2. **Rate Limiting**: Respect API rate limits to avoid blocking
3. **Data Privacy**: Follow university data policies
4. **Error Logging**: Don't log sensitive information
5. **HTTPS**: Always use HTTPS for API requests

## Testing

### Mock Data
Each extractor includes mock data for testing without API calls.

### Environment Variables
Set `NODE_ENV=development` and `DEBUG=true` for verbose logging.

### Rate Limit Testing
Use smaller batch sizes and longer delays during development.
