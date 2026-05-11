const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// GET /api/dive-site-list — list all dive sites
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const sites = db.prepare('SELECT * FROM dive_site_list ORDER BY country_region, city_island, dive_site_name').all();
    res.json(sites);
  } catch (err) {
    console.error('Error fetching dive site list:', err);
    res.status(500).json({ error: 'Failed to fetch dive site list' });
  }
});

// GET /api/dive-site-list/search?q= — search dive sites
router.get('/search', (req, res) => {
  try {
    const db = getDb();
    const q = req.query.q || '';
    const sites = db.prepare(`
      SELECT * FROM dive_site_list
      WHERE dive_site_name LIKE ? OR city_island LIKE ? OR country_region LIKE ? OR full_name LIKE ?
      ORDER BY country_region, city_island, dive_site_name
      LIMIT 50
    `).all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    res.json(sites);
  } catch (err) {
    console.error('Error searching dive sites:', err);
    res.status(500).json({ error: 'Failed to search dive sites' });
  }
});

// POST /api/dive-site-list — add a new dive site
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { dive_site_name, city_island, country_region, latitude, longitude, full_name, notes } = req.body;

    if (!dive_site_name || !dive_site_name.trim()) {
      return res.status(400).json({ error: 'Dive site name is required' });
    }

    const result = db.prepare(`
      INSERT INTO dive_site_list (dive_site_name, city_island, country_region, latitude, longitude, full_name, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      dive_site_name.trim(),
      city_island || null,
      country_region || null,
      latitude != null ? latitude : null,
      longitude != null ? longitude : null,
      full_name || null,
      notes || null
    );

    const site = db.prepare('SELECT * FROM dive_site_list WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(site);
  } catch (err) {
    console.error('Error adding dive site:', err);
    res.status(500).json({ error: 'Failed to add dive site' });
  }
});

// PUT /api/dive-site-list/:id — update a dive site
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { dive_site_name, city_island, country_region, latitude, longitude, full_name, notes } = req.body;

    const existing = db.prepare('SELECT * FROM dive_site_list WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Dive site not found' });
    }

    db.prepare(`
      UPDATE dive_site_list SET
        dive_site_name = ?,
        city_island = ?,
        country_region = ?,
        latitude = ?,
        longitude = ?,
        full_name = ?,
        notes = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      dive_site_name != null ? dive_site_name.trim() : existing.dive_site_name,
      city_island !== undefined ? city_island : existing.city_island,
      country_region !== undefined ? country_region : existing.country_region,
      latitude !== undefined ? latitude : existing.latitude,
      longitude !== undefined ? longitude : existing.longitude,
      full_name !== undefined ? full_name : existing.full_name,
      notes !== undefined ? notes : existing.notes,
      id
    );

    const updated = db.prepare('SELECT * FROM dive_site_list WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) {
    console.error('Error updating dive site:', err);
    res.status(500).json({ error: 'Failed to update dive site' });
  }
});

// DELETE /api/dive-site-list/:id — delete a dive site
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM dive_site_list WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Dive site not found' });
    }

    db.prepare('DELETE FROM dive_site_list WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting dive site:', err);
    res.status(500).json({ error: 'Failed to delete dive site' });
  }
});

module.exports = router;