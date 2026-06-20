/**
 * Login rate limiting and audit logging for admin authentication.
 * Uses express-rate-limit with a SQLite-backed store to track
 * failed attempts per IP and enforce progressive backoff.
 */
const rateLimit = require('express-rate-limit');
const { getDb } = require('../database');

/**
 * Ensure the login_attempts table exists in the database.
 */
function ensureLoginAttemptsTable() {
  try {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_address TEXT NOT NULL,
        attempted_at TEXT DEFAULT (datetime('now')),
        success INTEGER NOT NULL DEFAULT 0
      )
    `);
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address)`);
    } catch (e) { /* ignore */ }
  } catch (e) {
    console.error('Failed to create login_attempts table:', e);
  }
}

/**
 * Log a login attempt to the database.
 * @param {string} ip - The IP address of the requester
 * @param {boolean} success - Whether the login was successful
 */
function logLoginAttempt(ip, success) {
  try {
    const db = getDb();
    db.prepare('INSERT INTO login_attempts (ip_address, success) VALUES (?, ?)').run(ip, success ? 1 : 0);
  } catch (e) {
    console.error('Failed to log login attempt:', e);
  }
}

/**
 * Get the count of failed login attempts for an IP within the last N minutes.
 * @param {string} ip - The IP address to check
 * @param {number} minutes - The time window in minutes (default: 1)
 * @returns {number} The count of failed attempts
 */
function getFailedAttempts(ip, minutes = 1) {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString().replace('T', ' ').split('.')[0];
    const row = db.prepare(
      'SELECT COUNT(*) AS count FROM login_attempts WHERE ip_address = ? AND success = 0 AND attempted_at >= ?'
    ).get(ip, cutoff);
    return row ? row.count : 0;
  } catch (e) {
    return 0;
  }
}

/**
 * Check if an IP is currently blocked (5+ failures in 1 minute, or sustained bursts).
 * Uses progressive backoff: after 3+ bursts of 5 failures, block for 1 hour.
 * @param {string} ip - The IP address to check
 * @returns {{ blocked: boolean, reason: string|null }}
 */
function checkBlocked(ip) {
  try {
    const db = getDb();
    // Check for 1-hour block: 15+ failures in the last hour = sustained attack
    const hourCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace('T', ' ').split('.')[0];
    const hourBlocked = db.prepare(
      'SELECT COUNT(*) AS count FROM login_attempts WHERE ip_address = ? AND success = 0 AND attempted_at >= ?'
    ).get(ip, hourCutoff);

    if (hourBlocked && hourBlocked.count >= 15) {
      return { blocked: true, reason: 'Too many failed attempts. Please try again later.' };
    }

    // Check for 1-minute burst: 5+ failures in 1 minute
    const recent = getFailedAttempts(ip, 1);
    if (recent >= 5) {
      return { blocked: true, reason: 'Too many attempts. Please wait 1 minute and try again.' };
    }

    return { blocked: false, reason: null };
  } catch (e) {
    return { blocked: false, reason: null };
  }
}

// Create the rate limiter middleware
const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 10, // Allow up to 10 requests per minute per IP (soft limit)
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    // Log the blocked attempt
    logLoginAttempt(req.ip || req.connection.remoteAddress, false);
    res.status(429).json({
      error: 'Too many requests. Please wait a moment before trying again.'
    });
  },
  skipSuccessfulRequests: false // Count all requests to /login
});

module.exports = {
  ensureLoginAttemptsTable,
  logLoginAttempt,
  getFailedAttempts,
  checkBlocked,
  loginRateLimiter
};