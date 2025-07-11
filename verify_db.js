require('dotenv').config();
const { Pool } = require('pg');

const dbConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
};

const pool = new Pool(dbConfig);

async function verifyData() {
    const client = await pool.connect();
    try {
        console.log('--- Last 5 Student Notes ---');
        const notesRes = await client.query('SELECT * FROM student_notes ORDER BY created_at DESC LIMIT 5');
        console.table(notesRes.rows);

        console.log('\n--- Last 5 Documents (for RAG) ---');
        const docsRes = await client.query('SELECT id, content, embedding is not null as has_embedding FROM documents ORDER BY id DESC LIMIT 5');
        console.table(docsRes.rows);

    } catch (err) {
        console.error('Error verifying data:', err);
    } finally {
        await client.release();
        await pool.end();
    }
}

verifyData();
