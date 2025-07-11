// Auto-detecting server that uses SQLite or PostgreSQL
require('dotenv').config();

// Check if PostgreSQL is configured
const USE_POSTGRES = process.env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_NAME);

console.log(`Starting server with ${USE_POSTGRES ? 'PostgreSQL' : 'SQLite'} database...`);

if (USE_POSTGRES) {
  // Use original PostgreSQL server
  require('./server_postgres.js');
} else {
  // Use SQLite server
  console.log('PostgreSQL not configured, using SQLite for demo');
  
  // First, update environment to use SQLite
  process.env.USE_SQLITE = 'true';
  
  // Monkey-patch pg module to use SQLite adapter
  const sqliteAdapter = require('./server_sqlite.js');
  
  // Override require for pg module
  const Module = require('module');
  const originalRequire = Module.prototype.require;
  
  Module.prototype.require = function(id) {
    if (id === 'pg') {
      return {
        Pool: class Pool {
          constructor() {
            this.query = sqliteAdapter.query;
          }
          async connect() {
            await sqliteAdapter.initDatabase();
            return {
              query: sqliteAdapter.query,
              release: () => {}
            };
          }
          end() {
            sqliteAdapter.db.close();
          }
        }
      };
    }
    return originalRequire.apply(this, arguments);
  };
  
  // Now require the original server
  require('./server_postgres.js');
}