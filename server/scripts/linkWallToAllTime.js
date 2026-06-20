/**
 * One-time script: Link Wall_Photos to All-Time Top SCUBA Photos by file size.
 *
 * For each Wall Photo, find the matching All-Time photo by exact file size,
 * and set the Wall Photo's linked_photo_id to point to the All-Time photo.
 *
 * This establishes a permanent link so that metadata edits on either side
 * propagate to the other.
 *
 * Usage: node server/scripts/linkWallToAllTime.js
 */

const fs = require('fs');
const path = require('path');
const { getDb, initializeSchema } = require('../database');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

function main() {
  console.log('=== Link Wall Photos → All-Time Photos ===\n');

  // Ensure schema is up to date (adds linked_photo_id column if needed)
  initializeSchema();
  const db = getDb();

  // Get Wall_Photos library and its mounted category
  const wallLib = db.prepare("SELECT id FROM libraries WHERE name = 'Wall_Photos'").get();
  if (!wallLib) {
    console.error('ERROR: Wall_Photos library not found in database.');
    process.exit(1);
  }
  const wallCat = db.prepare(
    "SELECT id FROM categories WHERE library_id = ? AND name = 'Printed photos that are mounted on my wall at home'"
  ).get(wallLib.id);
  if (!wallCat) {
    console.error('ERROR: Wall Photos category not found in database.');
    process.exit(1);
  }
  console.log(`Wall Photos library ID: ${wallLib.id}, category ID: ${wallCat.id}`);

  // Get All-Time Top SCUBA Photos library
  const allTimeLib = db.prepare("SELECT id FROM libraries WHERE name = 'All-Time Top SCUBA Photos'").get();
  if (!allTimeLib) {
    console.error('ERROR: All-Time Top SCUBA Photos library not found in database.');
    process.exit(1);
  }
  console.log(`All-Time library ID: ${allTimeLib.id}`);

  // Build file size → all-time photo record map from actual files on disk
  const allTimeRoot = path.join(PROJECT_ROOT, 'photos', 'All-Time Top SCUBA Photos');
  const allTimeDirs = fs.readdirSync(allTimeRoot).filter(d =>
    fs.statSync(path.join(allTimeRoot, d)).isDirectory()
  );
  const allTimeSizeMap = {}; // size → { id, filename }
  allTimeDirs.forEach(dir => {
    const dirPath = path.join(allTimeRoot, dir);
    const files = fs.readdirSync(dirPath).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ['.jpg', '.jpeg', '.png'].includes(ext);
    });
    files.forEach(f => {
      const fullPath = path.join(dirPath, f);
      const stat = fs.statSync(fullPath);
      if (allTimeSizeMap[stat.size]) {
        console.warn(`  WARNING: Duplicate size ${stat.size} in all-time photos: ${allTimeSizeMap[stat.size].filename} and ${f}`);
      }
      // Look up the DB record for this all-time photo
      const dbRecord = db.prepare(
        'SELECT id FROM photos WHERE library_id = ? AND filename = ?'
      ).get(allTimeLib.id, f);
      if (dbRecord) {
        allTimeSizeMap[stat.size] = { id: dbRecord.id, filename: f };
      } else {
        console.warn(`  WARNING: All-Time photo ${f} not found in database records`);
      }
    });
  });
  console.log(`All-time photos indexed by size: ${Object.keys(allTimeSizeMap).length}\n`);

  // Get all wall mounted photos from DB
  const wallPhotos = db.prepare(`
    SELECT p.id, p.filename, p.original_path, p.linked_photo_id
    FROM photos p
    WHERE p.category_id = ?
    ORDER BY p.filename
  `).all(wallCat.id);
  console.log(`Wall mounted photos in DB: ${wallPhotos.length}\n`);

  let linked = 0;
  let alreadyLinked = 0;
  let notFound = 0;
  let skipped = 0;

  for (const wallPhoto of wallPhotos) {
    // Skip if already linked
    if (wallPhoto.linked_photo_id) {
      console.log(`  [ALREADY LINKED] ${wallPhoto.filename} → photo id ${wallPhoto.linked_photo_id}`);
      alreadyLinked++;
      continue;
    }

    // Get file size from actual file on disk
    const wallFilePath = path.join(PROJECT_ROOT, wallPhoto.original_path);
    if (!fs.existsSync(wallFilePath)) {
      console.log(`  [SKIP] ${wallPhoto.filename} — file not found at ${wallFilePath}`);
      skipped++;
      continue;
    }
    const wallSize = fs.statSync(wallFilePath).size;

    // Find matching all-time photo by file size
    const match = allTimeSizeMap[wallSize];
    if (!match) {
      console.log(`  [NO MATCH] ${wallPhoto.filename} (size ${wallSize})`);
      notFound++;
      continue;
    }

    // Set the link
    db.prepare('UPDATE photos SET linked_photo_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(match.id, wallPhoto.id);
    linked++;
    console.log(`  [LINKED] ${wallPhoto.filename} → ${match.filename} (all-time photo id ${match.id})`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`Newly linked: ${linked}`);
  console.log(`Already linked: ${alreadyLinked}`);
  console.log(`No match found: ${notFound}`);
  console.log(`Skipped (file missing): ${skipped}`);
  console.log(`Total wall photos: ${wallPhotos.length}`);
}

main();