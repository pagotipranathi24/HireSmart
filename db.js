
const mysql = require("mysql2");

const db = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "pinky",
    database: "hiresmart",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test MySQL connection
db.getConnection((error, connection) => {
    if (error) {
        console.error("MySQL connection failed:", error.message);
        return;
    }

    console.log("HireSmart connected to MySQL successfully!");

    connection.release();
});

module.exports = db;
