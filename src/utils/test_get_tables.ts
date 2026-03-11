import mysql, { RowDataPacket } from 'mysql2/promise';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const args = process.argv.slice(2);

if (args.length > 0) {
    console.log("Received arguments:");
    args.forEach((arg, index) => {
      console.log(`Argument ${index + 1}: ${arg}`);
    });
  } else {
    console.log("No arguments provided.");
  }



console.log(process.env.DB_HOST);
console.log(process.env.DB_USER);
console.log(process.env.DB_PASSWORD);
console.log(process.env.DB_NAME);
console.log(process.env.DB_PORT);



const connection: mysql.Connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || '3306'),
});

try {
    const tableNames = await getTableNames();
    console.log('Table names:', tableNames);
} finally {
    await connection.end();
}

async function getTableNames() {
  
  const [rows] = await connection.execute(
    `
    SELECT 
      column_name,
      data_type,
      character_maximum_length,
      numeric_precision,
      numeric_scale
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
    AND table_name = ?
    ORDER BY ordinal_position
  `,
    ['courses']
  );
  const result = rows as Array<{
    COLUMN_NAME: string;
    DATA_TYPE: string;
    CHARACTER_MAXIMUM_LENGTH: number | null;
    NUMERIC_PRECISION: number | null;
    NUMERIC_SCALE: number | null;
  }>;

  return result.map((row) => ({
    column_name: row.COLUMN_NAME,
    data_type: row.DATA_TYPE,
    character_maximum_length: row.CHARACTER_MAXIMUM_LENGTH,
    numeric_precision: row.NUMERIC_PRECISION,
    numeric_scale: row.NUMERIC_SCALE,
  }));

}
