/**
 * Fix the original_path for "All-Time Top SCUBA Photos" library
 * These have absolute paths (/mnt/ServerDocs/...) stored in the DB
 * which don't work inside Docker (where photos are at /app/photos/...)
 */
const path = require('path');

// Set env before requiring database
process.env.DATABASE_PATH = './data/scuba_gallery.sqlite';
process.env.PHOTOS_PATH = './photos';
process.env.CACHE_PATH = './cache';

const { getDb, initializeSchema } = require('../database');

initializeSchema();
const db = getDb();

// Find all All-Time Top photos with absolute paths
const photos = db.prepare(`
  SELECT p.id, p.filename, p.original_path, l.path as lib_path
  FROM photos p
  JOIN libraries l ON p.library_id = l.id
  WHERE l.name = 'All-Time Top SCUBA Photos'
    AND p.original_path LIKE '/mnt/%'
`).all();

console.log(`Found ${photos.length} photos with absolute paths to fix.`);

const fixPrefix = '/mnt/ServerDocs/Websites/SCUBA_PhotoGallery2/photos/';
const updateStmt = db.prepare('UPDATE photos SET original_path = ?, updated_at = datetime(\'now\') WHERE id = ?');

let fixed = 0;
for (const photo of photos) {
  if (photo.original_path.startsWith(fixPrefix)) {
    const relativePath = 'photos/' + photo.original_path.slice(fixPrefix.length);
    updateStmt.run(relativePath, photo.id);
    fixed++;
    if (fixed <= 3) {
      console.log(`  id=${photo.id}: ${photo.original_path} → ${relativePath}`);
    }
  } else {
    console.log(`  SKIP id=${photo.id}: unexpected prefix in ${photo.original_path}`);
  }
}

console.log(`Fixed ${fixed} paths.`);

// Verify
const remaining = db.prepare(`
  SELECT COUNT(*) as cnt FROM photos p
  JOIN libraries l ON p.library_id = l.id
  WHERE l.name = 'All-Time Top SCUBA Photos'
    AND p.original_path LIKE '/mnt/%'
`).get();
console.log(`Remaining absolute paths: ${remaining.cnt}`);

// Now re-process
const { processAllUnprocessed } = require('../imageProcessor');
processAllUnprocessed('./cache').then(results => {
  const ok = results.filter(r => r.success).length;
  const fail = results.filter(r => !r.success).length;
  console.log(`\nReprocessing complete: ${ok} succeeded, ${fail} failed`);
  if (fail > 0) {
    results.filter(r => !r.success).forEach(r => {
      console.error(`  FAIL id=${r.photoId} ${r.filename}: ${r.error}`);
    });
  }
}).catch(e => console.error('Error:', e));