require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
  ssl: {
    rejectUnauthorized: false
  }
});

async function initDatabase() {
  try {
    console.log('Starting database initialization...');
    
    const createTables = `
      -- Enable pgvector extension
      CREATE EXTENSION IF NOT EXISTS vector;

      -- Create documents table for RAG
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        embedding VECTOR(3072) -- Default dimension for embedding-001 model
      );

      -- Create tables
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

      -- Create indexes for better performance
      CREATE INDEX IF NOT EXISTS idx_student_status_date ON student_status(status_date);
      CREATE INDEX IF NOT EXISTS idx_student_status_student ON student_status(student_id);
      CREATE INDEX IF NOT EXISTS idx_donations_investor ON donations(investor_id);
      CREATE INDEX IF NOT EXISTS idx_donations_date ON donations(donation_date);
      CREATE INDEX IF NOT EXISTS idx_student_notes_student ON student_notes(student_id);
      CREATE INDEX IF NOT EXISTS idx_staff_notes_staff ON staff_notes(staff_id);
    `;

    await pool.query(createTables);
    console.log('Tables created successfully!');

    // Check if default admin user exists
    const checkAdmin = await pool.query('SELECT * FROM users WHERE username = $1', ['admin']);
    
    if (checkAdmin.rows.length === 0) {
      // Create default admin user
      const bcrypt = require('bcrypt');
      const hashedPassword = await bcrypt.hash('admin123', 10);
      
      await pool.query(
        'INSERT INTO users (username, password, email, role) VALUES ($1, $2, $3, $4)',
        ['admin', hashedPassword, 'admin@gabta.org', 'admin']
      );
      console.log('Default admin user created (username: admin, password: admin123)');
    }

    // Insert sample data
    const checkStudents = await pool.query('SELECT COUNT(*) FROM students');
    
    if (checkStudents.rows[0].count === '0') {
      console.log('Inserting sample data...');
      
      // Sample students
      await pool.query(`
        INSERT INTO students (full_name, trade, contact_info) VALUES
        ('John Doe', 'Electrician', '{"email": "parent1@email.com"}'),
        ('Jane Smith', 'Plumbing', '{"email": "parent2@email.com"}'),
        ('Michael Johnson', 'HVAC', '{"email": "parent3@email.com"}'),
        ('Sarah Williams', 'Carpentry', '{"email": "parent4@email.com"}')
      `);

      // Sample programs
      await pool.query(`
        INSERT INTO programs (program_name, description, start_date) VALUES
        ('After School Tutoring', 'Daily tutoring program for math and science', '2024-01-01'),
        ('Weekend Mentorship', 'Career guidance and life skills program', '2024-01-15'),
        ('Summer Camp', 'Educational summer activities', '2024-06-01')
      `);

      // Sample staff
      await pool.query(`
        INSERT INTO staff (first_name, last_name, role, email) VALUES
        ('Emily', 'Brown', 'Program Coordinator', 'emily@gabta.org'),
        ('David', 'Wilson', 'Instructor', 'david@gabta.org'),
        ('Lisa', 'Garcia', 'Counselor', 'lisa@gabta.org')
      `);

      // Sample investors
      await pool.query(`
        INSERT INTO investors (name, organization, email, donation_total) VALUES
        ('Tech Foundation', 'Tech Foundation Inc.', 'info@techfoundation.org', 50000),
        ('Community Partners', 'Local Business Alliance', 'donate@partners.org', 25000),
        ('Education First', 'Education First Charity', 'support@edufirst.org', 75000)
      `);

      console.log('Sample data inserted successfully!');
    }

    console.log('Database initialization complete!');
    
  } catch (error) {
    console.error('Error initializing database:', error);
  } finally {
    await pool.end();
  }
}

initDatabase();