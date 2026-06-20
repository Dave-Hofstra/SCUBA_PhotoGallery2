/**
 * SQLite session store for express-session using better-sqlite3.
 * Extends session.Store for proper integration with express-session.
 * Persists sessions in the main SQLite database so they survive container restarts.
 */
const session = require('express-session');
const { getDb } = require('../database');

class SQLiteSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.ttl = options.ttl || 86400; // 24 hours default
    this.cleanupInterval = options.cleanupInterval || 900000; // 15 min default

    // Ensure sessions table exists
    this._ensureTable();

    // Periodic cleanup of expired sessions
    if (this.cleanupInterval > 0) {
      this._cleanupTimer = setInterval(() => this._cleanup(), this.cleanupInterval);
      this._cleanupTimer.unref();
    }
  }

  _ensureTable() {
    try {
      getDb().exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          sid TEXT PRIMARY KEY,
          expires INTEGER,
          data TEXT NOT NULL
        )
      `);
      try {
        getDb().exec(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires)`);
      } catch (e) { /* ignore */ }
    } catch (e) {
      console.error('Failed to create sessions table:', e);
    }
  }

  _cleanup() {
    try {
      const db = getDb();
      const now = Math.floor(Date.now() / 1000);
      db.prepare('DELETE FROM sessions WHERE expires IS NOT NULL AND expires < ?').run(now);
    } catch (e) {
      // Silently ignore cleanup errors
    }
  }

  /**
   * Get a session by SID.
   */
  get(sid, callback) {
    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM sessions WHERE sid = ?').get(sid);
      if (!row) {
        return callback(null, null);
      }

      // Check expiration
      if (row.expires && row.expires < Math.floor(Date.now() / 1000)) {
        this.destroy(sid, () => {});
        return callback(null, null);
      }

      let sessionData = null;
      try {
        sessionData = JSON.parse(row.data);
      } catch (e) {
        return callback(null, null);
      }

      callback(null, sessionData);
    } catch (err) {
      callback(err);
    }
  }

  /**
   * Set a session.
   */
  set(sid, sessionData, callback) {
    try {
      const db = getDb();
      const data = JSON.stringify(sessionData);

      // Calculate expiration from cookie.maxAge
      let expires = null;
      if (sessionData && sessionData.cookie && sessionData.cookie.maxAge) {
        expires = Math.floor((Date.now() + sessionData.cookie.maxAge) / 1000);
      } else {
        expires = Math.floor(Date.now() / 1000) + this.ttl;
      }

      db.prepare(`
        INSERT OR REPLACE INTO sessions (sid, expires, data)
        VALUES (?, ?, ?)
      `).run(sid, expires, data);

      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  /**
   * Destroy a session.
   */
  destroy(sid, callback) {
    try {
      const db = getDb();
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  /**
   * Touch a session (update expiration without changing data).
   */
  touch(sid, sessionData, callback) {
    try {
      const db = getDb();
      let expires = null;
      if (sessionData && sessionData.cookie && sessionData.cookie.maxAge) {
        expires = Math.floor((Date.now() + sessionData.cookie.maxAge) / 1000);
      } else {
        expires = Math.floor(Date.now() / 1000) + this.ttl;
      }

      db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?').run(expires, sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  /**
   * Clean up timer when store is destroyed.
   */
  close() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }
}

module.exports = SQLiteSessionStore;