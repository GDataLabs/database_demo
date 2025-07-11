// populate_database.js

require('dotenv').config();
const { Pool } = require('pg');
const pgvector = require('pgvector/pg');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const dbConfig = {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const pool = new Pool(dbConfig);

async function generateEmbedding(text) {
    const model = genAI.getGenerativeModel({ model: "embedding-001" });
    const result = await model.embedContent(text);
    const embedding = result.embedding.values;
    return embedding;
}

async function main() {
    const client = await pool.connect();
    try {
        await pgvector.registerType(client);

        const studentNotes = await client.query('SELECT note_text FROM student_notes');
        for (const row of studentNotes.rows) {
            const embedding = await generateEmbedding(row.note_text);
            await client.query('INSERT INTO documents (content, embedding) VALUES ($1, $2)', [row.note_text, embedding]);
        }

        const staffNotes = await client.query('SELECT note_text FROM staff_notes');
        for (const row of staffNotes.rows) {
            const embedding = await generateEmbedding(row.note_text);
            await client.query('INSERT INTO documents (content, embedding) VALUES ($1, $2)', [row.note_text, embedding]);
        }

        console.log('Database populated successfully');
    } finally {
        client.release();
    }
}

main().catch(err => console.error(err));
