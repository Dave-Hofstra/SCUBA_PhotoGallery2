require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const session = require('express-session');
const path = require('path');
const { initializeSchema } = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(morgan('dev'));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'scuba-gallery-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize database schema on startup
try {
  initializeSchema();
  console.log('Database schema initialized');
} catch (err) {
  console.error('Failed to initialize database schema:', err);
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`SCUBA Photo Gallery server running on port ${PORT}`);
  console.log(`Photos path: ${photosPath}`);
  console.log(`Cache path: ${cachePath}`);
});