/**
 * One-time import script for the old info.js metadata.
 *
 * Reads info.js from the old SCUBA_PhotoGallery project and imports
 * metadata into the new SCUBA_PhotoGallery2 SQLite database.
 *
 * The old info.js uses the format:
 *   window.PHOTO_INFO = {
 *     "Wall_Photos": {
 *       "5x7_1-01": {
 *         title: "...",
 *         location: "Bonaire",
 *         diveSite: "Karpata",
 *         camera: "Olympus TG-7",
 *         gps: { lat: 12.2019, lng: -68.2624 },
 *         size: "...",
 *         description: "..."
 *       },
 *       ...
 *     }
 *   };
 *
 * Usage: node server/scripts/import-info-js.js
 *
 * This script does NOT modify the original info.js file.
 */

const fs = require('fs');
const path = require('path');
const { getDb } = require('../database');

// Path to the old info.js (read-only reference)
const INFO_JS_PATH = path.join(__dirname, '..', '..', '..', 'SCUBA_PhotoGallery', 'info.js');

async function importInfoJs() {
  console.log('=== info.js Import Script ===\n');

  // Check if info.js exists
  if (!fs.existsSync(INFO_JS_PATH)) {
    console.error(`ERROR: info.js not found at: ${INFO_JS_PATH}`);
    console.error('Make sure the old SCUBA_PhotoGallery project exists at the expected path.');
    process.exit(1);
  }

  // Read info.js
  console.log(`Reading: ${INFO_JS_PATH}`);
  const infoJsContent = fs.readFileSync(INFO_JS_PATH, 'utf-8');

  // Parse the JavaScript file to extract the PHOTO_INFO object.
  // The format is: window.PHOTO_INFO = { ... };
  // We simulate a browser-like environment to evaluate it.
  let photoInfo = null;
  try {
    // Simulate window object and evaluate the JS
    const window = {};
    const fn = new Function('window', infoJsContent);
    fn(window);
    photoInfo = window.PHOTO_INFO;
  } catch (err) {
    console.error('Failed to parse info.js:', err.message);
    console.error('The file format may differ from expected. Trying regex fallback...');

    // Fallback: try to extract the JSON-like object using regex
    const match = infoJsContent.match(/window\.PHOTO_INFO\s*=\s*(\{[\s\S]*?});?\s*$/);
    if (match) {
      try {
        // Convert JS object syntax to JSON (add quotes to keys)
        const jsonStr = match[1]
          .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3')  // quote unquoted keys
          .replace(/'/g, '"')  // replace single quotes with double
          .replace(/,\s*([}\]])/g, '$1')  // remove trailing commas
          .replace(/`([^`]*)`/g, '"$1"');  // replace backtick strings with double-quoted
        photoInfo = JSON.parse(jsonStr);
        console.log('  Regex fallback succeeded.');
      } catch (e2) {
        console.error('Regex fallback also failed:', e2.message);
        process.exit(1);
      }
    } else {
      console.error('Could not extract PHOTO_INFO from info.js');
      process.exit(1);
    }
  }

  if (!photoInfo || typeof photoInfo !== 'object') {
    console.error('No PHOTO_INFO data found in info.js');
    process.exit(1);
  }

  // Flatten the nested structure into an array of metadata entries
  // The structure is: { LibraryName: { fileKey: { title, location, diveSite, ... } } }
  const metadataEntries = [];
  for (const [libraryName, libraryData] of Object.entries(photoInfo)) {
    if (typeof libraryData !== 'object') continue;
    for (const [fileKey, entry] of Object.entries(libraryData)) {
      if (typeof entry !== 'object') continue;
      metadataEntries.push({
        libraryName,
        fileKey,
        library: libraryName,
        filename: fileKey,
        title: entry.title || null,
        location: entry.location || entry.country || null,
        diveSite: entry.diveSite || entry.dive_site || null,
        camera: entry.camera || entry.camera_body || null,
        lens: entry.lens || null,
        housing: entry.housing || null,
        lighting: entry.lighting || entry.strobes || null,
        description: entry.description || null,
        latitude: entry.gps ? entry.gps.lat : (entry.latitude || null),
        longitude: entry.gps ? entry.gps.lng : (entry.longitude || null),
        diveCount: entry.diveCount || entry.dive_count || null,
        species: entry.species || entry.subject || entry.size || null
      });
    }
  }

  if (metadataEntries.length === 0) {
    console.error('No metadata entries found in info.js after flattening');
    process.exit(1);
  }

  console.log(`Found ${metadataEntries.length} metadata entries in info.js\n`);

  // Initialize database (getDb() auto-initializes on first call)
  const db = getDb();

  // Get all photos in the database
  const dbPhotos = db.prepare(`
    SELECT id, filename, relative_path, original_path, title
    FROM photos
  `).all();
  console.log(`Found ${dbPhotos.length} photos in database\n`);

  // Match metadata to photos by filename
  let matched = 0;
  let unmatchedMetadata = [];
  let unmatchedPhotos = [...dbPhotos];

  for (const entry of metadataEntries) {
    const fileKey = entry.fileKey.toLowerCase();

    // Try to find matching photo by checking if the filename contains the fileKey
    // e.g. fileKey "5x7_1-01" should match filename "5x7_Original_1-01.JPG"
    // The old info.js keys use format: {size}_{number} like "5x7_1-01"
    // The DB filenames use format: {size}_Original_{number}.JPG like "5x7_Original_1-01.JPG"
    const photo = dbPhotos.find(p => {
      const fname = p.filename.toLowerCase().replace(/\.\w+$/, ''); // remove extension
      const rpath = (p.relative_path || p.original_path || '').toLowerCase();
      // Strategy 1: filename without extension equals fileKey
      if (fname === fileKey) return true;
      // Strategy 2: filename contains fileKey
      if (fname.includes(fileKey)) return true;
      // Strategy 3: relative/original path contains fileKey
      if (rpath.includes(fileKey)) return true;
      // Strategy 4: remove _Original_ from filename and compare to fileKey
      // e.g. "5x7_Original_1-01" -> "5x7_1-01" equals fileKey "5x7_1-01"
      const stripped = fname.replace(/_original_?/gi, '_').replace(/^_|_$/g, '');
      if (stripped === fileKey) return true;
      // Strategy 5: filename parts after the first underscore match fileKey parts
      // e.g. "5x7_Original_1-01" -> parts ["5x7", "Original", "1-01"] vs ["5x7", "1-01"]
      // Check if last N-1 parts of filename match all parts of fileKey
      const fnameParts = fname.split('_');
      const keyParts = fileKey.split('_');
      if (fnameParts.length >= keyParts.length) {
        const fnameLast = fnameParts.slice(fnameParts.length - keyParts.length + 1);
        const keyLast = keyParts.slice(1);
        if (fnameParts[0] === keyParts[0] && fnameLast.every((p, i) => p === keyLast[i])) return true;
      }
      return false;
    });

    if (photo) {
      // Update photo metadata
      const diveSiteName = entry.diveSite || null;
      let diveSiteId = null;

      // Create or find dive site
      if (diveSiteName) {
        let site = db.prepare('SELECT id FROM dive_sites WHERE name = ?').get(diveSiteName);
        if (!site) {
          const info = db.prepare(`
            INSERT INTO dive_sites (name, latitude, longitude, dive_count)
            VALUES (?, ?, ?, ?)
          `).run(
            diveSiteName,
            entry.latitude || null,
            entry.longitude || null,
            entry.diveCount || null
          );
          diveSiteId = info.lastInsertRowid;
          console.log(`  Created dive site: ${diveSiteName} (id=${diveSiteId})`);
        } else {
          diveSiteId = site.id;
          db.prepare(`
            UPDATE dive_sites SET
              latitude = COALESCE(?, latitude),
              longitude = COALESCE(?, longitude),
              dive_count = COALESCE(?, dive_count)
            WHERE id = ?
          `).run(
            entry.latitude || null,
            entry.longitude || null,
            entry.diveCount || null,
            diveSiteId
          );
        }
      }

      // Update photo
      db.prepare(`
        UPDATE photos SET
          title = COALESCE(?, title),
          country = COALESCE(?, country),
          species = COALESCE(?, species),
          camera_body = COALESCE(?, camera_body),
          lens = COALESCE(?, lens),
          housing = COALESCE(?, housing),
          lighting = COALESCE(?, lighting),
          description = COALESCE(?, description),
          latitude = COALESCE(?, latitude),
          longitude = COALESCE(?, longitude),
          dive_count = COALESCE(?, dive_count),
          dive_site_id = COALESCE(?, dive_site_id),
          metadata_complete = CASE
            WHEN ? IS NOT NULL AND ? IS NOT NULL THEN 1
            ELSE 0
          END,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        entry.title || null,
        entry.location || null,
        entry.species || null,
        entry.camera || null,
        entry.lens || null,
        entry.housing || null,
        entry.lighting || null,
        entry.description || null,
        entry.latitude || null,
        entry.longitude || null,
        entry.diveCount || null,
        diveSiteId,
        entry.title, entry.location,
        photo.id
      );

      matched++;
      console.log(`  Updated: ${photo.filename} -> "${entry.title || 'untitled'}"`);

      // Remove from unmatched photos
      unmatchedPhotos = unmatchedPhotos.filter(p => p.id !== photo.id);
    } else {
      unmatchedMetadata.push({ fileKey, entry });
    }
  }

  console.log(`\n=== Import Summary ===`);
  console.log(`  Matched and updated: ${matched}`);
  console.log(`  Unmatched metadata entries: ${unmatchedMetadata.length}`);
  console.log(`  Unmatched photos in database: ${unmatchedPhotos.length}`);

  if (unmatchedMetadata.length > 0) {
    console.log('\nUnmatched metadata entries (no photo found for key):');
    unmatchedMetadata.forEach(e => console.log(`  - ${e.fileKey} (${e.entry.title || 'untitled'})`));
  }

  if (unmatchedPhotos.length > 0) {
    console.log('\nUnmatched photos (no metadata found):');
    unmatchedPhotos.forEach(p => console.log(`  - ${p.filename} (db id=${p.id})`));
  }

  console.log('\nImport complete. The original info.js was NOT modified.');
}

importInfoJs().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});