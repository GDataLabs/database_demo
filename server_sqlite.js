// SQLite adapter for server.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create SQLite database file
const dbPath = process.env.SQLITE_PATH || path.join(__dirname, 'data', 'gabta.db');
const db = new sqlite3.Database(dbPath);

// Helper to run queries with promise support
const runQuery = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

const getQuery = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const allQuery = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Initialize database tables
const initDatabase = async () => {
  try {
    // Users table
    await runQuery(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL
      )
    `);

    // Students table
    await runQuery(`
      CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        assessment_score REAL,
        excel_score REAL,
        typing_score INTEGER,
        english_level TEXT,
        attendance TEXT,
        employment_status TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Student notes table
    await runQuery(`
      CREATE TABLE IF NOT EXISTS student_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        note TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students (id)
      )
    `);

    // Documents table
    await runQuery(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        pinecone_ids TEXT,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Quiz tables
    await runQuery(`
      CREATE TABLE IF NOT EXISTS quizzes (
        quiz_id INTEGER PRIMARY KEY AUTOINCREMENT,
        quiz_name TEXT NOT NULL,
        total_questions INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS quiz_results (
        result_id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        quiz_id INTEGER NOT NULL,
        score REAL,
        completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students (id),
        FOREIGN KEY (quiz_id) REFERENCES quizzes (quiz_id)
      )
    `);

    console.log('SQLite database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
};

// Export database connection and query functions
module.exports = {
  db,
  runQuery,
  getQuery,
  allQuery,
  initDatabase,
  // PostgreSQL compatibility layer
  query: async (text, params = []) => {
    // Convert PostgreSQL placeholders ($1, $2) to SQLite (?, ?)
    const sqliteQuery = text.replace(/\$(\d+)/g, '?');
    
    if (text.toLowerCase().startsWith('select')) {
      const rows = await allQuery(sqliteQuery, params);
      return { rows };
    } else {
      const result = await runQuery(sqliteQuery, params);
      return { rows: [], ...result };
    }
  }
};