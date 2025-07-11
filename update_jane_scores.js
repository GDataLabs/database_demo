const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'gabta_database',
    password: process.env.DB_PASSWORD || 'password',
    port: process.env.DB_PORT || 5432,
});

async function updateJaneScores() {
    const client = await pool.connect();
    
    try {
        console.log('Updating Jane\'s scores to 100%...');
        
        // Update all of Jane's scores to 100%
        await client.query(`
            UPDATE student_scores 
            SET score = 100.00, max_score = 100.00
            WHERE student_id = (SELECT student_id FROM students WHERE full_name = 'Jane Smith');
        `);
        
        console.log('Jane\'s scores updated successfully!');
        
        // Verify the update
        const result = await client.query(`
            SELECT s.full_name, AVG(ss.percentage) as average_score
            FROM student_scores ss
            JOIN students s ON ss.student_id = s.student_id
            WHERE s.full_name = 'Jane Smith'
            GROUP BY s.full_name;
        `);
        
        console.log('Jane\'s new average:', result.rows[0]?.average_score + '%');
        
    } catch (err) {
        console.error('Error updating scores:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

updateJaneScores();