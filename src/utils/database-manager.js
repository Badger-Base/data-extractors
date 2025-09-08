import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

/**
 * Database utility class for managing UW-Madison data
 */
class DatabaseManager {
    constructor() {
        this.config = {
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            port: process.env.DB_PORT || 3306,
            multipleStatements: true
        };
    }

    /**
     * Create a database connection
     */
    async connect() {
        try {
            this.connection = await mysql.createConnection(this.config);
            console.log('Database connected successfully');
            return this.connection;
        } catch (error) {
            console.error('Database connection failed:', error);
            throw error;
        }
    }

    /**
     * Close database connection
     */
    async disconnect() {
        if (this.connection) {
            await this.connection.end();
            console.log('Database connection closed');
        }
    }

    /**
     * Execute SQL dump file
     */
    async executeSqlFile(filePath) {
        try {
            const sqlContent = await fs.readFile(filePath, 'utf8');
            const [results] = await this.connection.execute(sqlContent);
            console.log(`SQL file ${filePath} executed successfully`);
            return results;
        } catch (error) {
            console.error(`Error executing SQL file ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Backup database tables to SQL files
     */
    async backupTables(tables, outputDir = './data/sql/backups') {
        try {
            // Ensure backup directory exists
            await fs.mkdir(outputDir, { recursive: true });

            for (const table of tables) {
                const [rows] = await this.connection.execute(`SELECT * FROM ${table}`);
                
                if (rows.length === 0) {
                    console.log(`Table ${table} is empty, skipping backup`);
                    continue;
                }

                // Generate SQL dump
                let sqlDump = `-- Backup of ${table} table\n`;
                sqlDump += `-- Generated on ${new Date().toISOString()}\n\n`;
                sqlDump += `DELETE FROM ${table};\n\n`;

                // Get column names
                const columns = Object.keys(rows[0]);
                
                for (const row of rows) {
                    const values = columns.map(col => {
                        const value = row[col];
                        if (value === null) return 'NULL';
                        if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
                        if (value instanceof Date) return `'${value.toISOString()}'`;
                        return value;
                    });

                    sqlDump += `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});\n`;
                }

                const backupFile = path.join(outputDir, `${table}_backup_${new Date().toISOString().split('T')[0]}.sql`);
                await fs.writeFile(backupFile, sqlDump);
                console.log(`Table ${table} backed up to ${backupFile}`);
            }
        } catch (error) {
            console.error('Error during backup:', error);
            throw error;
        }
    }

    /**
     * Get table statistics
     */
    async getTableStats(tables) {
        const stats = {};
        
        for (const table of tables) {
            try {
                const [countResult] = await this.connection.execute(`SELECT COUNT(*) as count FROM ${table}`);
                const [sizeResult] = await this.connection.execute(`
                    SELECT 
                        ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb
                    FROM information_schema.tables 
                    WHERE table_schema = ? AND table_name = ?
                `, [this.config.database, table]);

                stats[table] = {
                    rowCount: countResult[0].count,
                    sizeMB: sizeResult[0]?.size_mb || 0
                };
            } catch (error) {
                console.error(`Error getting stats for table ${table}:`, error);
                stats[table] = { error: error.message };
            }
        }

        return stats;
    }

    /**
     * Clean old data based on date column
     */
    async cleanOldData(table, dateColumn, daysToKeep = 30) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

            const [result] = await this.connection.execute(`
                DELETE FROM ${table} 
                WHERE ${dateColumn} < ?
            `, [cutoffDate]);

            console.log(`Cleaned ${result.affectedRows} old records from ${table}`);
            return result.affectedRows;
        } catch (error) {
            console.error(`Error cleaning old data from ${table}:`, error);
            throw error;
        }
    }
}

/**
 * Command line interface for database operations
 */
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command) {
        console.log(`
Usage: node src/utils/database-manager.js <command> [args]

Commands:
  stats                     - Show table statistics
  backup <table1,table2>    - Backup specified tables
  clean <table> <column>    - Clean old data (keeps last 30 days)
  execute <sql_file>        - Execute SQL file
  
Examples:
  node src/utils/database-manager.js stats
  node src/utils/database-manager.js backup courses,sections
  node src/utils/database-manager.js execute data/sql/dump.sql
        `);
        return;
    }

    const dbManager = new DatabaseManager();
    
    try {
        await dbManager.connect();

        switch (command) {
            case 'stats':
                const tables = ['courses', 'sections', 'teachers', 'grades']; // Add your table names
                const stats = await dbManager.getTableStats(tables);
                console.log('\nTable Statistics:');
                console.table(stats);
                break;

            case 'backup':
                if (!args[1]) {
                    console.error('Please specify tables to backup (comma-separated)');
                    return;
                }
                const tablesToBackup = args[1].split(',').map(t => t.trim());
                await dbManager.backupTables(tablesToBackup);
                break;

            case 'clean':
                if (!args[1] || !args[2]) {
                    console.error('Please specify table and date column');
                    return;
                }
                await dbManager.cleanOldData(args[1], args[2]);
                break;

            case 'execute':
                if (!args[1]) {
                    console.error('Please specify SQL file path');
                    return;
                }
                await dbManager.executeSqlFile(args[1]);
                break;

            default:
                console.error(`Unknown command: ${command}`);
        }
    } catch (error) {
        console.error('Operation failed:', error);
        process.exit(1);
    } finally {
        await dbManager.disconnect();
    }
}

// Export for use as module
export default DatabaseManager;

// Run CLI if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
