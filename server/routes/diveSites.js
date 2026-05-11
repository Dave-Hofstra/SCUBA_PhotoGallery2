const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// GET /api/dive-sites
// Returns all dive sites from the master dive_site_list table for map markers
router.get('/', (req, res) => {
  try {
    const db = getDb();

    const sites = db.prepare(`
      SELECT
        dsl.id,
        dsl.dive_site_name,
        dsl.city_island,
        dsl.country_region,
        dsl.latitude,
        dsl.longitude,
        dsl.full_name,
        dsl.dive_count,
        (SELECT COUNT(*) FROM photos p WHERE p.dive_site_list_id = dsl.id) as photo_count
      FROM dive_site_list dsl
      WHERE dsl.latitude IS NOT NULL AND dsl.longitude IS NOT NULL
      ORDER BY dsl.country_region, dsl.city_island, dsl.dive_site_name
    `).all();

    res.json(sites);
  } catch (err) {
    console.error('Error fetching dive sites:', err);
    res.status(500).json({ error: 'Failed to fetch dive sites' });
  }
});

module.exports = router;