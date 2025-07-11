// Script to check users in the database
require('dotenv').config();
const { Pool } = require('pg');

const dbConfig = {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
};

const pool = new Pool(dbConfig);

async function checkUsers() {
    const client = await pool.connect();
    try {
        console.log('Checking users table...\n');
        
        // Check if users table exists
        const tableCheck = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'users'
            );
        `);
        
        if (!tableCheck.rows[0].exists) {
            console.log('❌ Users table does not exist!');
            return;
        }
        
        // Get all users
        const users = await client.query('SELECT user_id, username, email, role, active FROM users ORDER BY user_id');
        
        console.log(`Total users: ${users.rows.length}\n`);
        console.log('User List:');
        console.log('==========');
        
        users.rows.forEach(user => {
            console.log(`ID: ${user.user_id}`);
            console.log(`Username: ${user.username}`);
            console.log(`Email: ${user.email}`);
            console.log(`Role: ${user.role}`);
            console.log(`Active: ${user.active}`);
            console.log('---');
        });
        
    } catch (error) {
        console.error('Error checking users:', error);
    } finally {
        client.release();
        pool.end();
    }
}

checkUsers();