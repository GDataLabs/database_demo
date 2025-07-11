const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'gabta_database',
    password: process.env.DB_PASSWORD || 'password',
    port: process.env.DB_PORT || 5432,
});

async function setupTables() {
    const client = await pool.connect();
    
    try {
        console.log('Creating quizzes table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS quizzes (
                quiz_id SERIAL PRIMARY KEY,
                quiz_name VARCHAR(200) NOT NULL,
                quiz_type VARCHAR(50) DEFAULT 'quiz',
                program_id INT,
                total_points DECIMAL(5,2) DEFAULT 100.00,
                quiz_date DATE DEFAULT CURRENT_DATE,
                created_by VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        console.log('Creating student_scores table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS student_scores (
                score_id SERIAL PRIMARY KEY,
                student_id INT NOT NULL,
                quiz_id INT NOT NULL,
                score DECIMAL(5,2) NOT NULL,
                max_score DECIMAL(5,2) NOT NULL,
                percentage DECIMAL(5,2) GENERATED ALWAYS AS (ROUND((score / max_score) * 100, 2)) STORED,
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                graded_by VARCHAR(100),
                notes TEXT,
                FOREIGN KEY (student_id) REFERENCES students(student_id),
                FOREIGN KEY (quiz_id) REFERENCES quizzes(quiz_id)
            );
        `);
        
        console.log('Creating indexes...');
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_student_scores_student ON student_scores(student_id);
            CREATE INDEX IF NOT EXISTS idx_student_scores_quiz ON student_scores(quiz_id);
            CREATE INDEX IF NOT EXISTS idx_quizzes_program ON quizzes(program_id);
        `);
        
        console.log('Inserting sample quizzes...');
        await client.query(`
            INSERT INTO quizzes (quiz_name, quiz_type, total_points, quiz_date) VALUES
            ('JavaScript Basics Quiz', 'quiz', 100.00, '2024-01-15'),
            ('HTML/CSS Fundamentals', 'quiz', 100.00, '2024-01-20'),
            ('Database Concepts', 'quiz', 100.00, '2024-01-25'),
            ('Python Programming', 'quiz', 100.00, '2024-02-01')
            ON CONFLICT DO NOTHING;
        `);
        
        console.log('Inserting Jane\'s quiz scores...');
        const janeResult = await client.query("SELECT student_id FROM students WHERE full_name = 'Jane Smith'");
        if (janeResult.rows.length > 0) {
            const janeId = janeResult.rows[0].student_id;
            await client.query(`
                INSERT INTO student_scores (student_id, quiz_id, score, max_score, graded_by) VALUES
                ($1, 1, 85.00, 100.00, 'instructor'),
                ($1, 2, 92.00, 100.00, 'instructor'),
                ($1, 3, 78.00, 100.00, 'instructor'),
                ($1, 4, 88.00, 100.00, 'instructor')
                ON CONFLICT DO NOTHING;
            `, [janeId]);
            console.log(`Added quiz scores for Jane (student_id: ${janeId})`);
        }
        
        console.log('Setup complete!');
        
        // Verify the data
        const avgResult = await client.query(`
            SELECT s.full_name, AVG(ss.percentage) as average_score
            FROM student_scores ss
            JOIN students s ON ss.student_id = s.student_id
            WHERE s.full_name = 'Jane Smith'
            GROUP BY s.full_name;
        `);
        
        if (avgResult.rows.length > 0) {
            console.log(`Jane's average quiz score: ${avgResult.rows[0].average_score}%`);
        }
        
    } catch (err) {
        console.error('Error setting up tables:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

setupTables();