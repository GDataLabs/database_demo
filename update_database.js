// update_database.js

require('dotenv').config();
const { Pool } = require('pg');
const pgvector = require('pgvector/pg');

const dbConfig = {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
};

const pool = new Pool(dbConfig);

async function main() {
    const client = await pool.connect();
    try {
        await client.query('CREATE EXTENSION IF NOT EXISTS vector');
        await pgvector.registerType(client);

        await client.query(`
            CREATE TABLE IF NOT EXISTS documents (
                id bigserial PRIMARY KEY,
                content text,
                embedding vector(768)
            )
        `);

        await client.query('CREATE INDEX ON documents USING ivfflat (embedding vector_l2_ops) WITH (lists = 100)');

        console.log('Database updated successfully');
    } finally {
        client.release();
    }
}

main().catch(err => console.error(err));
