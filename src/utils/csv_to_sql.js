import fs from 'fs';
import path from 'path';

/**
 * Escape a value for SQL insertion
 */
function escapeSqlValue(value) {
    if (value === null || value === undefined || value === '') {
        return 'NULL';
    }
    const str = String(value).trim();
    // If it's a number, return as-is
    if (!isNaN(str) && str !== '') {
        return str;
    }
    // Otherwise, escape as string
    return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Detect SQL data type from a sample of values
 */
function detectDataType(values) {
    // Check if all values are numeric
    const numericValues = values.filter(v => {
        const trimmed = String(v).trim();
        return trimmed !== '' && !isNaN(trimmed);
    });
    
    if (numericValues.length === values.length) {
        // Check if they're integers or floats
        const hasDecimals = numericValues.some(v => String(v).includes('.'));
        return hasDecimals ? 'DOUBLE' : 'INT';
    }
    
    // Default to VARCHAR for mixed/non-numeric data
    const maxLength = Math.max(...values.map(v => String(v).length));
    return `VARCHAR(${Math.max(255, Math.ceil(maxLength / 50) * 50)})`; // Round up to nearest 50
}

/**
 * Convert CSV file to MySQL dump
 */
function csvToSqlDump(inputPath, outputPath, tableName = null) {
    // Read CSV file
    const csvContent = fs.readFileSync(inputPath, 'utf8');
    const lines = csvContent.trim().split('\n').filter(line => line.trim() !== '');
    
    if (lines.length === 0) {
        throw new Error('CSV file is empty');
    }
    
    // Parse header
    const headers = lines[0].split(',').map(h => h.trim());
    
    // Parse data rows
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        if (values.length !== headers.length) {
            console.warn(`Warning: Row ${i + 1} has ${values.length} columns, expected ${headers.length}. Skipping.`);
            continue;
        }
        rows.push(values);
    }
    
    // Generate table name from filename if not provided
    if (!tableName) {
        const filename = path.basename(inputPath, '.csv');
        tableName = filename.replace(/[^a-zA-Z0-9_]/g, '_'); // Replace invalid chars with underscore
    }
    
    // Detect data types for each column
    const columnTypes = [];
    for (let colIdx = 0; colIdx < headers.length; colIdx++) {
        const columnValues = rows.map(row => row[colIdx]);
        const dataType = detectDataType(columnValues);
        columnTypes.push(dataType);
    }
    
    // Generate SQL dump
    const timestamp = new Date().toISOString();
    let sqlDump = `-- MySQL dump generated from CSV file
-- Source file: ${inputPath}
-- Generated on: ${timestamp}
-- Table: ${tableName}
-- Rows: ${rows.length}

DROP TABLE IF EXISTS ${tableName};

CREATE TABLE ${tableName} (
${headers.map((header, idx) => `    ${header} ${columnTypes[idx]}`).join(',\n')},
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert data
`;
    
    // Generate INSERT statements in batches (500 rows per INSERT)
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        
        sqlDump += `INSERT INTO ${tableName} (${headers.join(', ')}) VALUES\n`;
        
        const valueStrings = batch.map(row => {
            const values = row.map(val => escapeSqlValue(val));
            return `(${values.join(', ')})`;
        });
        
        sqlDump += valueStrings.join(',\n');
        sqlDump += ';\n\n';
    }
    
    // Write SQL dump file
    fs.writeFileSync(outputPath, sqlDump);
    console.log(`✅ SQL dump generated: ${outputPath}`);
    console.log(`   Table: ${tableName}`);
    console.log(`   Columns: ${headers.length}`);
    console.log(`   Rows: ${rows.length}`);
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0) {
    console.error('Usage: node csv_to_sql.js <input_csv> [output_sql] [table_name]');
    console.error('Example: node csv_to_sql.js data/csv/data.csv data/sql/data.sql data_table');
    process.exit(1);
}

const inputPath = args[0];
let outputPath = args[1];
let tableName = args[2] || null;

// Generate output path if not provided
if (!outputPath) {
    const inputDir = path.dirname(inputPath);
    const inputBasename = path.basename(inputPath, '.csv');
    const sqlDir = inputDir.replace('/csv', '/sql');
    
    // Ensure sql directory exists
    if (!fs.existsSync(sqlDir)) {
        fs.mkdirSync(sqlDir, { recursive: true });
    }
    
    outputPath = path.join(sqlDir, `${inputBasename}.sql`);
}

try {
    csvToSqlDump(inputPath, outputPath, tableName);
} catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
}
