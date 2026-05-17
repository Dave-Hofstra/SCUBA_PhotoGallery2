const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// GET /api/libraries/:libraryId/photos
router.get('/libraries/:libraryId/photos', (req, res) => {
  try {
    const db = getDb();
    const { libraryId } = req.params;

    // Verify library exists
    const library = db.prepare('SELECT id, name, display_name FROM libraries WHERE id = ?').get(libraryId);
    if (!library) {
      return res.status(404).json({ error: 'Library not found' });
    }

    // Get photos grouped by category
    const photos = db.prepare(`
      SELECT
        p.id,
        p.filename,
        p.relative_path,
        p.thumbnail_path,
        p.display_path,
        p.title,
        p.country,
        p.species,
        p.camera_body,
        p.lens,
        p.housing,
        p.lighting,
        p.description,
        COALESCE(p.latitude, dsl.latitude) AS latitude,
        COALESCE(p.longitude, dsl.longitude) AS longitude,
        COALESCE(p.country, dsl.city_island) AS country,
        dsl.dive_count AS dive_count,
        p.sort_order,
        p.metadata_complete,
        p.dive_site_list_id,
        c.id AS category_id,
        c.name AS category_name,
        c.display_name AS category_display_name,
        c.sort_order AS category_sort_order,
        ds.id AS dive_site_id,
        ds.name AS dive_site,
        dsl.dive_site_name,
        dsl.city_island,
        dsl.country_region
      FROM photos p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN dive_sites ds ON p.dive_site_id = ds.id
      LEFT JOIN dive_site_list dsl ON p.dive_site_list_id = dsl.id
      WHERE p.library_id = ?
      ORDER BY c.sort_order, p.sort_order, p.filename
    `).all(libraryId);

    // Group by category
    const grouped = {};
    photos.forEach(photo => {
      const catName = photo.category_name || 'Uncategorized';
      if (!grouped[catName]) {
        // Use custom display_name from DB if set, otherwise strip leading number prefix
        const displayName = photo.category_display_name || catName.replace(/^\d{2}_/, '');
        grouped[catName] = {
          category_id: photo.category_id,
          category_name: catName,
          display_name: displayName,
          category_sort_order: photo.category_sort_order || 0,
          photos: []
        };
      }
      grouped[catName].photos.push(photo);
    });

    const result = Object.values(grouped).sort((a, b) => a.category_sort_order - b.category_sort_order);

    // Also return a flat list for navigation
    res.json({
      library,
      categories: result,
      photos: photos
    });
  } catch (err) {
    console.error('Error fetching photos:', err);
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
});

// GET /api/photos/:photoId
router.get('/photos/:photoId', (req, res) => {
  try {
    const db = getDb();
    const { photoId } = req.params;

    const photo = db.prepare(`
      SELECT
        p.id,
        p.filename,
        p.relative_path,
        p.original_path,
        p.thumbnail_path,
        p.display_path,
        p.title,
        p.country,
        p.species,
        p.camera_body,
        p.lens,
        p.housing,
        p.lighting,
        p.description,
        COALESCE(p.latitude, dsl.latitude) AS latitude,
        COALESCE(p.longitude, dsl.longitude) AS longitude,
        COALESCE(p.country, dsl.city_island) AS country,
        dsl.dive_count AS dive_count,
        p.sort_order,
        p.metadata_complete,
        p.dive_site_list_id,
        p.created_at,
        p.updated_at,
        c.id AS category_id,
        c.name AS category_name,
        c.display_name AS category_display_name,
        ds.id AS dive_site_id,
        ds.name AS dive_site_name,
        dsl.dive_site_name,
        dsl.city_island,
        dsl.country_region
      FROM photos p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN dive_sites ds ON p.dive_site_id = ds.id
      LEFT JOIN dive_site_list dsl ON p.dive_site_list_id = dsl.id
      WHERE p.id = ?
    `).get(photoId);

    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    res.json(photo);
  } catch (err) {
    console.error('Error fetching photo:', err);
    res.status(500).json({ error: 'Failed to fetch photo' });
  }
});

// PUT /api/photos/:photoId (admin only)
router.put('/photos/:photoId', (req, res) => {
  if (!req.session || !req.session.admin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getDb();
    const { photoId } = req.params;
    const {
      title, species, camera_body, lens, lighting,
      description, dive_site_list_id, sort_order
    } = req.body;

    const existing = db.prepare('SELECT id FROM photos WHERE id = ?').get(photoId);
    if (!existing) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    // country, dive_count, lat/lng, housing are no longer stored on photos —
    // they come from the dive_site_list relationship. Always set them to NULL.
    db.prepare(`
      UPDATE photos SET
        title = COALESCE(?, title),
        country = NULL,
        species = COALESCE(?, species),
        camera_body = COALESCE(?, camera_body),
        lens = COALESCE(?, lens),
        housing = NULL,
        lighting = COALESCE(?, lighting),
        description = COALESCE(?, description),
        latitude = NULL,
        longitude = NULL,
        dive_count = NULL,
        dive_site_id = NULL,
        dive_site_list_id = COALESCE(?, dive_site_list_id),
        sort_order = COALESCE(?, sort_order),
        metadata_complete = CASE
          WHEN ? IS NOT NULL AND ? IS NOT NULL AND ? IS NOT NULL THEN 1
          ELSE metadata_complete
        END,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      title, species, camera_body, lens, lighting,
      description, dive_site_list_id, sort_order,
      title, species, camera_body, photoId
    );

    // Return the updated photo with dive site name joined and derived fields from dive_site_list
    const updated = db.prepare(`
      SELECT
        p.id, p.filename, p.relative_path, p.original_path,
        p.thumbnail_path, p.display_path,
        p.title,
        COALESCE(p.country, dsl.city_island) AS country,
        p.species,
        p.camera_body, p.lens, p.lighting,
        p.description,
        COALESCE(p.latitude, dsl.latitude) AS latitude,
        COALESCE(p.longitude, dsl.longitude) AS longitude,
        dsl.dive_count AS dive_count,
        p.sort_order, p.metadata_complete,
        p.dive_site_list_id, p.created_at, p.updated_at,
        c.id AS category_id, c.name AS category_name,
        dsl.dive_site_name, dsl.city_island, dsl.country_region
      FROM photos p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN dive_site_list dsl ON p.dive_site_list_id = dsl.id
      WHERE p.id = ?
    `).get(photoId);
    res.json(updated);
  } catch (err) {
    console.error('Error updating photo:', err);
    res.status(500).json({ error: 'Failed to update photo' });
  }
});

module.exports = router;