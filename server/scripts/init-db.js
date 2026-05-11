/**
 * Initialize the SQLite database schema.
 * Run with: node scripts/init-db.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { initializeSchema, closeDb } = require('../database');

console.log('Initializing database schema...');

try {
  initializeSchema();
  console.log('Database schema created successfully.');
} catch (err) {
  console.error('Failed to initialize database:', err);
  process.exit(1);
} finally {
  closeDb();
}