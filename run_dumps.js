const mysql = require('mysql2');
const fs = require('fs');

const args = process.argv.slice(2);

if (args.length > 0) {
    console.log("Received arguments:");
    args.forEach((arg, index) => {
      console.log(`Argument ${index + 1}: ${arg}`);
    });
  } else {
    console.log("No arguments provided.");
  }

const connection = mysql.createConnection({
    host: 'interchange.proxy.rlwy.net',
    user: 'root',
    password: 'czbdENAQEFTdOXMMzhPmIaSNqGdSaKlF',
    database: 'railway',
    port: 23462,
    multipleStatements: true // Important for dump files
});

connection.connect((err) => {

    if (err) {
        console.error('Error connecting: ' + err.stack);
        return;
    }
    console.log('Connected as id ' + connection.threadId);
    
    // Run the dump file after connection is established
    executeDumpFile(args[0]);
});

function executeDumpFile(filePath) {
    // Read the SQL dump file
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading dump file:', err);
            connection.end(); // Close connection on error
            return;
        }
        
        console.log('Executing SQL dump...');
        
        // Execute the SQL statements from the dump file
        connection.query(data, (error, results) => {
            if (error) {
                console.error('Error executing dump:', error);
                connection.end(); // Close connection on error
                return;
            }
            
            console.log('Dump executed successfully!');
            console.log('Results:', results);
            
            // Close connection after successful execution
            connection.end();
        });
    });
}