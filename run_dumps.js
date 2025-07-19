const mysql = require('mysql2');

const connection = mysql.createConnection({
    host: 'interchange.proxy.rlwy.net',
    user: 'root',
    password: 'czbdENAQEFTdOXMMzhPmIaSNqGdSaKlF',
    database: 'railway',
    port: 23462
});

connection.connect((err) => {
    if (err) {
        console.error('Error connecting: ' + err.stack);
        return;
    }
    console.log('Connected as id ' + connection.threadId);
});

// Execute query
connection.query('SELECT * FROM test_table', (error, results, fields) => {
    if (error) throw error;
    console.log(results);
});

connection.end();