const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// Helper to get session ID string for tracking
function getSessionId(req) {
  return req.sessionID || 'anon';
}

// GET /api/libraries/:libraryId/photos
router.get('/libraries/:libraryId/photos', (req, res) => {
  try {
    const db = getDb();
    const { libraryId } = req.params;
    const sessionId = getSessionId(req);

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
        p.dive_number,
        p.photo_taken_time,
        c.id AS category_id,
        c.name AS category_name,
        c.display_name AS category_display_name,
        c.sort_order AS category_sort_order,
        ds.id AS dive_site_id,
        ds.name AS dive_site,
        dsl.dive_site_name,
        dsl.city_island,
        dsl.country_region,
        (SELECT COUNT(*) FROM photo_likes WHERE photo_id = p.id) AS like_count,
        (SELECT 1 FROM photo_views WHERE photo_id = p.id AND session_id = ?) AS viewed_by_me,
        (SELECT 1 FROM photo_likes WHERE photo_id = p.id AND session_id = ?) AS liked_by_me
      FROM photos p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN dive_sites ds ON p.dive_site_id = ds.id
      LEFT JOIN dive_site_list dsl ON p.dive_site_list_id = dsl.id
      WHERE p.library_id = ?
      ORDER BY c.sort_order, p.sort_order, p.filename
    `).all(sessionId, sessionId, libraryId);

    // Convert the 0/1 integer results to booleans
    photos.forEach(photo => {
      photo.viewed_by_me = !!photo.viewed_by_me;
      photo.liked_by_me = !!photo.liked_by_me;
    });

    // Fetch dividers for all categories in this library
    const categoriesList = db.prepare('SELECT id FROM categories WHERE library_id = ?').all(libraryId);
    const categoryIds = categoriesList.map(c => c.id);
    const dividersByCategory = {};
    if (categoryIds.length > 0) {
      const placeholders = categoryIds.map(() => '?').join(',');
      const allDividers = db.prepare(`SELECT * FROM category_dividers WHERE category_id IN (${placeholders}) ORDER BY sort_order`).all(...categoryIds);
      allDividers.forEach(d => {
        if (!dividersByCategory[d.category_id]) dividersByCategory[d.category_id] = [];
        dividersByCategory[d.category_id].push(d);
      });
    }

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
          dividers: dividersByCategory[photo.category_id] || [],
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
    const sessionId = getSessionId(req);

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
        p.dive_number,
        p.photo_taken_time,
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
        dsl.country_region,
        (SELECT COUNT(*) FROM photo_likes WHERE photo_id = p.id) AS like_count,
        (SELECT 1 FROM photo_views WHERE photo_id = p.id AND session_id = ?) AS viewed_by_me,
        (SELECT 1 FROM photo_likes WHERE photo_id = p.id AND session_id = ?) AS liked_by_me
      FROM photos p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN dive_sites ds ON p.dive_site_id = ds.id
      LEFT JOIN dive_site_list dsl ON p.dive_site_list_id = dsl.id
      WHERE p.id = ?
    `).get(sessionId, sessionId, photoId);

    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    photo.viewed_by_me = !!photo.viewed_by_me;
    photo.liked_by_me = !!photo.liked_by_me;

    res.json(photo);
  } catch (err) {
    console.error('Error fetching photo:', err);
    res.status(500).json({ error: 'Failed to fetch photo' });
  }
});

// POST /api/photos/:photoId/view — mark photo as viewed by this session
router.post('/photos/:photoId/view', (req, res) => {
  try {
    const db = getDb();
    const { photoId } = req.params;
    const sessionId = getSessionId(req);

    // Check photo exists
    const photo = db.prepare('SELECT id FROM photos WHERE id = ?').get(photoId);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    db.prepare(`
      INSERT OR IGNORE INTO photo_views (photo_id, session_id)
      VALUES (?, ?)
    `).run(photoId, sessionId);

    res.status(204).end();
  } catch (err) {
    console.error('Error marking photo viewed:', err);
    res.status(500).json({ error: 'Failed to mark photo viewed' });
  }
});

// DELETE /api/photos/:photoId/view — unmark photo as viewed by this session
router.delete('/photos/:photoId/view', (req, res) => {
  try {
    const db = getDb();
    const { photoId } = req.params;
    const sessionId = getSessionId(req);

    db.prepare(`
      DELETE FROM photo_views WHERE photo_id = ? AND session_id = ?
    `).run(photoId, sessionId);

    res.status(204).end();
  } catch (err) {
    console.error('Error unmarking photo viewed:', err);
    res.status(500).json({ error: 'Failed to unmark photo viewed' });
  }
});

// POST /api/photos/:photoId/like — toggle like for this session
router.post('/photos/:photoId/like', (req, res) => {
  try {
    const db = getDb();
    const { photoId } = req.params;
    const sessionId = getSessionId(req);

    // Check photo exists
    const photo = db.prepare('SELECT id FROM photos WHERE id = ?').get(photoId);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    // Check if already liked
    const existing = db.prepare(
      'SELECT id FROM photo_likes WHERE photo_id = ? AND session_id = ?'
    ).get(photoId, sessionId);

    if (existing) {
      // Unlike
      db.prepare('DELETE FROM photo_likes WHERE photo_id = ? AND session_id = ?')
        .run(photoId, sessionId);
    } else {
      // Like
      db.prepare('INSERT INTO photo_likes (photo_id, session_id) VALUES (?, ?)')
        .run(photoId, sessionId);
    }

    // Get updated count
    const count = db.prepare('SELECT COUNT(*) AS cnt FROM photo_likes WHERE photo_id = ?')
      .get(photoId);

    res.json({
      liked: !existing,
      count: count.cnt
    });
  } catch (err) {
    console.error('Error toggling photo like:', err);
    res.status(500).json({ error: 'Failed to toggle photo like' });
  }
});

/**
 * Propagate metadata changes from one photo to its linked counterpart.
 * Checks if the photo has a linked_photo_id, or if any other photo links to it.
 * Only propagates fields that were actually changed (non-null in the update).
 */
function propagateMetadataUpdate(db, photoId, changedFields) {
  // Find linked photos in both directions
  const photo = db.prepare('SELECT id, linked_photo_id FROM photos WHERE id = ?').get(photoId);
  if (!photo) return;

  const linkedIds = [];

  // If this photo points to another (Wall → All-Time direction)
  if (photo.linked_photo_id) {
    linkedIds.push(photo.linked_photo_id);
  }

  // If another photo points to this one (All-Time → Wall direction)
  const reverseLinks = db.prepare('SELECT id FROM photos WHERE linked_photo_id = ?').all(photoId);
  reverseLinks.forEach(r => linkedIds.push(r.id));

  if (linkedIds.length === 0) return;

  // Build the SET clause from the changed fields
  const setClauses = [];
  const params = [];
  Object.keys(changedFields).forEach(field => {
    setClauses.push(`${field} = ?`);
    params.push(changedFields[field]);
  });

  if (setClauses.length === 0) return;

  setClauses.push("updated_at = datetime('now')");

  // Update all linked photos
  linkedIds.forEach(linkedId => {
    db.prepare(`UPDATE photos SET ${setClauses.join(', ')} WHERE id = ?`).run(...params, linkedId);
  });
}

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
      description, dive_site_list_id, sort_order,
      dive_number, photo_taken_time
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
        dive_number = COALESCE(?, dive_number),
        photo_taken_time = COALESCE(?, photo_taken_time),
        sort_order = COALESCE(?, sort_order),
        metadata_complete = CASE
          WHEN ? IS NOT NULL AND ? IS NOT NULL AND ? IS NOT NULL THEN 1
          ELSE metadata_complete
        END,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      title, species, camera_body, lens, lighting,
      description, dive_site_list_id, dive_number, photo_taken_time, sort_order,
      title, species, camera_body, photoId
    );

    // Propagate changes to linked photos (Wall ↔ All-Time)
    const changedFields = {};
    if (title !== undefined) changedFields.title = title;
    if (species !== undefined) changedFields.species = species;
    if (camera_body !== undefined) changedFields.camera_body = camera_body;
    if (lens !== undefined) changedFields.lens = lens;
    if (lighting !== undefined) changedFields.lighting = lighting;
    if (description !== undefined) changedFields.description = description;
    if (dive_site_list_id !== undefined) changedFields.dive_site_list_id = dive_site_list_id;
    if (dive_number !== undefined) changedFields.dive_number = dive_number;
    if (photo_taken_time !== undefined) changedFields.photo_taken_time = photo_taken_time;
    propagateMetadataUpdate(db, photoId, changedFields);

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
        p.dive_number, p.photo_taken_time,
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

// PUT /api/admin/photos/:photoId/metadata — batch-set metadata fields including new columns
router.put('/admin/photos/:photoId/metadata', (req, res) => {
  if (!req.session || !req.session.admin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getDb();
    const { photoId } = req.params;
    const {
      species, camera_body, lighting, description,
      dive_site_list_id, dive_number, photo_taken_time
    } = req.body;

    const existing = db.prepare('SELECT id FROM photos WHERE id = ?').get(photoId);
    if (!existing) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    db.prepare(`
      UPDATE photos SET
        species = COALESCE(?, species),
        camera_body = COALESCE(?, camera_body),
        lighting = COALESCE(?, lighting),
        description = COALESCE(?, description),
        dive_site_list_id = COALESCE(?, dive_site_list_id),
        dive_number = COALESCE(?, dive_number),
        photo_taken_time = COALESCE(?, photo_taken_time),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(species, camera_body, lighting, description, dive_site_list_id, dive_number, photo_taken_time, photoId);

    // Propagate changes to linked photos (Wall ↔ All-Time)
    const changedFields = {};
    if (species !== undefined) changedFields.species = species;
    if (camera_body !== undefined) changedFields.camera_body = camera_body;
    if (lighting !== undefined) changedFields.lighting = lighting;
    if (description !== undefined) changedFields.description = description;
    if (dive_site_list_id !== undefined) changedFields.dive_site_list_id = dive_site_list_id;
    if (dive_number !== undefined) changedFields.dive_number = dive_number;
    if (photo_taken_time !== undefined) changedFields.photo_taken_time = photo_taken_time;
    propagateMetadataUpdate(db, photoId, changedFields);

    res.json({ success: true });
  } catch (err) {
    console.error('Error updating photo metadata:', err);
    res.status(500).json({ error: 'Failed to update photo metadata' });
  }
});

module.exports = router;