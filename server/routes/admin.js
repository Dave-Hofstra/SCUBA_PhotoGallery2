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

// PUT /api/admin/categories/:categoryId
// Update a category's display_name and write to CustomTitle.txt in the category folder
router.put('/categories/:categoryId', (req, res) => {
  if (!req.session || !req.session.admin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getDb();
    const { categoryId } = req.params;
    const { display_name } = req.body;

    if (!display_name || typeof display_name !== 'string') {
      return res.status(400).json({ error: 'display_name is required' });
    }

    // Get the category to find its folder path
    const category = db.prepare(`
      SELECT c.id, c.name, c.library_id, l.path AS library_path
      FROM categories c
      JOIN libraries l ON c.library_id = l.id
      WHERE c.id = ?
    `).get(categoryId);

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Update the database
    db.prepare('UPDATE categories SET display_name = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(display_name, categoryId);

    // Write to CustomTitle.txt in the category folder
    const categoryPath = path.join(category.library_path, category.name);
    const customTitlePath = path.join(categoryPath, 'CustomTitle.txt');
    try {
      fs.writeFileSync(customTitlePath, display_name + '\n', 'utf-8');
    } catch (err) {
      console.error(`Could not write CustomTitle.txt: ${err.message}`);
      // Still return success since DB was updated
    }

    res.json({ success: true, display_name });
  } catch (err) {
    console.error('Error updating category:', err);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

module.exports = router;
