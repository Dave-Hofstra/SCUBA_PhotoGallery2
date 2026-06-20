require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const session = require('express-session');
const path = require('path');
const { initializeSchema } = require('./database');
const SQLiteSessionStore = require('./services/sessionStore');
const { ensureLoginAttemptsTable } = require('./services/loginRateLimit');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy — required when running behind nginx reverse proxy
// Ensures req.protocol/req.secure reflect the original HTTPS connection
app.set('trust proxy', 1);

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(morgan('dev'));

// Session — stored in SQLite for persistence across container restarts
app.use(session({
  store: new SQLiteSessionStore(),
  secret: process.env.SESSION_SECRET || 'scuba-gallery-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year — long-lived for returning visitor tracking
  }
}));

// Serve cached images statically
const cachePath = process.env.CACHE_PATH || path.join(__dirname, '..', 'cache');
app.use('/cache', express.static(cachePath, {
  maxAge: '7d',
  immutable: true
}));

// Serve original photos statically (read-only)
const photosPath = process.env.PHOTOS_PATH || path.join(__dirname, '..', 'photos');
app.use('/photos', express.static(photosPath));

// API routes
app.use('/api/libraries', require('./routes/libraries'));
app.use('/api', require('./routes/photos'));
app.use('/api/dive-sites', require('./routes/diveSites'));
app.use('/api/dive-site-list', require('./routes/diveSiteList'));
app.use('/api/admin', require('./routes/admin'));

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize database schema on startup
initializeSchema();
ensureLoginAttemptsTable();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SCUBA Photo Gallery 2 API running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});