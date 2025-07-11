const { Pool } = require('pg');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'gabta_database',
    password: process.env.DB_PASSWORD || 'password',
    port: process.env.DB_PORT || 5432,
});

async function generateEmbedding(text) {
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const result = await model.embedContent(text);
    return result.embedding.values;
}

async function addQuizContext() {
    const client = await pool.connect();
    
    try {
        const quizContext = `
Quiz and Scoring System Information:

Tables:
- quizzes: Contains quiz information (quiz_id, quiz_name, quiz_type, total_points, quiz_date)
- student_scores: Contains individual student quiz scores (student_id, quiz_id, score, max_score, percentage)

Jane Smith's Quiz Scores:
- JavaScript Basics Quiz: 85/100 (85%)
- HTML/CSS Fundamentals: 92/100 (92%)
- Database Concepts: 78/100 (78%)
- Python Programming: 88/100 (88%)
Average: 85.75%

To calculate average scores for students:
SELECT s.full_name, AVG(ss.percentage) as average_score
FROM student_scores ss
JOIN students s ON ss.student_id = s.student_id
WHERE s.full_name ILIKE '%student_name%'
GROUP BY s.full_name;
        `;
        
        console.log('Generating embedding for quiz context...');
        const embedding = await generateEmbedding(quizContext);
        
        console.log('Adding quiz context to documents table...');
        await client.query(
            'INSERT INTO documents (content, embedding) VALUES ($1, $2)',
            [quizContext, JSON.stringify(embedding)]
        );
        
        console.log('Quiz context added successfully!');
        
    } catch (err) {
        console.error('Error adding quiz context:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

addQuizContext();