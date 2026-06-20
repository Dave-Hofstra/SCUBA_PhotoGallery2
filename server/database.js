const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'scuba_gallery.sqlite');

let db = null;

function getDb() {
  if (!db) {
    // Ensure the data directory exists
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initializeSchema() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS libraries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      library_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (library_id) REFERENCES libraries(id) ON DELETE CASCADE,
      UNIQUE(library_id, name)
    );

    CREATE TABLE IF NOT EXISTS dive_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      latitude REAL,
      longitude REAL,
      dive_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      library_id INTEGER NOT NULL,
      category_id INTEGER,
      filename TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      original_path TEXT,
      thumbnail_path TEXT,
      display_path TEXT,
      title TEXT,
      country TEXT,
      dive_site_id INTEGER,
      dive_site_list_id INTEGER,
      species TEXT,
      camera_body TEXT,
      lens TEXT,
      housing TEXT,
      lighting TEXT,
      description TEXT,
      latitude REAL,
      longitude REAL,
      dive_count INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      metadata_complete INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (library_id) REFERENCES libraries(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
      FOREIGN KEY (dive_site_id) REFERENCES dive_sites(id) ON DELETE SET NULL,
      FOREIGN KEY (dive_site_list_id) REFERENCES dive_site_list(id) ON DELETE SET NULL,
      UNIQUE(library_id, relative_path)
    );

    CREATE INDEX IF NOT EXISTS idx_photos_library_id ON photos(library_id);
    CREATE INDEX IF NOT EXISTS idx_photos_category_id ON photos(category_id);
    CREATE INDEX IF NOT EXISTS idx_photos_dive_site_id ON photos(dive_site_id);
    CREATE TABLE IF NOT EXISTS dive_site_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dive_site_name TEXT NOT NULL,
      city_island TEXT,
      country_region TEXT,
      latitude REAL,
      longitude REAL,
      full_name TEXT,
      notes TEXT,
      dive_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_dive_sites_name ON dive_sites(name);
    CREATE INDEX IF NOT EXISTS idx_dive_site_list_name ON dive_site_list(dive_site_name);

    -- New: dives table imported from the CSV dive log
    CREATE TABLE IF NOT EXISTS dives (
      dive_number INTEGER PRIMARY KEY,
      dive_date TEXT,
      dive_site TEXT,
      city_island TEXT,
      country_region TEXT,
      max_depth REAL,
      dive_time INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrate: add dive_count column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE dive_site_list ADD COLUMN dive_count INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists — ignore
  }

  // Migrate: add display_name column to categories
  try {
    db.exec(`ALTER TABLE categories ADD COLUMN display_name TEXT`);
  } catch (e) {
    // Column already exists — ignore
  }

  // Migrate: add photo_taken_time column to photos
  try {
    db.exec(`ALTER TABLE photos ADD COLUMN photo_taken_time INTEGER`);
  } catch (e) {
    // Column already exists — ignore
  }

  // Migrate: add dive_number column to photos
  try {
    db.exec(`ALTER TABLE photos ADD COLUMN dive_number INTEGER REFERENCES dives(dive_number)`);
  } catch (e) {
    // Column already exists — ignore
  }

  // Migrate: add linked_photo_id column to photos (for Wall Photos → All-Time linking)
  try {
    db.exec(`ALTER TABLE photos ADD COLUMN linked_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL`);
  } catch (e) {
    // Column already exists — ignore
  }

  // Migrate: add category_dividers table
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS category_dividers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        sort_order REAL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
      )
    `);
  } catch (e) {
    // Table already exists — ignore
  }

  // Migrate: add photo_views table (session-based viewed tracking)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS photo_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        photo_id INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        viewed_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
        UNIQUE(photo_id, session_id)
      )
    `);
  } catch (e) {
    // Table already exists — ignore
  }

  // Migrate: add photo_likes table (session-based like tracking)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS photo_likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        photo_id INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
        UNIQUE(photo_id, session_id)
      )
    `);
  } catch (e) {
    // Table already exists — ignore
  }

  // Migrate: add login_attempts table for rate limiting audit
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_address TEXT NOT NULL,
        attempted_at TEXT DEFAULT (datetime('now')),
        success INTEGER NOT NULL DEFAULT 0
      )
    `);
  } catch (e) { /* Table already exists — ignore */ }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address)`);
  } catch (e) { /* ignore */ }

  // Migrate: add indexes for photo_views and photo_likes
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_photo_views_photo_id ON photo_views(photo_id)`);
  } catch (e) { /* ignore */ }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_photo_likes_photo_id ON photo_likes(photo_id)`);
  } catch (e) { /* ignore */ }

  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, initializeSchema, closeDb };