const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// GET /api/libraries
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const libraries = db.prepare(`
      SELECT
        l.id,
        l.name,
        l.display_name,
        l.path,
        l.created_at,
        l.updated_at,
        (SELECT COUNT(*) FROM photos WHERE library_id = l.id) AS photo_count
      FROM libraries l
      ORDER BY l.name
    `).all();
    res.json(libraries);
  } catch (err) {
    console.error('Error fetching libraries:', err);
    res.status(500).json({ error: 'Failed to fetch libraries' });
  }
});

module.exports = router;