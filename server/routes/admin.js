const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getDb } = require('../database');
const { verifyPasscode } = require('../services/auth');
const { loginRateLimiter, logLoginAttempt, checkBlocked } = require('../services/loginRateLimit');
const { scanAllLibraries, cleanupDeletedPhotos } = require('../scanner');
const { processAllUnprocessed } = require('../imageProcessor');
const { runImport } = require('../scripts/import-dive-sites');

// Configure multer for file uploads
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'Extra_Assets', 'DiveLog_Imports');
const upload = multer({ dest: UPLOAD_DIR });

// POST /api/admin/login
router.post('/login', loginRateLimiter, (req, res) => {
  try {
    const { passcode } = req.body;
    const adminHash = process.env.ADMIN_PASSCODE_HASH;
    const ip = req.ip || req.connection.remoteAddress;

    if (!adminHash) {
      return res.status(500).json({ error: 'Admin passcode not configured' });
    }

    // Check if IP is blocked due to excessive failed attempts
    const blocked = checkBlocked(ip);
    if (blocked.blocked) {
      logLoginAttempt(ip, false);
      return res.status(429).json({ error: blocked.reason });
    }

    if (verifyPasscode(passcode, adminHash)) {
      req.session.admin = true;
      logLoginAttempt(ip, true);
      return res.json({ success: true });
    }

    // Log the failed attempt
    logLoginAttempt(ip, false);
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

// PUT /api/admin/photos/reorder
// Reorder photos by providing an array of photo IDs in the new order
router.put('/photos/reorder', (req, res) => {
  if (!req.session || !req.session.admin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getDb();
    const { photoIds } = req.body;

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return res.status(400).json({ error: 'photoIds array is required' });
    }

    // Update each photo's sort_order to match its position in the array
    const stmt = db.prepare('UPDATE photos SET sort_order = ?, updated_at = datetime(\'now\') WHERE id = ?');
    const updateMany = db.transaction((ids) => {
      ids.forEach((id, index) => {
        stmt.run(index, id);
      });
    });

    updateMany(photoIds);

    res.json({ success: true, count: photoIds.length });
  } catch (err) {
    console.error('Error reordering photos:', err);
    res.status(500).json({ error: 'Failed to reorder photos' });
  }
});

// POST /api/admin/import-dive-data
// Upload .dlexch and/or .csv files, save to Extra_Assets/DiveLog_Imports, then run import
router.post('/import-dive-data', upload.fields([
  { name: 'dlexch', maxCount: 1 },
  { name: 'csv', maxCount: 1 }
]), (req, res) => {
  if (!req.session || !req.session.admin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const uploaded = { dlexch: null, csv: null };

    // Process .dlexch file if uploaded
    if (req.files && req.files.dlexch && req.files.dlexch[0]) {
      const file = req.files.dlexch[0];
      // Validate extension
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext !== '.dlexch') {
        // Clean up temp file
        fs.unlinkSync(file.path);
        return res.status(400).json({ error: 'Invalid file type for dive sites. Expected .dlexch file.' });
      }
      // Rename to preserve original name
      const destPath = path.join(UPLOAD_DIR, file.originalname);
      fs.renameSync(file.path, destPath);
      uploaded.dlexch = destPath;
    }

    // Process .csv file if uploaded
    if (req.files && req.files.csv && req.files.csv[0]) {
      const file = req.files.csv[0];
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext !== '.csv') {
        if (uploaded.dlexch) fs.unlinkSync(uploaded.dlexch);
        fs.unlinkSync(file.path);
        return res.status(400).json({ error: 'Invalid file type for dive log. Expected .csv file.' });
      }
      const destPath = path.join(UPLOAD_DIR, file.originalname);
      fs.renameSync(file.path, destPath);
      uploaded.csv = destPath;
    }

    if (!uploaded.dlexch && !uploaded.csv) {
      return res.status(400).json({ error: 'No files uploaded. Please select a .dlexch and/or .csv file.' });
    }

    // Run the import with the uploaded files
    const result = runImport(uploaded.dlexch, uploaded.csv);

    res.json({
      message: 'Import complete',
      files: {
        dlexch: req.files?.dlexch?.[0]?.originalname || null,
        csv: req.files?.csv?.[0]?.originalname || null
      },
      result
    });
  } catch (err) {
    console.error('Import dive data error:', err);
    res.status(500).json({ error: 'Import failed: ' + err.message });
  }
});

// POST /api/admin/categories/:categoryId/dividers
// Create a new sub-category divider
router.post('/categories/:categoryId/dividers', (req, res) => {
  if (!req.session || !req.session.admin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getDb();
    const { categoryId } = req.params;
    const { title } = req.body;

    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'title is required' });
    }

    // Verify category exists
    const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Get the max sort_order for dividers in this category and add 1
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM category_dividers WHERE category_id = ?').get(categoryId);
    const sortOrder = maxOrder.next_order;

    const result = db.prepare(`
      INSERT INTO category_dividers (category_id, title, sort_order)
      VALUES (?, ?, ?)
    `).run(categoryId, title, sortOrder);

    const divider = db.prepare('SELECT * FROM category_dividers WHERE id = ?').get(result.lastInsertRowid);
    res.json(divider);
  } catch (err) {
    console.error('Error creating divider:', err);
    res.status(500).json({ error: 'Failed to create divider' });
  }
});

// PUT /api/admin/dividers/:id
// Update a divider's title
router.put('/dividers/:id', (req, res) => {
  if (!req.session || !req.session.admin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getDb();
    const { id } = req.params;
    const { title } = req.body;

    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'title is required' });
    }

    const existing = db.prepare('SELECT id FROM category_dividers WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Divider not found' });
    }

    db.prepare('UPDATE category_dividers SET title = ? WHERE id = ?').run(title, id);

    const divider = db.prepare('SELECT * FROM category_dividers WHERE id = ?').get(id);
    res.json(divider);
  } catch (err) {
    console.error('Error updating divider:', err);
    res.status(500).json({ error: 'Failed to update divider' });
  }
});

// DELETE /api/admin/dividers/:id
// Delete a divider
router.delete('/dividers/:id', (req, res) => {
  if (!req.session || !req.session.admin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT id FROM category_dividers WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Divider not found' });
    }

    db.prepare('DELETE FROM category_dividers WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting divider:', err);
    res.status(500).json({ error: 'Failed to delete divider' });
  }
});

// PUT /api/admin/categories/:categoryId/dividers/reorder
// Reorder dividers within a category
router.put('/categories/:categoryId/dividers/reorder', (req, res) => {
  if (!req.session || !req.session.admin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getDb();
    const { categoryId } = req.params;
    const { dividerOrders } = req.body;

    if (!Array.isArray(dividerOrders)) {
      return res.status(400).json({ error: 'dividerOrders array is required' });
    }

    const stmt = db.prepare('UPDATE category_dividers SET sort_order = ? WHERE id = ? AND category_id = ?');
    const updateMany = db.transaction((orders) => {
      orders.forEach((item) => {
        const sortOrder = item.sort_order !== undefined ? item.sort_order : 0;
        stmt.run(sortOrder, item.id, categoryId);
      });
    });

    updateMany(dividerOrders);
    res.json({ success: true, count: dividerOrders.length });
  } catch (err) {
    console.error('Error reordering dividers:', err);
    res.status(500).json({ error: 'Failed to reorder dividers' });
  }
});

module.exports = router;
