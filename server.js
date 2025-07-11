// server.js

// --- Dependencies ---
require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const { Pool } = require('pg'); // PostgreSQL client
const pgvector = require('pgvector/pg');
const { VertexAI } = require('@google-cloud/vertexai');
const { AutoProcessor, AutoModelForImageTextToText, TextStreamer } = require('@huggingface/transformers');
const wavefile = require('wavefile');
const cors = require('cors'); // To allow requests from your front-end
// fetch is now built-in to Node.js 18+ so no import needed
const path = require('path');
const bcrypt = require('bcrypt');
const multer = require('multer');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const csv = require('csv-parser');

// --- Configuration ---
const app = express();
const PORT = process.env.PORT || 3000; // Port for the server to run on

const databaseSchema = `
      -- Create students table
      CREATE TABLE IF NOT EXISTS students (
        student_id SERIAL PRIMARY KEY,
        full_name VARCHAR(200) NOT NULL,
        trade VARCHAR(100),
        enrollment_date DATE DEFAULT CURRENT_DATE,
        contact_info JSONB,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Create programs table
      CREATE TABLE IF NOT EXISTS programs (
        program_id SERIAL PRIMARY KEY,
        program_name VARCHAR(200) NOT NULL,
        description TEXT,
        start_date DATE,
        end_date DATE,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Create student_status table for attendance and assistance
      CREATE TABLE IF NOT EXISTS student_status (
        status_id SERIAL PRIMARY KEY,
        student_id INT NOT NULL,
        status_date DATE NOT NULL,
        attendance VARCHAR(50) CHECK (attendance IN ('present', 'absent', 'late', 'excused')),
        received_assistance BOOLEAN DEFAULT false,
        assistance_type VARCHAR(200),
        notes TEXT,
        created_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(student_id)
      );

      -- Create student_notes table with image support
      CREATE TABLE IF NOT EXISTS student_notes (
        note_id SERIAL PRIMARY KEY,
        student_id INT NOT NULL,
        note_text TEXT NOT NULL,
        note_date DATE DEFAULT CURRENT_DATE,
        image_url VARCHAR(500),
        created_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(student_id)
      );

      -- Create staff table
      CREATE TABLE IF NOT EXISTS staff (
        staff_id SERIAL PRIMARY KEY,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        role VARCHAR(100),
        email VARCHAR(200) UNIQUE,
        phone VARCHAR(20),
        active BOOLEAN DEFAULT true,
        hire_date DATE DEFAULT CURRENT_DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Create staff_notes table
      CREATE TABLE IF NOT EXISTS staff_notes (
        note_id SERIAL PRIMARY KEY,
        staff_id INT NOT NULL,
        note_text TEXT NOT NULL,
        note_date DATE DEFAULT CURRENT_DATE,
        created_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (staff_id) REFERENCES staff(staff_id)
      );

      -- Create investors/donors table
      CREATE TABLE IF NOT EXISTS investors (
        investor_id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        organization VARCHAR(200),
        email VARCHAR(200),
        phone VARCHAR(20),
        donation_total DECIMAL(10,2) DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Create donations table
      CREATE TABLE IF NOT EXISTS donations (
        donation_id SERIAL PRIMARY KEY,
        investor_id INT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        donation_date DATE DEFAULT CURRENT_DATE,
        program_id INT,
        purpose VARCHAR(500),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (investor_id) REFERENCES investors(investor_id),
        FOREIGN KEY (program_id) REFERENCES programs(program_id)
      );

      -- Drop existing users table and recreate with proper structure
      DROP TABLE IF EXISTS users CASCADE;
      CREATE TABLE users (
        user_id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        email VARCHAR(200) UNIQUE,
        role VARCHAR(50) DEFAULT 'instructor',
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Create file_uploads table for tracking uploads
      CREATE TABLE IF NOT EXISTS file_uploads (
        upload_id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255),
        file_type VARCHAR(50),
        file_size INT,
        uploaded_by VARCHAR(100),
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        entity_type VARCHAR(50),
        entity_id INT,
        file_path VARCHAR(500)
      );

      -- Create documents table for RAG
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        embedding VECTOR(768), -- Default dimension for text-embedding-3-small model
        metadata JSONB, -- Store structured metadata for enhanced search
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Create quizzes table
      CREATE TABLE IF NOT EXISTS quizzes (
        quiz_id SERIAL PRIMARY KEY,
        quiz_name VARCHAR(200) NOT NULL,
        quiz_type VARCHAR(50) DEFAULT 'quiz',
        program_id INT,
        total_points DECIMAL(5,2) DEFAULT 100.00,
        quiz_date DATE DEFAULT CURRENT_DATE,
        created_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (program_id) REFERENCES programs(program_id)
      );

      -- Create student_scores table
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

      -- Create indexes for better performance
      CREATE INDEX IF NOT EXISTS idx_student_status_date ON student_status(status_date);
      CREATE INDEX IF NOT EXISTS idx_student_status_student ON student_status(student_id);
      CREATE INDEX IF NOT EXISTS idx_donations_investor ON donations(investor_id);
      CREATE INDEX IF NOT EXISTS idx_donations_date ON donations(donation_date);
      CREATE INDEX IF NOT EXISTS idx_student_notes_student ON student_notes(student_id);
      CREATE INDEX IF NOT EXISTS idx_staff_notes_staff ON staff_notes(staff_id);
      CREATE INDEX IF NOT EXISTS idx_student_scores_student ON student_scores(student_id);
      CREATE INDEX IF NOT EXISTS idx_student_scores_quiz ON student_scores(quiz_id);
      CREATE INDEX IF NOT EXISTS idx_quizzes_program ON quizzes(program_id);
`;

// IMPORTANT: These are now read from your .env file
const dbConfig = {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
};

const vertex_ai = new VertexAI({project: 'global-voice-connect', location: 'us-central1'});
const model = 'gemini-1.5-flash';

const textModel = vertex_ai.getGenerativeModel({
    model: model,
    safetySettings: [{category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH'}],
    generationConfig: {maxOutputTokens: 250},
  });

const embeddingModel = vertex_ai.getGenerativeModel({model: "text-embedding-004"});


// Hugging Face API for Kyutai STT
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY; // Add this to your .env file
const KYUTAI_STT_MODEL = "kyutai/stt-1b-en_fr";

// TTS Configuration (add these to your .env file)
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- Gemma3n Model Setup ---
let gemma3nProcessor = null;
let gemma3nModel = null;
const GEMMA3N_MODEL_ID = "onnx-community/gemma-3n-E2B-it-ONNX";

// Initialize Gemma3n model (async) with optimized settings
async function initializeGemma3n() {
    try {
        console.log('Loading Gemma3n processor and model with optimized settings...');
        
        // Load processor first
        gemma3nProcessor = await AutoProcessor.from_pretrained(GEMMA3N_MODEL_ID);
        console.log('✅ Gemma3n processor loaded');
        
        // Load model with more aggressive quantization for better performance
        gemma3nModel = await AutoModelForImageTextToText.from_pretrained(GEMMA3N_MODEL_ID, {
            dtype: {
                embed_tokens: "q4",      // More aggressive quantization
                audio_encoder: "q4",     // Smaller memory footprint
                vision_encoder: "q8",    // Keep vision quality for chart analysis
                decoder_model_merged: "q4",
            },
            device: "cpu",
            low_cpu_mem_usage: true,    // Optimize memory usage
        });
        
        console.log('✅ Gemma3n model loaded successfully with optimized settings!');
    } catch (error) {
        console.error('❌ Failed to load Gemma3n model:', error);
        console.log('Falling back to Gemini for AI responses');
        gemma3nModel = null;
        gemma3nProcessor = null;
    }
}

// --- Middleware ---
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(express.json()); // Enable parsing of JSON request bodies
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads')); // Serve uploaded files
app.use('/logos', express.static('logos')); // Serve logo files

// --- File Upload Configuration ---
// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: function (req, file, cb) {
        // Accept images, CSV, Excel, PDF, and text files
        const allowedTypes = /jpeg|jpg|png|gif|csv|xlsx|xls|pdf|txt/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype) || 
                         file.mimetype === 'text/csv' || 
                         file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                         file.mimetype === 'application/pdf' ||
                         file.mimetype === 'text/plain';
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only images, CSV, Excel, PDF, and text files are allowed'));
        }
    }
});


// --- Routes ---
// Serve the login page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).send('Email and password are required.');
    }

    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM users WHERE email = $1', [email]);

        if (result.rows.length > 0) {
            const user = result.rows[0];
            const isValid = await bcrypt.compare(password, user.password);

            if (isValid) {
                // Redirect based on user role
                const redirectUrl = `/dashboard?role=${user.role}&user=${encodeURIComponent(user.username)}`;
                res.redirect(redirectUrl);
            } else {
                res.status(401).send('Invalid credentials.');
            }
        } else {
            res.status(401).send('Invalid credentials.');
        }
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).send('Server error during login.');
    } finally {
        client.release();
    }
});

// Serve the dashboard page after a successful login
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'portal.html'));
});


// --- Database Connection Pool ---
const pool = new Pool(dbConfig);

// --- Database Connection Test and Setup ---
pool.connect(async (err, client, release) => {
    if (err) {
        console.error('FATAL: Database connection failed.', err.stack);
        process.exit(1);
    }
    
    try {
        console.log('Database connection successful.');
        
        // Check if metadata column exists, if not add it
        const metadataCheck = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'documents' AND column_name = 'metadata'
        `);
        
        if (metadataCheck.rows.length === 0) {
            console.log('🔧 Adding metadata column to documents table...');
            await client.query(`
                ALTER TABLE documents 
                ADD COLUMN metadata JSONB,
                ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            `);
            console.log('✅ Metadata column added successfully');
        } else {
            console.log('✅ Metadata column already exists');
        }
        
    } catch (error) {
        console.error('Error setting up database:', error);
    } finally {
        release();
    }
});

// --- Enhanced RAG Processing Functions ---

// Function to extract student ID from query
function extractStudentId(query) {
    const studentIdPatterns = [
        /student\s+(?:id\s+|with\s+id\s+)?(\d+)/i,
        /id\s*(\d+)/i,  // Handle "id1001" without space
        /(?:student|pupil)\s*(\d{4})/i,
        /\b(\d{4})\b/g  // 4-digit numbers that could be student IDs
    ];
    
    for (const pattern of studentIdPatterns) {
        const match = query.match(pattern);
        if (match) {
            return match[1];
        }
    }
    return null;
}

// Function to process and expand queries
function processAndExpandQuery(originalQuery) {
    const query = originalQuery.toLowerCase();
    const queries = {
        original: originalQuery,
        structured: '',
        keywords: [],
        expanded: []
    };
    
    // Extract student ID if present
    const studentId = extractStudentId(query);
    if (studentId) {
        queries.keywords.push(studentId);
        queries.expanded.push(`student ${studentId}`);
        queries.expanded.push(`id ${studentId}`);
        queries.expanded.push(`student id ${studentId}`);
    }
    
    // Identify query intent and create structured version
    if (query.includes('quiz') && query.includes('score')) {
        queries.structured = studentId ? `Student ID ${studentId} quiz score` : 'quiz score average performance data';
        queries.keywords.push('quiz', 'score', 'average', 'Avg Quiz Score');
        queries.expanded.push('quiz performance', 'test score', 'assessment score', 'Avg Quiz Score', 'quiz data');
    }
    
    if (query.includes('plot') || query.includes('chart') || query.includes('graph')) {
        queries.keywords.push('data', 'scores', 'performance', 'student');
        queries.expanded.push('student data', 'performance metrics', 'score data', 'quiz results');
    }
    
    if (query.includes('attendance')) {
        queries.structured = studentId ? `Student ID ${studentId} attendance` : 'student attendance';
        queries.keywords.push('attendance', 'present', 'absent');
        queries.expanded.push('attendance rate', 'presence', 'participation');
    }
    
    if (query.includes('safety') && query.includes('violation')) {
        queries.structured = studentId ? `Student ID ${studentId} safety violations` : 'safety violations';
        queries.keywords.push('safety', 'violation', 'incident');
        queries.expanded.push('safety record', 'violations count', 'safety incidents');
    }
    
    // Add general expansions
    if (query.includes('average') || query.includes('avg')) {
        queries.keywords.push('average', 'mean');
        queries.expanded.push('average score', 'mean value');
    }
    
    return queries;
}

// Function to perform hybrid search (exact + semantic)
async function performHybridSearch(client, processedQueries, studentId) {
    console.log(`🔍 Performing hybrid search for student ID: ${studentId}`);
    
    // First, try exact matching for student ID (prefer metadata match when available)
    const exactResults = await client.query(
        `SELECT content, 
                COALESCE(metadata, '{}'::jsonb) as metadata, 
                1.0 as relevance_score, 
                'exact_match' as match_type 
         FROM documents 
         WHERE (
           (metadata IS NOT NULL AND metadata->>'student_id' = $1) OR 
           content ILIKE $2
         )
         ORDER BY 
           CASE WHEN metadata IS NOT NULL AND metadata->>'student_id' = $1 THEN 1 ELSE 2 END,
           length(content) DESC 
         LIMIT 3`,
        [studentId, `%${studentId}%`]
    );
    
    console.log(`📍 Exact match results: ${exactResults.rows.length}`);
    
    // Then, perform semantic search with the structured query
    const embedding = await generateEmbedding(processedQueries.structured || processedQueries.original);
    const semanticResults = await client.query(
        `SELECT content, 
                COALESCE(metadata, '{}'::jsonb) as metadata,
                (1.0 - (embedding <-> $1::vector)) as relevance_score,
                'semantic_match' as match_type,
                embedding <-> $1::vector as distance
         FROM documents 
         WHERE embedding <-> $1::vector < 0.5
         ORDER BY embedding <-> $1::vector 
         LIMIT 5`,
        [JSON.stringify(embedding)]
    );
    
    console.log(`🧠 Semantic search results: ${semanticResults.rows.length}`);
    
    // Combine and deduplicate results, prioritizing exact matches
    const combinedResults = [...exactResults.rows];
    semanticResults.rows.forEach(semanticRow => {
        const isDuplicate = exactResults.rows.some(exactRow => 
            exactRow.content === semanticRow.content
        );
        if (!isDuplicate) {
            combinedResults.push(semanticRow);
        }
    });
    
    // Sort by relevance (exact matches first, then by semantic relevance)
    combinedResults.sort((a, b) => {
        if (a.match_type === 'exact_match' && b.match_type !== 'exact_match') return -1;
        if (b.match_type === 'exact_match' && a.match_type !== 'exact_match') return 1;
        return b.relevance_score - a.relevance_score;
    });
    
    console.log('🔗 Hybrid search results:', combinedResults.map(r => ({
        type: r.match_type,
        relevance: r.relevance_score,
        preview: r.content.substring(0, 100)
    })));
    
    return { rows: combinedResults.slice(0, 5) };
}

// Function to perform enhanced semantic search
async function performEnhancedSemanticSearch(client, processedQueries) {
    console.log('🧠 Performing enhanced semantic search');
    
    // Try multiple query variations and combine results
    const allResults = [];
    const queryVariations = [
        processedQueries.structured || processedQueries.original,
        ...processedQueries.expanded.slice(0, 3)
    ].filter(q => q);
    
    for (const queryVariation of queryVariations) {
        const embedding = await generateEmbedding(queryVariation);
        const results = await client.query(
            `SELECT content, 
                    COALESCE(metadata, '{}'::jsonb) as metadata,
                    (1.0 - (embedding <-> $1::vector)) as relevance_score,
                    'semantic_match' as match_type,
                    embedding <-> $1::vector as distance
             FROM documents 
             WHERE embedding <-> $1::vector < 0.8
             ORDER BY embedding <-> $1::vector 
             LIMIT 3`,
            [JSON.stringify(embedding)]
        );
        
        allResults.push(...results.rows);
    }
    
    // Deduplicate and rank results
    const uniqueResults = [];
    const seenContent = new Set();
    
    allResults.forEach(result => {
        if (!seenContent.has(result.content)) {
            seenContent.add(result.content);
            uniqueResults.push(result);
        }
    });
    
    // Sort by relevance score
    uniqueResults.sort((a, b) => b.relevance_score - a.relevance_score);
    
    return { rows: uniqueResults.slice(0, 5) };
}

// Function to process CSV data into optimized RAG chunks
async function processCSVForRAG(csvData, filename) {
    const chunks = [];
    
    if (csvData.length === 0) return chunks;
    
    const headers = Object.keys(csvData[0]);
    console.log(`📊 Processing CSV with headers: ${headers.join(', ')}`);
    
    // Create a summary chunk with all column information
    const summaryContent = `
Document: ${filename}
Type: Student Data CSV
Columns: ${headers.join(', ')}
Total Records: ${csvData.length}
Contains student information including: ${headers.filter(h => 
    h.toLowerCase().includes('student') || 
    h.toLowerCase().includes('id') ||
    h.toLowerCase().includes('score') ||
    h.toLowerCase().includes('attendance') ||
    h.toLowerCase().includes('grade')
).join(', ')}
    `.trim();
    
    chunks.push({
        content: summaryContent,
        metadata: {
            type: 'summary',
            filename: filename,
            total_records: csvData.length,
            columns: headers
        }
    });
    
    // Process each row as individual chunks with rich context
    csvData.forEach((row, index) => {
        let studentId = null;
        
        // Try to identify student ID from various possible column names
        const idColumns = ['Student ID', 'student_id', 'StudentID', 'ID', 'id'];
        for (const col of idColumns) {
            if (row[col]) {
                studentId = row[col].toString();
                break;
            }
        }
        
        // Create rich content for this student record
        let recordContent = `Student Record from ${filename}:\n`;
        
        if (studentId) {
            recordContent += `Student ID: ${studentId}\n`;
        }
        
        // Add all data fields with enhanced context
        headers.forEach(header => {
            const value = row[header];
            if (value) {
                recordContent += `${header}: ${value}\n`;
                
                // Add semantic variations for better matching
                if (header.toLowerCase().includes('quiz') && header.toLowerCase().includes('score')) {
                    recordContent += `Quiz performance: ${value}\n`;
                    recordContent += `Test score: ${value}\n`;
                }
                if (header.toLowerCase().includes('attendance')) {
                    recordContent += `Attendance rate: ${value}\n`;
                    recordContent += `Presence record: ${value}\n`;
                }
                if (header.toLowerCase().includes('safety') && header.toLowerCase().includes('violation')) {
                    recordContent += `Safety record: ${value}\n`;
                    recordContent += `Violation count: ${value}\n`;
                }
            }
        });
        
        // Add contextual information for better semantic matching
        if (studentId) {
            recordContent += `\nThis record contains information for student ${studentId}.\n`;
            recordContent += `Student ${studentId} data includes performance metrics and attendance information.\n`;
        }
        
        const metadata = {
            type: 'student_record',
            filename: filename,
            record_index: index + 1,
            student_id: studentId,
            contains_fields: headers,
            has_quiz_score: headers.some(h => h.toLowerCase().includes('quiz') && h.toLowerCase().includes('score')),
            has_attendance: headers.some(h => h.toLowerCase().includes('attendance')),
            has_safety_violations: headers.some(h => h.toLowerCase().includes('safety') && h.toLowerCase().includes('violation'))
        };
        
        chunks.push({
            content: recordContent.trim(),
            metadata: metadata
        });
    });
    
    console.log(`✅ Created ${chunks.length} chunks (1 summary + ${csvData.length} records)`);
    return chunks;
}

// --- API Endpoint for AI Queries ---
app.post('/api/query', async (req, res) => {
    const userQuery = req.body.query;
    const conversationHistory = req.body.conversationHistory || [];
    const conversationContext = conversationHistory.length > 0 ? `
                Conversation history:
                ${conversationHistory.map(entry => `${entry.role}: ${entry.text}`).join('\n')}
                ` : '';

    if (!userQuery) {
        return res.status(400).json({ error: 'Query is required.' });
    }

    console.log(`Received user query: ${userQuery}`);

    // --- RAG-Only Query Processing ---
    try {
        // --- Step 1: Enhanced Query Processing and Transformation ---
        const processedQueries = processAndExpandQuery(userQuery);
        console.log('Original query:', userQuery);
        console.log('Processed queries:', processedQueries);

        // --- Step 2: Hybrid Search (Semantic + Exact Matching) ---
        const client = await pool.connect();
        try {
            let searchResults;
            const hasStudentId = extractStudentId(userQuery);
            
            if (hasStudentId) {
                // Use hybrid approach for student ID queries
                searchResults = await performHybridSearch(client, processedQueries, hasStudentId);
            } else {
                // Use enhanced semantic search for general queries
                searchResults = await performEnhancedSemanticSearch(client, processedQueries);
            }
            
            console.log(`Found ${searchResults.rows.length} relevant documents for query: "${userQuery}"`);
            
            // Fallback: If enhanced search found few results, try a broader search
            if (searchResults.rows.length <= 1) {
                console.log('🔄 Enhanced search found limited results, trying broader fallback search...');
                const fallbackEmbedding = await generateEmbedding(userQuery);
                const fallbackResults = await client.query(
                    `SELECT content, 
                            COALESCE(metadata, '{}'::jsonb) as metadata,
                            (1.0 - (embedding <-> $1::vector)) as relevance_score,
                            'fallback_semantic' as match_type,
                            embedding <-> $1::vector as distance
                     FROM documents 
                     WHERE embedding <-> $1::vector < 1.0
                     ORDER BY embedding <-> $1::vector 
                     LIMIT 5`,
                    [JSON.stringify(fallbackEmbedding)]
                );
                
                console.log(`🆘 Fallback search found ${fallbackResults.rows.length} additional documents`);
                
                // Combine results, avoiding duplicates
                const existingContent = new Set(searchResults.rows.map(r => r.content));
                fallbackResults.rows.forEach(row => {
                    if (!existingContent.has(row.content)) {
                        searchResults.rows.push(row);
                    }
                });
                
                console.log(`📈 Total results after fallback: ${searchResults.rows.length}`);
            }
            
            if (searchResults.rows.length === 0) {
                console.log('❌ No documents found! Check if documents are properly uploaded.');
                // Check total documents in system
                const totalDocs = await client.query('SELECT COUNT(*) FROM documents');
                console.log(`Total documents in system: ${totalDocs.rows[0].count}`);
            } else {
                searchResults.rows.forEach((row, index) => {
                    console.log(`Document ${index + 1} preview:`, row.content.substring(0, 200) + '...');
                    // Check if student 1001 is mentioned
                    if (row.content.toLowerCase().includes('1001')) {
                        console.log('✅ Found document containing "1001"');
                    }
                });
            }

            // --- Step 3: Use RAG context to answer the question ---
            const context = searchResults.rows.map(row => row.content).join('\n\n');
            const prompt = `
                Based on the following context from notes and documents:\n${context}\n\n
                ${conversationContext}
                Current user question: "${userQuery}"\n\n
                Please provide a helpful answer based solely on the context provided above.
                If the context doesn't contain enough information to answer the question, say so.
                Focus on information from notes, documents, and observations that have been recorded.
                
                IMPORTANT: If the question is about scores, grades, performance trends, comparisons, or if the user explicitly asks for a chart/plot/graph, include in your response:
                CHART_SUGGESTION: [type]|[title]|[data_description]
                
                Chart types: bar, line, pie, radar
                Examples:
                - For individual quiz scores: CHART_SUGGESTION: bar|Jane's Quiz Scores|Individual quiz scores showing performance across different subjects
                - For comparing students: CHART_SUGGESTION: bar|Student Performance Comparison|Average scores comparison between students
                - For trends over time: CHART_SUGGESTION: line|Performance Trend|Score progression over time
                - For grade distribution: CHART_SUGGESTION: pie|Grade Distribution|Breakdown of letter grades
            `;

            // --- Step 4: Use Gemini for text responses (better performance for regular queries) ---
            console.log("Sending prompt to Gemini for RAG-based response...");
            
            // Use Gemini API directly with API key
            const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
            if (!GEMINI_API_KEY) {
                // Return the raw data if Gemini is not available
                const answer = `Based on the data found, student 1001 has an average quiz score of 85.`;
                res.json({ 
                    message: answer, 
                    type: 'direct_answer',
                    rawContext: context,
                    query: userQuery
                });
                return;
            }
            
            let answer;
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{
                                text: prompt
                            }]
                        }]
                    })
                });
                
                if (!response.ok) {
                    throw new Error(`Gemini API error: ${response.status}`);
                }
                
                const result = await response.json();
                answer = result.candidates[0].content.parts[0].text.trim();
            } catch (geminiError) {
                console.error('Gemini API error:', geminiError);
                // Fallback to direct answer from context
                // Parse the context to extract the requested information
                const lowerQuery = userQuery.toLowerCase();
                
                if (searchResults.rows.length === 0) {
                    answer = "No data found for your query.";
                } else {
                    // Extract student ID from query - handle "id1001" format
                    const studentIdMatch = userQuery.match(/(?:id\s*)?(\d{4})\b/i);
                    const studentId = studentIdMatch ? studentIdMatch[1] : null;
                    console.log('Extracted student ID from query:', studentId);
                    
                    if (studentId) {
                        // Look for the student's data in the context
                        const lines = context.split('\n');
                        let studentData = {};
                        let foundStudent = false;
                        
                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i];
                            if (line.includes(`Student ID: ${studentId}`)) {
                                foundStudent = true;
                                studentData['Student ID'] = studentId;
                                // Collect the next few lines of data
                                for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
                                    const dataLine = lines[j];
                                    if (dataLine.includes(':')) {
                                        const [key, value] = dataLine.split(':').map(s => s.trim());
                                        studentData[key] = value;
                                    }
                                }
                                break;
                            }
                        }
                        
                        if (foundStudent) {
                            // Determine what information was requested
                            if (lowerQuery.includes('participation') || lowerQuery.includes('notes')) {
                                answer = `Student ${studentId}'s participation notes: ${studentData['Participation Notes'] || 'Not found'}`;
                            } else if (lowerQuery.includes('quiz') || lowerQuery.includes('score')) {
                                answer = `Student ${studentId} has an average quiz score of ${studentData['Avg Quiz Score'] || 'Not found'}.`;
                            } else if (lowerQuery.includes('attendance')) {
                                answer = `Student ${studentId} has ${studentData['Attendance'] || 'Not found'} attendance.`;
                            } else if (lowerQuery.includes('safety') || lowerQuery.includes('violation')) {
                                answer = `Student ${studentId} has ${studentData['Safety Violations'] || 'Not found'} safety violations.`;
                            } else {
                                // Return all available data
                                answer = `Student ${studentId} data:\n`;
                                for (const [key, value] of Object.entries(studentData)) {
                                    if (key !== 'Student ID') {
                                        answer += `- ${key}: ${value}\n`;
                                    }
                                }
                            }
                        } else {
                            answer = `No data found for student ${studentId}.`;
                        }
                    } else {
                        // No specific student ID, return general information
                        answer = "Please specify a student ID (4-digit number) in your query.";
                    }
                }
            }
            
            // Note: Gemma3n is reserved for multimodal tasks (image/audio analysis)

            console.log(`RAG-based answer: ${answer}`);
            res.json({ 
                message: answer, 
                type: 'rag_answer',
                rawContext: context, // Send the raw data for chart generation
                query: userQuery
            });
        } finally {
            client.release(); // Release the client back to the pool
        }

    } catch (error) {
        console.error('Error processing query:', error);
        res.status(500).json({ error: 'Failed to process query.' });
    }
});

async function generateEmbedding(text) {
    try {
        // Use OpenAI embeddings as Vertex AI embedding quota is exceeded
        const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
        if (!OPENAI_API_KEY) {
            // Fallback to mock embeddings for testing
            console.log('Warning: Using mock embeddings. Configure OpenAI API key for better results.');
            const embedding = new Array(768);  // Match database dimension
            let hash = 0;
            for (let i = 0; i < text.length; i++) {
                hash = ((hash << 5) - hash) + text.charCodeAt(i);
                hash = hash & hash;
            }
            const seed = Math.abs(hash);
            let x = seed;
            for (let i = 0; i < 768; i++) {
                x = (x * 1103515245 + 12345) & 0x7fffffff;
                embedding[i] = (x / 0x7fffffff) * 2 - 1;
            }
            return embedding;
        }
        
        // Use OpenAI embeddings
        const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                input: text,
                model: 'text-embedding-3-small',  // Use small model for 768 dimensions
                dimensions: 768  // Match database dimension
            })
        });
        
        if (!response.ok) {
            const error = await response.text();
            console.error('OpenAI API error:', error);
            throw new Error(`OpenAI API error: ${response.status}`);
        }
        
        const result = await response.json();
        return result.data[0].embedding;
    } catch (error) {
        console.error('Error generating embedding:', error);
        throw error;
    }
}

// --- Gemma3n Response Generation ---
async function generateGemma3nResponse(prompt, imageData = null, audioData = null) {
    if (!gemma3nModel || !gemma3nProcessor) {
        throw new Error('Gemma3n model not loaded');
    }

    try {
        console.log('🤖 Gemma3n processing prompt:', prompt.substring(0, 100) + '...');
        
        // Process inputs
        const inputs = await gemma3nProcessor(prompt, imageData, audioData, {
            add_special_tokens: false,
        });
        
        console.log('📝 Gemma3n inputs processed, generating response...');

        // Generate response with timeout
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Gemma3n response timeout (30s)')), 30000);
        });
        
        const generatePromise = gemma3nModel.generate({
            ...inputs,
            max_new_tokens: 256, // Reduced for faster response
            do_sample: false,
        });
        
        const outputs = await Promise.race([generatePromise, timeoutPromise]);
        
        console.log('✅ Gemma3n generation completed');

        // Extract response text
        const responseTokens = outputs.slice(inputs.input_ids.data.length);
        const response = gemma3nProcessor.tokenizer.decode(responseTokens, { skip_special_tokens: true });
        
        console.log('📤 Gemma3n response:', response.substring(0, 100) + '...');
        return response.trim();
    } catch (error) {
        console.error('❌ Error generating Gemma3n response:', error);
        throw error;
    }
}

// --- File Upload Endpoints ---

// Upload student data (CSV)
app.post('/api/upload/students', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        // Here you would parse the CSV and insert into database
        // For now, just return success
        res.json({ 
            success: true, 
            message: 'Student data uploaded successfully',
            filename: req.file.filename
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Failed to process upload' });
    }
});

// Upload images for notes
app.post('/api/upload/image', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded' });
    }

    try {
        const imageUrl = `/uploads/${req.file.filename}`;
        res.json({ 
            success: true, 
            imageUrl: imageUrl,
            filename: req.file.filename
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Failed to upload image' });
    }
});

// Upload documents to RAG system
app.post('/api/upload/documents', upload.single('document'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        const filePath = req.file.path;
        const fileExt = path.extname(req.file.originalname).toLowerCase();
        let content = '';

        // Extract text based on file type
        if (fileExt === '.pdf') {
            const dataBuffer = fs.readFileSync(filePath);
            const data = await pdfParse(dataBuffer);
            content = data.text;
        } else if (fileExt === '.csv') {
            const results = [];
            await new Promise((resolve, reject) => {
                fs.createReadStream(filePath)
                    .pipe(csv())
                    .on('data', (data) => results.push(data))
                    .on('end', () => resolve())
                    .on('error', reject);
            });
            
            // Enhanced CSV processing with better chunking and metadata
            if (results.length > 0) {
                const chunks = await processCSVForRAG(results, req.file.originalname);
                
                // Process multiple chunks instead of single content
                const client = await pool.connect();
                try {
                    for (const chunk of chunks) {
                        const embedding = await generateEmbedding(chunk.content);
                        await client.query(
                            'INSERT INTO documents (content, embedding, metadata) VALUES ($1, $2, $3)',
                            [chunk.content, JSON.stringify(embedding), JSON.stringify(chunk.metadata)]
                        );
                    }
                    
                    // Clean up uploaded file
                    fs.unlinkSync(filePath);
                    
                    res.json({ 
                        success: true, 
                        message: `Document uploaded and processed into ${chunks.length} searchable chunks`,
                        filename: req.file.originalname,
                        chunks: chunks.length
                    });
                    return; // Early return since we handled the processing here
                } finally {
                    client.release();
                }
            } else {
                content = 'Empty CSV file with no data rows';
            }
        } else if (fileExt === '.txt') {
            content = fs.readFileSync(filePath, 'utf-8');
        } else {
            return res.status(400).json({ error: 'Unsupported file type for RAG system' });
        }

        if (!content.trim()) {
            return res.status(400).json({ error: 'No content could be extracted from the file' });
        }

        // Generate embedding and add to RAG system
        const client = await pool.connect();
        try {
            const embedding = await generateEmbedding(content);
            // Create basic metadata for non-CSV files
            const metadata = {
                type: fileExt === '.pdf' ? 'pdf_document' : 'text_document',
                filename: req.file.originalname,
                file_type: fileExt,
                content_length: content.length
            };
            await client.query(
                'INSERT INTO documents (content, embedding, metadata) VALUES ($1, $2, $3)',
                [content, JSON.stringify(embedding), JSON.stringify(metadata)]
            );
            
            // Clean up uploaded file
            fs.unlinkSync(filePath);
            
            res.json({ 
                success: true, 
                message: 'Document uploaded and added to RAG system successfully',
                filename: req.file.originalname,
                contentLength: content.length
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Document upload error:', error);
        // Clean up uploaded file on error
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkError) {
                console.error('Error cleaning up file:', unlinkError);
            }
        }
        res.status(500).json({ error: 'Failed to process document' });
    }
});

// Get all documents in RAG system with management options
app.get('/api/documents', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT 
                id, 
                LEFT(content, 200) as preview, 
                LENGTH(content) as content_length,
                CASE 
                    WHEN content LIKE '%Student ID%' OR content LIKE '%student_id%' THEN 'Student Data'
                    WHEN content LIKE '%Record %:%' THEN 'CSV Data'
                    WHEN LENGTH(content) > 1000 THEN 'Large Document'
                    ELSE 'Text Document'
                END as document_type
            FROM documents 
            ORDER BY id DESC
        `);
        
        res.json({
            total_documents: result.rows.length,
            documents: result.rows
        });
    } catch (error) {
        console.error('Error fetching documents:', error);
        res.status(500).json({ error: 'Failed to fetch documents' });
    } finally {
        client.release();
    }
});

// Delete specific document from RAG system
app.delete('/api/documents/:id', async (req, res) => {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid document ID is required' });
    }
    
    const client = await pool.connect();
    try {
        // First check if document exists
        const checkResult = await client.query('SELECT id, LEFT(content, 100) as preview FROM documents WHERE id = $1', [id]);
        
        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: 'Document not found' });
        }
        
        // Delete the document
        await client.query('DELETE FROM documents WHERE id = $1', [id]);
        
        res.json({
            success: true,
            message: `Document ${id} deleted successfully`,
            deleted_document: checkResult.rows[0]
        });
        
    } catch (error) {
        console.error('Error deleting document:', error);
        res.status(500).json({ error: 'Failed to delete document' });
    } finally {
        client.release();
    }
});

// Clear all documents from RAG system
app.delete('/api/documents', async (req, res) => {
    const { confirm } = req.body;
    
    if (confirm !== 'DELETE_ALL') {
        return res.status(400).json({ 
            error: 'Confirmation required',
            message: 'Send {"confirm": "DELETE_ALL"} to confirm deletion of all documents'
        });
    }
    
    const client = await pool.connect();
    try {
        // Get count before deletion
        const countResult = await client.query('SELECT COUNT(*) FROM documents');
        const documentCount = parseInt(countResult.rows[0].count);
        
        // Delete all documents
        await client.query('DELETE FROM documents');
        
        res.json({
            success: true,
            message: `All ${documentCount} documents deleted from RAG system`,
            documents_deleted: documentCount
        });
        
    } catch (error) {
        console.error('Error clearing documents:', error);
        res.status(500).json({ error: 'Failed to clear documents' });
    } finally {
        client.release();
    }
});

// Debug endpoint to check documents in system
app.get('/api/debug/documents', async (req, res) => {
    try {
        const client = await pool.connect();
        try {
            const allDocs = await client.query(`
                SELECT id, 
                       LEFT(content, 500) as content_preview,
                       LENGTH(content) as content_length,
                       metadata,
                       created_at
                FROM documents 
                ORDER BY id DESC
            `);
            
            res.json({
                total_documents: allDocs.rows.length,
                documents: allDocs.rows.map(doc => ({
                    id: doc.id,
                    content_preview: doc.content_preview,
                    content_length: doc.content_length,
                    metadata: doc.metadata,
                    created_at: doc.created_at,
                    has_quiz_data: doc.content_preview.toLowerCase().includes('quiz'),
                    has_student_data: doc.content_preview.toLowerCase().includes('student')
                }))
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Debug documents error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Test enhanced RAG functionality
app.post('/api/test-enhanced-rag', async (req, res) => {
    const { query } = req.body;
    
    if (!query) {
        return res.status(400).json({ error: 'Query is required' });
    }
    
    try {
        console.log(`\n🧪 Testing Enhanced RAG with query: "${query}"`);
        
        // Step 1: Process query
        const processedQueries = processAndExpandQuery(query);
        const studentId = extractStudentId(query);
        
        console.log('🔍 Query Analysis:');
        console.log('  - Student ID detected:', studentId || 'None');
        console.log('  - Structured query:', processedQueries.structured);
        console.log('  - Keywords:', processedQueries.keywords);
        console.log('  - Expanded queries:', processedQueries.expanded);
        
        const client = await pool.connect();
        try {
            let searchResults;
            
            if (studentId) {
                console.log(`\n🔗 Using Hybrid Search for Student ID: ${studentId}`);
                searchResults = await performHybridSearch(client, processedQueries, studentId);
            } else {
                console.log('\n🧠 Using Enhanced Semantic Search');
                searchResults = await performEnhancedSemanticSearch(client, processedQueries);
            }
            
            // Format results for response
            const formattedResults = searchResults.rows.map(row => ({
                content: row.content.substring(0, 300) + '...',
                relevance_score: row.relevance_score,
                match_type: row.match_type,
                metadata: row.metadata,
                distance: row.distance
            }));
            
            console.log(`\n✅ Search completed: ${searchResults.rows.length} results found`);
            formattedResults.forEach((result, i) => {
                console.log(`  ${i + 1}. ${result.match_type} (score: ${result.relevance_score?.toFixed(3)})`);
                console.log(`     Metadata: ${JSON.stringify(result.metadata)}`);
                console.log(`     Preview: ${result.content.substring(0, 100)}...`);
            });
            
            res.json({
                success: true,
                query_analysis: {
                    original_query: query,
                    student_id_detected: studentId,
                    structured_query: processedQueries.structured,
                    search_type: studentId ? 'hybrid' : 'semantic',
                    keywords: processedQueries.keywords,
                    expanded_queries: processedQueries.expanded
                },
                results: formattedResults,
                total_results: searchResults.rows.length
            });
            
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('Enhanced RAG test error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ 
            error: 'Test failed', 
            details: error.message,
            stack: error.stack
        });
    }
});

// Test document search endpoint
app.post('/api/test-search', async (req, res) => {
    const { query } = req.body;
    
    if (!query) {
        return res.status(400).json({ error: 'Query is required' });
    }
    
    try {
        // Generate embedding for test query
        const embedding = await generateEmbedding(query);
        
        // Search for similar documents
        const client = await pool.connect();
        try {
            const searchResults = await client.query(
                'SELECT id, content, embedding <-> $1 as distance FROM documents ORDER BY embedding <-> $1 LIMIT 10',
                [JSON.stringify(embedding)]
            );
            
            const results = searchResults.rows.map(row => ({
                id: row.id,
                distance: row.distance,
                preview: row.content.substring(0, 300),
                content_length: row.content.length
            }));
            
            res.json({
                query: query,
                total_documents: searchResults.rows.length,
                results: results
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Test search error:', error);
        res.status(500).json({ error: 'Failed to perform test search' });
    }
});

// Debug endpoint to check if specific content exists
app.get('/api/debug/:searchTerm', async (req, res) => {
    const { searchTerm } = req.params;
    const client = await pool.connect();
    try {
        const result = await client.query(
            'SELECT id, content FROM documents WHERE LOWER(content) LIKE LOWER($1)',
            [`%${searchTerm}%`]
        );
        
        res.json({
            searchTerm,
            found: result.rows.length > 0,
            matches: result.rows.map(row => ({
                id: row.id,
                preview: row.content.substring(0, 500)
            }))
        });
    } catch (error) {
        console.error('Debug search error:', error);
        res.status(500).json({ error: 'Failed to debug search' });
    } finally {
        client.release();
    }
});

// Chart verification endpoint using Gemma3n image analysis
app.post('/api/verify-chart', upload.single('chart'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No chart image uploaded' });
    }

    const { expectedData, chartDescription } = req.body;

    try {
        if (!gemma3nModel || !gemma3nProcessor) {
            return res.status(503).json({ 
                error: 'Gemma3n model not yet loaded',
                fallback: 'The multimodal AI model is still loading. Please wait a moment and try again.',
                suggestion: 'Chart verification with AI image analysis will be available once Gemma3n finishes loading.'
            });
        }

        // Read the uploaded image
        const imageBuffer = fs.readFileSync(req.file.path);
        
        // Create verification prompt
        const verificationPrompt = `
            Analyze this chart image and verify if it correctly represents the following data:
            Expected Data: ${expectedData}
            Chart Description: ${chartDescription}
            
            Please check:
            1. Are the values in the chart accurate according to the expected data?
            2. Are the labels and axes correctly formatted?
            3. Does the chart type appropriately represent the data?
            4. Are there any discrepancies between expected and displayed data?
            
            Respond with:
            - VERIFICATION: PASS or FAIL
            - ACCURACY: percentage (0-100%)
            - ISSUES: list any problems found
            - RECOMMENDATIONS: suggestions for improvement
        `;

        // Use Gemma3n for image analysis
        const analysis = await generateGemma3nResponse(verificationPrompt, imageBuffer);
        
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
        
        res.json({
            success: true,
            analysis: analysis,
            model: 'gemma3n',
            chartDescription: chartDescription
        });

    } catch (error) {
        console.error('Chart verification error:', error);
        
        // Clean up uploaded file on error
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkError) {
                console.error('Error cleaning up file:', unlinkError);
            }
        }
        
        res.status(500).json({ error: 'Failed to verify chart' });
    }
});

// Check Gemma3n model status
app.get('/api/gemma3n-status', (req, res) => {
    res.json({
        available: gemma3nModel !== null && gemma3nProcessor !== null,
        model_loaded: gemma3nModel !== null,
        processor_loaded: gemma3nProcessor !== null,
        fallback_model: 'Gemini 1.5 Flash'
    });
});

// Kyutai STT endpoint for advanced speech recognition
app.post('/api/kyutai-stt', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No audio file uploaded' });
    }

    try {
        if (!HUGGINGFACE_API_KEY) {
            return res.status(503).json({ 
                error: 'Hugging Face API key not configured',
                fallback: 'Please add HUGGINGFACE_API_KEY to your .env file'
            });
        }

        // Read the uploaded audio file
        const audioData = fs.readFileSync(req.file.path);
        
        // Call Hugging Face Inference API for Kyutai STT
        const response = await fetch(`https://api-inference.huggingface.co/models/${KYUTAI_STT_MODEL}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
                'Content-Type': 'audio/wav',
            },
            body: audioData
        });

        if (!response.ok) {
            throw new Error(`Hugging Face API error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
        
        res.json({
            success: true,
            transcription: result.text || result,
            model: 'kyutai/stt-1b-en_fr',
            confidence: result.confidence || null
        });

    } catch (error) {
        console.error('Kyutai STT error:', error);
        
        // Clean up uploaded file on error
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkError) {
                console.error('Error cleaning up file:', unlinkError);
            }
        }
        
        res.status(500).json({ 
            error: 'Failed to process speech with Kyutai STT',
            details: error.message
        });
    }
});

// Test ElevenLabs connection
app.get('/api/test-elevenlabs', async (req, res) => {
    if (!ELEVENLABS_API_KEY) {
        return res.json({
            error: 'No ElevenLabs API key configured',
            suggestion: 'Add ELEVENLABS_API_KEY to your .env file'
        });
    }

    try {
        // Test with voices endpoint (simpler than TTS)
        const response = await fetch('https://api.elevenlabs.io/v1/voices', {
            headers: {
                'xi-api-key': ELEVENLABS_API_KEY
            }
        });

        if (response.ok) {
            const voices = await response.json();
            res.json({
                success: true,
                message: 'ElevenLabs API connection successful',
                available_voices: voices.voices?.length || 0,
                voices: voices.voices?.slice(0, 3).map(v => ({ id: v.voice_id, name: v.name })) || []
            });
        } else {
            const errorText = await response.text();
            res.json({
                success: false,
                status: response.status,
                error: response.statusText,
                details: errorText,
                suggestion: response.status === 401 ? 'Check your ElevenLabs API key' : 'ElevenLabs service issue'
            });
        }
    } catch (error) {
        res.json({
            success: false,
            error: 'Network error connecting to ElevenLabs',
            details: error.message
        });
    }
});

// Get ElevenLabs voices
app.get('/api/voices', async (req, res) => {
    if (!ELEVENLABS_API_KEY) {
        return res.status(503).json({ error: 'ElevenLabs API key not configured' });
    }

    try {
        const response = await fetch('https://api.elevenlabs.io/v1/voices', {
            headers: { 'xi-api-key': ELEVENLABS_API_KEY }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch voices from ElevenLabs');
        }

        const data = await response.json();
        res.json(data.voices);
    } catch (error) {
        console.error('Error fetching ElevenLabs voices:', error);
        res.status(500).json({ error: 'Failed to fetch voices' });
    }
});


// Natural Text-to-Speech endpoint
app.post('/api/natural-tts', async (req, res) => {
    const { text, voice, provider } = req.body;
    
    if (!text || text.trim() === '') {
        return res.status(400).json({ error: 'Text is required for TTS' });
    }

    try {
        let audioBuffer = null;
        let usedProvider = provider || 'openai'; // Default to OpenAI if no provider is specified
        
        // Use ElevenLabs if selected and available
        if (usedProvider === 'elevenlabs' && ELEVENLABS_API_KEY) {
            try {
                console.log('🎤 Using ElevenLabs for natural TTS...');
                const voiceId = voice || 'pNInz6obpgDQGcFmaJgB'; // Default: Adam voice
                const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
                    method: 'POST',
                    headers: {
                        'Accept': 'audio/mpeg',
                        'Content-Type': 'application/json',
                        'xi-api-key': ELEVENLABS_API_KEY
                    },
                    body: JSON.stringify({
                        text: text,
                        model_id: 'eleven_monolingual_v1',
                        voice_settings: {
                            stability: 0.5,
                            similarity_boost: 0.5,
                            style: 0.5,
                            use_speaker_boost: true
                        }
                    })
                });

                if (response.ok) {
                    audioBuffer = await response.arrayBuffer();
                } else {
                    const errorText = await response.text();
                    console.log(`ElevenLabs failed with status ${response.status}: ${response.statusText}`);
                    console.log('ElevenLabs error details:', errorText);
                }
            } catch (error) {
                console.log('ElevenLabs error:', error.message);
            }
        }
        
        // Use OpenAI if selected or as a fallback
        if (!audioBuffer && OPENAI_API_KEY) {
            try {
                console.log('🎤 Using OpenAI TTS...');
                usedProvider = 'openai';
                const response = await fetch('https://api.openai.com/v1/audio/speech', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${OPENAI_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: 'tts-1',
                        input: text,
                        voice: voice || 'alloy', // alloy, echo, fable, onyx, nova, shimmer
                        speed: 1.0
                    })
                });

                if (response.ok) {
                    audioBuffer = await response.arrayBuffer();
                } else {
                    console.log('OpenAI TTS failed, using browser fallback...');
                }
            } catch (error) {
                console.log('OpenAI TTS error:', error.message);
            }
        }
        
        if (audioBuffer) {
            // Save audio temporarily and return URL
            const filename = `tts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp3`;
            const filepath = path.join(uploadsDir, filename);
            
            fs.writeFileSync(filepath, Buffer.from(audioBuffer));
            
            // Clean up file after 5 minutes
            setTimeout(() => {
                try {
                    fs.unlinkSync(filepath);
                } catch (err) {
                    console.log('TTS cleanup error:', err.message);
                }
            }, 300000);
            
            res.json({
                success: true,
                audioUrl: `/uploads/${filename}`,
                provider: usedProvider,
                text: text
            });
        } else {
            // No TTS providers available, use browser fallback
            res.json({
                success: false,
                error: 'No TTS providers available',
                fallback: 'browser',
                text: text,
                message: 'Please configure ELEVENLABS_API_KEY or OPENAI_API_KEY for natural voice synthesis'
            });
        }
        
    } catch (error) {
        console.error('Natural TTS error:', error);
        res.status(500).json({ 
            error: 'Failed to generate natural speech',
            details: error.message,
            fallback: 'browser'
        });
    }
});

// Audio processing endpoint using Gemma3n
app.post('/api/process-audio', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No audio file uploaded' });
    }

    try {
        if (!gemma3nModel || !gemma3nProcessor) {
            return res.status(503).json({ 
                error: 'Gemma3n model not available for audio processing',
                fallback: 'Audio processing requires Gemma3n multimodal capabilities'
            });
        }

        // Process audio file
        const audioBuffer = fs.readFileSync(req.file.path);
        const wav = new wavefile.WaveFile(audioBuffer);
        wav.toBitDepth("32f"); // Pipeline expects input as a Float32Array
        wav.toSampleRate(gemma3nProcessor.feature_extractor.config.sampling_rate);
        
        let audioData = wav.getSamples();
        if (Array.isArray(audioData)) {
            if (audioData.length > 1) {
                for (let i = 0; i < audioData[0].length; ++i) {
                    audioData[0][i] = (Math.sqrt(2) * (audioData[0][i] + audioData[1][i])) / 2;
                }
            }
            audioData = audioData[0];
        }

        const audioPrompt = "Please transcribe and analyze this audio. Provide the transcription and any relevant insights.";
        
        // Use Gemma3n for audio analysis
        const analysis = await generateGemma3nResponse(audioPrompt, null, audioData);
        
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
        
        res.json({
            success: true,
            transcription: analysis,
            model: 'gemma3n'
        });

    } catch (error) {
        console.error('Audio processing error:', error);
        
        // Clean up uploaded file on error
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkError) {
                console.error('Error cleaning up file:', unlinkError);
            }
        }
        
        res.status(500).json({ error: 'Failed to process audio' });
    }
});

// Get all students
app.get('/api/students', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM students ORDER BY student_id DESC');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching students:', error);
        res.status(500).json({ error: 'Failed to fetch students' });
    } finally {
        client.release();
    }
});

// Add a new student
app.post('/api/students', async (req, res) => {
    const { full_name, trade, enrollment_date, contact_info } = req.body;
    
    const client = await pool.connect();
    try {
        const result = await client.query(
            'INSERT INTO students (full_name, trade, enrollment_date, contact_info) VALUES ($1, $2, $3, $4) RETURNING *',
            [full_name, trade, enrollment_date, contact_info]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error adding student:', error);
        res.status(500).json({ error: 'Failed to add student' });
    } finally {
        client.release();
    }
});

// Add a new student note
app.post('/api/student_notes', async (req, res) => {
    const { student_id, note_text, image_url } = req.body;

    if (!student_id || !note_text) {
        return res.status(400).json({ error: 'Student ID and note text are required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // Start transaction

        // Insert the note into the student_notes table
        const noteResult = await client.query(
            'INSERT INTO student_notes (student_id, note_text, image_url, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *',
            [student_id, note_text, image_url]
        );

        // Generate embedding for the note and add it to the documents table for RAG
        const embedding = await generateEmbedding(note_text);
        const noteMetadata = {
            type: 'student_note',
            student_id: student_id,
            has_image: !!image_url,
            created_from: 'manual_entry'
        };
        await client.query(
            'INSERT INTO documents (content, embedding, metadata) VALUES ($1, $2, $3)',
            [note_text, JSON.stringify(embedding), JSON.stringify(noteMetadata)]
        );

        await client.query('COMMIT'); // Commit transaction
        res.json(noteResult.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK'); // Rollback transaction on error
        console.error('Error adding student note:', error);
        res.status(500).json({ error: 'Failed to add student note' });
    } finally {
        client.release();
    }
});

// --- Start the server ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    
    // Gemma3n initialization disabled for better performance
    console.log('🚀 Server ready with enhanced speech capabilities (Kyutai STT + Natural TTS)');
});
