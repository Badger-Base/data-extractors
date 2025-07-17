import fs from 'fs';

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.5",
  "Content-Type": "application/json",
  "Authorization": "Basic dGVzdDp0ZXN0",
  "Sec-GPC": "1",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Priority": "u=4",
};

async function getAllTeachersAtMadison() {
  const allTeachers = [];
  let hasNextPage = true;
  let cursor = null;
  let pageCount = 0;

  while (hasNextPage) {
    pageCount++;
    console.log(`Fetching page ${pageCount}...`);
    
    const query = `query TeacherSearchResultsPageQuery(
  $query: TeacherSearchQuery!
  $schoolID: ID
  $includeSchoolFilter: Boolean!
  $after: String
) {
  search: newSearch {
    ...TeacherSearchPagination_search_1ZLmLD
  }
  school: node(id: $schoolID) @include(if: $includeSchoolFilter) {
    __typename
    ... on School {
      name
    }
    id
  }
}

fragment TeacherSearchPagination_search_1ZLmLD on newSearch {
  teachers(query: $query, first: 1000, after: $after) {
    didFallback
    edges {
      cursor
      node {
        ...TeacherCard_teacher
        id
        __typename
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
    resultCount
    filters {
      field
      options {
        value
        id
      }
    }
  }
}

fragment TeacherCard_teacher on Teacher {
  id
  legacyId
  avgRating
  numRatings
  ...CardFeedback_teacher
  ...CardSchool_teacher
  ...CardName_teacher
  ...TeacherBookmark_teacher
}

fragment CardFeedback_teacher on Teacher {
  wouldTakeAgainPercent
  avgDifficulty
}

fragment CardSchool_teacher on Teacher {
  department
  school {
    name
    id
  }
}

fragment CardName_teacher on Teacher {
  firstName
  lastName
}

fragment TeacherBookmark_teacher on Teacher {
  id
  isSaved
}`;

    try {
      const response = await fetch("https://www.ratemyprofessors.com/graphql", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          query,
          variables: {
            query: {
              text: "",
              schoolID: "U2Nob29sLTE4NDE4",
              fallback: true,
              departmentID: null
            },
            schoolID: "U2Nob29sLTE4NDE4",
            includeSchoolFilter: true,
            after: cursor
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.errors) {
        console.error("GraphQL errors:", data.errors);
        break;
      }

      const teachers = data.data.search.teachers;
      
      if (!teachers || !teachers.edges) {
        console.log("No more teachers found");
        break;
      }

      console.log(`Found ${teachers.edges.length} teachers on page ${pageCount}`);
      allTeachers.push(...teachers.edges);
      
      hasNextPage = teachers.pageInfo.hasNextPage;
      cursor = teachers.pageInfo.endCursor;
      
      console.log(`Total teachers so far: ${allTeachers.length}`);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error("Error fetching teachers:", error);
      break;
    }
  }

  console.log(`\nCompleted! Total teachers found: ${allTeachers.length}`);
  return allTeachers;
}

function escapeSQL(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (typeof value === 'number') {
    return isNaN(value) ? 'NULL' : value;
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function generateSQLDump(teachers) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let sql = '';
  
  // SQL Header
  sql += `-- RateMyProfessor Teachers Data for UW-Madison\n`;
  sql += `-- Generated on: ${new Date().toISOString()}\n`;
  sql += `-- Total records: ${teachers.length}\n\n`;
  
  // Create table
  sql += `-- Create table structure\n`;
  sql += `DROP TABLE IF EXISTS rmp_teachers;\n\n`;
  sql += `CREATE TABLE rmp_teachers (\n`;
  sql += `    uid VARCHAR(255) PRIMARY KEY,\n`;
  sql += `    first_name VARCHAR(255),\n`;
  sql += `    last_name VARCHAR(255),\n`;
  sql += `    department VARCHAR(255),\n`;
  sql += `    avg_rating DECIMAL(3,2),\n`;
  sql += `    num_ratings INTEGER,\n`;
  sql += `    avg_difficulty DECIMAL(3,2),\n`;
  sql += `    would_take_again_percent DECIMAL(5,2),\n`;
  sql += `    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n`;
  sql += `);\n\n`;
  
  // Insert data
  sql += `-- Insert teacher data\n`;
  sql += `INSERT INTO rmp_teachers (\n`;
  sql += `    uid,first_name, last_name, department,\n`;
  sql += `    avg_rating, num_ratings, avg_difficulty, would_take_again_percent,\n`;
  sql += `) VALUES\n`;
  
  const values = teachers.map((teacher, index) => {
    const node = teacher.node;
    const values = [
      escapeSQL(node.id),
      escapeSQL(node.firstName),
      escapeSQL(node.lastName),
      escapeSQL(node.department),
      escapeSQL(node.avgRating),
      escapeSQL(node.numRatings),
      escapeSQL(node.avgDifficulty),
      escapeSQL(node.wouldTakeAgainPercent),
    ];
    
    const isLast = index === teachers.length - 1;
    return `(${values.join(', ')})${isLast ? ';' : ','}`;
  });
  
  sql += values.join('\n');
  
  // Add indexes for better performance
  sql += `\n\n-- Create indexes for better query performance\n`;
  sql += `CREATE INDEX idx_rmp_teachers_last_name ON rmp_teachers(last_name);\n`;
  sql += `CREATE INDEX idx_rmp_teachers_department ON rmp_teachers(department);\n`;
  sql += `CREATE INDEX idx_rmp_teachers_avg_rating ON rmp_teachers(avg_rating);\n`;
  sql += `CREATE INDEX idx_rmp_teachers_num_ratings ON rmp_teachers(num_ratings);\n\n`;
  
  // Add some useful queries as comments
  sql += `-- Sample queries:\n`;
  sql += `-- SELECT * FROM rmp_teachers WHERE avg_rating > 4.0 ORDER BY avg_rating DESC;\n`;
  sql += `-- SELECT department, COUNT(*) as teacher_count, AVG(avg_rating) as dept_avg_rating FROM rmp_teachers GROUP BY department ORDER BY dept_avg_rating DESC;\n`;
  sql += `-- SELECT * FROM rmp_teachers WHERE last_name LIKE 'Smith%';\n`;
  sql += `-- SELECT * FROM rmp_teachers WHERE num_ratings > 50 AND avg_rating > 4.0;\n`;
  
  return sql;
}

async function saveTeachersToFile() {
  try {
    const teachers = await getAllTeachersAtMadison();

    const simplifiedTeachers = teachers.map(teacher => ({
        id: teacher.node.id,
        legacyId: teacher.node.legacyId,
        firstName: teacher.node.firstName,
        lastName: teacher.node.lastName,
        department: teacher.node.department,
        avgRating: teacher.node.avgRating,
        numRatings: teacher.node.numRatings,
        avgDifficulty: teacher.node.avgDifficulty,
        wouldTakeAgainPercent: teacher.node.wouldTakeAgainPercent,
      }));

    const csvFilename = `madison_teachers_${new Date().toISOString().split('T')[0]}.csv`;
    const csvHeader = 'ID,LegacyID,FirstName,LastName,Department,AvgRating,NumRatings,AvgDifficulty,WouldTakeAgainPercent\n';
    const csvRows = simplifiedTeachers.map(teacher => 
      `"${teacher.id}","${teacher.legacyId}","${teacher.firstName}","${teacher.lastName}","${teacher.department}","${teacher.avgRating}","${teacher.numRatings}","${teacher.avgDifficulty}","${teacher.wouldTakeAgainPercent}"`
    ).join('\n');

    fs.writeFileSync(csvFilename, csvHeader + csvRows);



    

    const dateStr = new Date().toISOString().split('T')[0];
    const sqlFilename = `madison_teachers_${dateStr}.sql`;

    const sqlDump = generateSQLDump(teachers);
    fs.writeFileSync(sqlFilename, sqlDump);
    console.log(`Saved SQL dump with ${teachers.length} teachers to ${sqlFilename}`);

  } catch (error) {
    console.error("Error in saveTeachersToFile:", error);
  }
}

// Run the scraper
saveTeachersToFile().then(() => {
  console.log("Script completed successfully!");
}).catch(error => {
  console.error("Script failed:", error);
});