
require("dotenv").config();

const { Client } = require("pg");

const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 30000
});

async function testDatabase() {
    try {
        console.log("Connecting to Neon PostgreSQL...");

        await client.connect();

        console.log("SUCCESS: PostgreSQL connected!");

        const result = await client.query(`
            SELECT
                current_database() AS database_name,
                current_user AS database_user,
                NOW() AS server_time
        `);

        console.table(result.rows);

    } catch (error) {
        console.error("DATABASE CONNECTION FAILED");
        console.error("Error:", error.message);
        console.error("Error code:", error.code || "Not provided");
    } finally {
        await client.end().catch(() => {});
    }
}

testDatabase();
