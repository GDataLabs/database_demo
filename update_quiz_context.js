const { Pool } = require('pg');
const { VertexAI } = require('@google-cloud/vertexai');
require('dotenv').config();

const vertex_ai = new VertexAI({project: 'gothic-province-831', location: 'us-central1'});
const embeddingModel = vertex_ai.getGenerativeModel({model: "text-embedding-004"});

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'gabta_database',
    password: process.env.DB_PASSWORD || 'password',
    port: process.env.DB_PORT || 5432,
});

async function generateEmbedding(text) {
    const result = await embeddingModel.embedContent({
        requests: [{
            content: text,
        }],
    });
    return result.predictions[0].embedding;
}

async function updateQuizContext() {
    const client = await pool.connect();
    
    try {
        // Clear existing quiz context
        await client.query("DELETE FROM documents WHERE content LIKE '%Quiz and Scoring System Information%'");
        
        const improvedContext = `
Quiz and Scoring System - Database Information:

IMPORTANT: When searching for students by name, always use ILIKE with wildcards for partial matching!

Current Students with Quiz Data:
- Jane Smith (student_id: 2) - Has 4 quiz scores with 85.75% average

Tables and Schema:
- quizzes: quiz_id, quiz_name, quiz_type, total_points, quiz_date
- student_scores: student_id, quiz_id, score, max_score, percentage (auto-calculated)
- students: student_id, full_name, trade, enrollment_date

Jane Smith's Individual Quiz Scores:
1. JavaScript Basics Quiz: 85/100 (85%)
2. HTML/CSS Fundamentals: 92/100 (92%) 
3. Database Concepts: 78/100 (78%)
4. Python Programming: 88/100 (88%)
Average: 85.75%

SQL Query Examples:
- For average score: SELECT s.full_name, AVG(ss.percentage) as average_score FROM student_scores ss JOIN students s ON ss.student_id = s.student_id WHERE s.full_name ILIKE '%jane%' GROUP BY s.full_name;
- For all scores: SELECT s.full_name, q.quiz_name, ss.score, ss.max_score, ss.percentage FROM student_scores ss JOIN students s ON ss.student_id = s.student_id JOIN quizzes q ON ss.quiz_id = q.quiz_id WHERE s.full_name ILIKE '%jane%';

CRITICAL: Always use ILIKE '%name%' for name searches, never exact equality!
        `;
        
        console.log('Generating embedding for improved context...');
        const embedding = await generateEmbedding(improvedContext);
        
        console.log('Adding improved quiz context to documents table...');
        await client.query(
            'INSERT INTO documents (content, embedding) VALUES ($1, $2)',
            [improvedContext, JSON.stringify(embedding)]
        );
        
        console.log('Improved quiz context added successfully!');
        
    } catch (err) {
        console.error('Error updating quiz context:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

updateQuizContext();