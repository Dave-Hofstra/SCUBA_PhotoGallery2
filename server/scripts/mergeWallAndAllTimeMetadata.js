/**
 * Merge metadata between Wall_Photos "mounted" category and All-Time Top SCUBA Photos.
 *
 * Matching strategy: compare file sizes (exact byte match).
 * For each matched pair:
 *   Wall → All-Time: copy title, species, lens, lighting, description
 *   All-Time → Wall: copy dive_site_list_id, dive_number, photo_taken_time
 *
 * Usage: node server/scripts/mergeWallAndAllTimeMetadata.js
 */

const fs = require('fs');
const path = require('path');
const { getDb } = require('../database');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

function main() {
  console.log('=== Merge Wall + All-Time Metadata ===\n');
  const db = getDb();

  // Get Wall_Photos library and mounted category
  const wallLib = db.prepare("SELECT id FROM libraries WHERE name = 'Wall_Photos'").get();
  const wallCat = db.prepare("SELECT id FROM categories WHERE library_id = ? AND name = 'Printed photos that are mounted on my wall at home'").get(wallLib.id);
  console.log(`Wall category ID: ${wallCat.id}`);

  // Get All-Time Top library
  const allTimeLib = db.prepare("SELECT id FROM libraries WHERE name = 'All-Time Top SCUBA Photos'").get();
  console.log(`All-Time library ID: ${allTimeLib.id}`);

  // Build file size → filename map for all all-time photos (from actual files on disk)
  const allTimeRoot = path.join(PROJECT_ROOT, 'photos', 'All-Time Top SCUBA Photos');
  const allTimeDirs = fs.readdirSync(allTimeRoot).filter(d => fs.statSync(path.join(allTimeRoot, d)).isDirectory());
  const allTimeSizeMap = {}; // size → { filename }
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
        console.warn(`  WARNING: Duplicate size ${stat.size} in all-time photos: ${allTimeSizeMap[stat.size]} and ${f}`);
      }
      allTimeSizeMap[stat.size] = f;
    });
  });
  console.log(`All-time photos indexed by size: ${Object.keys(allTimeSizeMap).length}`);

  // Get all wall mounted photos from DB
  const wallPhotos = db.prepare(`
    SELECT p.id, p.filename, p.original_path, p.title, p.species, p.lens, p.lighting, p.description,
           p.dive_site_list_id, p.dive_number, p.photo_taken_time
    FROM photos p
    WHERE p.category_id = ?
    ORDER BY p.filename
  `).all(wallCat.id);
  console.log(`Wall mounted photos in DB: ${wallPhotos.length}\n`);

  let matched = 0;
  let notFound = 0;
  let wallToAllTime = 0;
  let allTimeToWall = 0;

  for (const wallPhoto of wallPhotos) {
    // Get file size from actual file on disk — original_path is relative like "photos/Wall_Photos/..."
    const wallFilePath = path.join(PROJECT_ROOT, wallPhoto.original_path);
    if (!fs.existsSync(wallFilePath)) {
      console.log(`  [SKIP] ${wallPhoto.filename} — file not found at ${wallFilePath}`);
      notFound++;
      continue;
    }
    const wallSize = fs.statSync(wallFilePath).size;

    // Find matching all-time photo by file size
    const matchFilename = allTimeSizeMap[wallSize];
    if (!matchFilename) {
      console.log(`  [NO MATCH] ${wallPhoto.filename} (size ${wallSize})`);
      notFound++;
      continue;
    }

    // Find the all-time photo record in DB by filename
    const allTimePhoto = db.prepare(`
      SELECT p.id, p.filename, p.title, p.species, p.lens, p.lighting, p.description,
             p.dive_site_list_id, p.dive_number, p.photo_taken_time
      FROM photos p
      WHERE p.library_id = ? AND p.filename = ?
    `).get(allTimeLib.id, matchFilename);

    if (!allTimePhoto) {
      console.log(`  [DB NOT FOUND] ${wallPhoto.filename} → ${matchFilename} (size ${wallSize}) — not found in all-time DB records`);
      notFound++;
      continue;
    }

    // ---- WALL → ALL-TIME: copy title, species, lens, lighting, description ----
    const wallFields = ['title', 'species', 'lens', 'lighting', 'description'];
    const allTimeUpdates = [];
    const allTimeParams = [];
    wallFields.forEach(field => {
      if (wallPhoto[field] !== null && wallPhoto[field] !== '') {
        allTimeUpdates.push(`${field} = ?`);
        allTimeParams.push(wallPhoto[field]);
      }
    });

    if (allTimeUpdates.length > 0) {
      allTimeParams.push(allTimePhoto.id);
      db.prepare(`
        UPDATE photos SET ${allTimeUpdates.join(', ')}, updated_at = datetime('now')
        WHERE id = ?
      `).run(...allTimeParams);
      wallToAllTime++;
      console.log(`  [W→A] ${wallPhoto.filename} → ${matchFilename}: ${allTimeUpdates.join(', ')}`);
    }

    // ---- ALL-TIME → WALL: copy dive_site_list_id, dive_number, photo_taken_time ----
    const allTimeFields = [
      { field: 'dive_site_list_id', value: allTimePhoto.dive_site_list_id },
      { field: 'dive_number', value: allTimePhoto.dive_number },
      { field: 'photo_taken_time', value: allTimePhoto.photo_taken_time }
    ];
    const wallUpdates = [];
    const wallParams = [];
    allTimeFields.forEach(({ field, value }) => {
      if (value !== null && value !== '') {
        wallUpdates.push(`${field} = ?`);
        wallParams.push(value);
      }
    });

    if (wallUpdates.length > 0) {
      wallParams.push(wallPhoto.id);
      db.prepare(`
        UPDATE photos SET ${wallUpdates.join(', ')}, updated_at = datetime('now')
        WHERE id = ?
      `).run(...wallParams);
      allTimeToWall++;
      console.log(`  [A→W] ${matchFilename} → ${wallPhoto.filename}: ${wallUpdates.join(', ')}`);
    }

    matched++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Matched pairs: ${matched}`);
  console.log(`Not found: ${notFound}`);
  console.log(`Wall → All-Time updates: ${wallToAllTime}`);
  console.log(`All-Time → Wall updates: ${allTimeToWall}`);
}

main();