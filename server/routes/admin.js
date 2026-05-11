const express = require('express');
const router = express.Router();
const path = require('path');
const { getDb } = require('../database');
const { verifyPasscode } = require('../services/auth');
const { scanAllLibraries, cleanupDeletedPhotos } = require('../scanner');
const { processAllUnprocessed } = require('../imageProcessor');

// POST /api/admin/login
router.post('/login', (req, res) => {
  try {
    const { passcode } = req.body;
    const adminHash = process.env.ADMIN_PASSCODE_HASH;

    if (!adminHash) {
      return res.status(500).json({ error: 'Admin passcode not configured' });
    }

    if (verifyPasscode(passcode, adminHash)) {
      req.session.admin = true;
      return res.json({ success: true });
    }

    res.status(401).json({ error: 'Invalid passcode' });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/admin/logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

// GET /api/admin/check
router.get('/check', (req, res) => {
  res.json({ admin: !!(req.session && req.session.admin) });
});

// POST /api/admin/scan
router.post('/scan', (req, res) => {
  if (!req.session || !req.session.admin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const photosPath = process.env.PHOTOS_PATH || path.join(__dirname, '..', '..', 'photos');
    const results = scanAllLibraries(photosPath);
    res.json({ message: 'Scan complete', results });
  } catch (err) {
    console.error('Scan error:', err);
    res.status(500).json({ error: 'Scan failed', details: err.message });
  }
});

// POST /api/admin/sync
router.post('/sync', async (req, res) => {
  if (!req.session || !req.session.admin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const photosPath = process.env.PHOTOS_PATH || path.join(__dirname, '..', '..', 'photos');
    const cachePath = process.env.CACHE_PATH || path.join(__dirname, '..', '..', 'cache');

    // Step 1: Clean up deleted photos
    const cleanup = cleanupDeletedPhotos(cachePath);

    // Step 2: Scan for new photos
    const scanResults = scanAllLibraries(photosPath);

    // Step 3: Process unprocessed images
    const processResults = await processAllUnprocessed(cachePath);

    res.json({
      message: 'Sync complete',
      cleanup,
      scan: scanResults,
      processing: {
        total: processResults.length,
        succeeded: processResults.filter(r => r.success).length,
        failed: processResults.filter(r => !r.success).length,
        details: processResults
      }
    });
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ error: 'Sync failed', details: err.message });
  }
});

module.exports = router;
