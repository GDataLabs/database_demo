#!/usr/bin/env node

// Startup script that initializes SQLite if PostgreSQL is not available
require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Check if PostgreSQL is configured
const hasPostgres = process.env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_NAME);

if (!hasPostgres) {
  console.log('PostgreSQL not configured. Setting up SQLite for demo...');
  
  // Create data directory
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
  }
  
  // Set SQLite environment variables
  process.env.USE_SQLITE = 'true';
  process.env.SQLITE_PATH = path.join(dataDir, 'gabta.db');
  
  // Initialize SQLite database
  const sqliteAdapter = require('./server_sqlite.js');
  sqliteAdapter.initDatabase().then(() => {
    console.log('SQLite database initialized');
    
    // Add demo users
    const bcrypt = require('bcrypt');
    const demoUsers = [
      { username: 'instructor', email: 'instructor@demo.com', password: 'demo123', role: 'instructor' },
      { username: 'director', email: 'director@demo.com', password: 'demo123', role: 'director' }
    ];
    
    Promise.all(demoUsers.map(async user => {
      const hashedPassword = await bcrypt.hash(user.password, 10);
      try {
        await sqliteAdapter.runQuery(
          'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
          [user.username, user.email, hashedPassword, user.role]
        );
        console.log(`Created demo user: ${user.username} (password: ${user.password})`);
      } catch (err) {
        if (!err.message.includes('UNIQUE constraint failed')) {
          console.error(`Error creating user ${user.username}:`, err.message);
        }
      }
    })).then(() => {
      // Start the server
      require('./server.js');
    });
  }).catch(err => {
    console.error('Failed to initialize SQLite:', err);
    process.exit(1);
  });
} else {
  // Use PostgreSQL
  console.log('Using PostgreSQL database');
  require('./server.js');
}