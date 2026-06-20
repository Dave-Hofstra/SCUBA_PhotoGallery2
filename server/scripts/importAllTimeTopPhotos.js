/**
 * Import script for "All-Time Top SCUBA Photos" library.
 * 
 * Steps:
 * 1. Import the CSV dive log into the `dives` table
 * 2. Scan the photo library to register new photos (handles PNGs etc.)
 * 3. For each photo, find the matching Google Photos JSON metadata
 * 4. Parse description (format: "383-Lettuce Sea Slug") -> dive_number + species
 * 5. Look up dive_number in dives table -> dive site name
 * 6. Match dive site name to dive_site_list
 * 7. Set camera/lighting based on folder name
 * 8. Capture photoTakenTime
 * 9. Update photo record with all metadata
 * 
 * Usage: node server/scripts/importAllTimeTopPhotos.js
 */

const fs = require('fs');
const path = require('path');
const { getDb, initializeSchema } = require('../database');
const { scanLibrary } = require('../scanner');

// Paths
const PHOTOS_ROOT = path.join(__dirname, '..', '..', 'photos');
const LIBRARY_NAME = 'All-Time Top SCUBA Photos';
const LIBRARY_PATH = path.join(PHOTOS_ROOT, LIBRARY_NAME);
const CSV_PATH = path.join(__dirname, '..', '..', 'Extra_Assets', 'DiveLog_Imports', 'David Hofstra csv all dives - 2026-05-09.csv');
const JSON_DIR = path.join(__dirname, '..', '..', 'Extra_Assets', 'Google Photos Takeout', 'SCUBA Wall Tiles - All Time-JSON');

// Camera/lighting rules by folder pattern
function getCameraSettings(folderName) {
  if (!folderName) return { camera_body: null, lighting: null };
  const lower = folderName.toLowerCase();
  if (lower.includes('tg-7')) {
    return { camera_body: 'Olympus TG-7', lighting: 'Inon S220 Strobes (Dual)' };
  }
  if (lower.includes('iphone')) {
    return { camera_body: 'iPhone 14 Pro Max', lighting: null };
  }
  // Miscellaneous or unknown
  return { camera_body: null, lighting: null };
}

/**
 * Parse a CSV line that may contain quoted fields.
 * Returns an array of field values.
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ""
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        current += ch;
      }
      i++;
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
        i++;
      } else {
        current += ch;
        i++;
      }
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Find a JSON metadata file for a given filename, case-insensitive.
 * Checks both .supplemental-metadata.json and .suppl.json suffixes.
 */
function findMetadataJson(filename) {
  const basename = path.basename(filename);
  const candidates = [
    basename + '.supplemental-metadata.json',
    basename + '.suppl.json'
  ];
  for (const candidate of candidates) {
    // Case-insensitive search
    const files = fs.readdirSync(JSON_DIR);
    const match = files.find(f => f.toLowerCase() === candidate.toLowerCase());
    if (match) {
      return path.join(JSON_DIR, match);
    }
  }
  return null;
}

/**
 * Parse description from format "383-Lettuce Sea Slug (First-Time Capture with this color variation)"
 * Returns { diveNumber, species }
 */
function parseDescription(description) {
  if (!description) return { diveNumber: null, species: null };
  
  const match = description.match(/^(\d+)-(.+)$/);
  if (match) {
    return {
      diveNumber: parseInt(match[1], 10),
      species: match[2].trim()
    };
  }
  return { diveNumber: null, species: description.trim() };
}

/**
 * Look up a dive_site_list row by dive site name.
 * Uses a SELECT with TRIM and lower() for fuzzy matching.
 */
function findDiveSiteListId(db, diveSiteName) {
  if (!diveSiteName) return null;
  
  // Try exact match first
  let row = db.prepare(
    'SELECT id FROM dive_site_list WHERE dive_site_name = ?'
  ).get(diveSiteName);
  if (row) return row.id;
  
  // Try trimmed match
  row = db.prepare(
    'SELECT id FROM dive_site_list WHERE LOWER(TRIM(dive_site_name)) = LOWER(TRIM(?))'
  ).get(diveSiteName);
  if (row) return row.id;

  // Try matching on just the site name part (after ": " if present)
  const colonIndex = diveSiteName.indexOf(': ');
  if (colonIndex > 0) {
    const sitePart = diveSiteName.substring(colonIndex + 2).trim();
    row = db.prepare(
      "SELECT id FROM dive_site_list WHERE LOWER(TRIM(dive_site_name)) LIKE '%' || LOWER(TRIM(?)) || '%'"
    ).get(sitePart);
    if (row) return row.id;
  }
  
  console.warn(`    WARNING: No dive_site_list match for "${diveSiteName}"`);
  return null;
}

/**
 * Import the CSV file into the dives table.
 */
function importDivesCsv(db) {
  console.log('\n=== Importing CSV Dive Log ===');
  
  const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = csvContent.split('\n').filter(line => line.trim().length > 0);
  
  if (lines.length < 2) {
    console.log('  CSV file has no data rows.');
    return;
  }
  
  // Parse header
  const headers = parseCSVLine(lines[0]);
  const diveNumberIdx = headers.indexOf('Dive Number');
  const diveDateIdx = headers.indexOf('Dive Date Entry Time');
  const diveSiteIdx = headers.indexOf('Dive Site');
  const cityIdx = headers.indexOf('City/Island');
  const countryIdx = headers.indexOf('Country/Region');
  const maxDepthIdx = headers.indexOf('Max Depth (ft)');
  const diveTimeIdx = headers.indexOf('Dive Time (mins)');
  
  if (diveNumberIdx === -1 || diveSiteIdx === -1) {
    console.error('  ERROR: Could not find required CSV columns (Dive Number, Dive Site)');
    return;
  }
  
  const insertOrUpdate = db.prepare(`
    INSERT INTO dives (dive_number, dive_date, dive_site, city_island, country_region, max_depth, dive_time)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dive_number) DO UPDATE SET
      dive_date = excluded.dive_date,
      dive_site = excluded.dive_site,
      city_island = excluded.city_island,
      country_region = excluded.country_region,
      max_depth = excluded.max_depth,
      dive_time = excluded.dive_time,
      updated_at = datetime('now')
  `);
  
  let imported = 0;
  let skipped = 0;
  
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const diveNumber = parseInt(fields[diveNumberIdx], 10);
    
    if (isNaN(diveNumber)) {
      // Skip non-data lines (comments, blanks)
      skipped++;
      continue;
    }
    
    const diveDate = diveDateIdx >= 0 && fields[diveDateIdx] ? fields[diveDateIdx] : null;
    const diveSite = diveSiteIdx >= 0 ? fields[diveSiteIdx] : null;
    const city = cityIdx >= 0 ? fields[cityIdx] : null;
    const country = countryIdx >= 0 ? fields[countryIdx] : null;
    const maxDepth = maxDepthIdx >= 0 && fields[maxDepthIdx] ? parseFloat(fields[maxDepthIdx]) : null;
    const diveTime = diveTimeIdx >= 0 && fields[diveTimeIdx] ? parseInt(fields[diveTimeIdx], 10) : null;
    
    insertOrUpdate.run(diveNumber, diveDate, diveSite, city, country, maxDepth, diveTime);
    imported++;
  }
  
  console.log(`  Imported ${imported} dive records (skipped ${skipped} non-data lines)`);
}

/**
 * Process photos in the library, enriching them with JSON metadata.
 */
function enrichPhotos(db) {
  console.log('\n=== Enriching Photos with Metadata ===');
  
  // Get the library
  const library = db.prepare('SELECT id, name FROM libraries WHERE name = ?').get(LIBRARY_NAME);
  if (!library) {
    console.error(`  ERROR: Library "${LIBRARY_NAME}" not found. Run scanner first.`);
    return;
  }
  console.log(`  Library: ${library.name} (id=${library.id})`);
  
  // Get all photos for this library, grouped by category
  const photos = db.prepare(`
    SELECT p.id, p.filename, p.relative_path, p.title, c.name AS category_name
    FROM photos p
    JOIN categories c ON p.category_id = c.id
    WHERE p.library_id = ?
    ORDER BY c.name, p.filename
  `).all(library.id);
  
  console.log(`  Found ${photos.length} photos to process\n`);
  
  let enriched = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const photo of photos) {
    const jsonPath = findMetadataJson(photo.filename);
    
    if (!jsonPath) {
      console.log(`  [SKIP] ${photo.filename} — no JSON metadata found`);
      skipped++;
      continue;
    }
    
    let jsonData;
    try {
      jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    } catch (err) {
      console.error(`  [ERROR] ${photo.filename} — failed to parse JSON: ${err.message}`);
      errors++;
      continue;
    }
    
    // Parse description
    const { diveNumber, species } = parseDescription(jsonData.description || '');
    
    // Get photoTakenTime
    let photoTakenTime = null;
    if (jsonData.photoTakenTime && jsonData.photoTakenTime.timestamp) {
      photoTakenTime = parseInt(jsonData.photoTakenTime.timestamp, 10);
    }
    
    // Look up dive site from dives table
    let diveSiteListId = null;
    let diveSiteName = null;
    if (diveNumber !== null) {
      const dive = db.prepare('SELECT dive_site FROM dives WHERE dive_number = ?').get(diveNumber);
      if (dive && dive.dive_site) {
        diveSiteName = dive.dive_site;
        diveSiteListId = findDiveSiteListId(db, dive.dive_site);
      } else {
        console.warn(`    WARNING: Dive #${diveNumber} not found in dives table`);
      }
    }
    
    // Get camera/lighting based on category folder name
    const { camera_body, lighting } = getCameraSettings(photo.category_name);
    
    // Update photo metadata
    const updateFields = { species, camera_body, lighting, diveSiteListId, diveNumber, photoTakenTime };
    
    try {
      db.prepare(`
        UPDATE photos SET
          species = ?,
          camera_body = ?,
          lighting = ?,
          dive_site_list_id = ?,
          dive_number = ?,
          photo_taken_time = ?,
          metadata_complete = CASE WHEN ? IS NOT NULL THEN 1 ELSE metadata_complete END,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        species,
        camera_body,
        lighting,
        diveSiteListId,
        diveNumber,
        photoTakenTime,
        species,
        photo.id
      );
      
      enriched++;
      console.log(`  [OK] ${photo.filename}`);
      if (species) console.log(`       Species: ${species}`);
      if (diveNumber) console.log(`       Dive #${diveNumber} -> ${diveSiteName || 'Unknown'} (dive_site_list_id: ${diveSiteListId || 'N/A'})`);
      if (camera_body) console.log(`       Camera: ${camera_body} | Lighting: ${lighting || 'N/A'}`);
      if (photoTakenTime) console.log(`       Photo Taken: ${new Date(photoTakenTime * 1000).toISOString()}`);
    } catch (err) {
      console.error(`  [ERROR] ${photo.filename} — update failed: ${err.message}`);
      errors++;
    }
  }
  
  console.log(`\n=== Summary ===`);
  console.log(`  Enriched: ${enriched}`);
  console.log(`  Skipped (no JSON): ${skipped}`);
  console.log(`  Errors: ${errors}`);
  
  return { enriched, skipped, errors };
}

/**
 * Main function.
 */
function main() {
  console.log('=== Import All-Time Top SCUBA Photos ===\n');
  
  // Initialize DB and schema
  const db = initializeSchema();
  
  // Step 1: Import CSV into dives table
  importDivesCsv(db);
  
  // Step 2: Scan the library to register new photos
  console.log('\n=== Scanning Library ===');
  const scanResult = scanLibrary(LIBRARY_NAME, LIBRARY_PATH);
  console.log(`  Categories found: ${scanResult.categoriesFound}`);
  console.log(`  Photos found: ${scanResult.photosFound}`);
  console.log(`  Photos registered: ${scanResult.photosRegistered}`);
  console.log(`  Photos skipped (already exist): ${scanResult.photosSkipped}`);
  if (scanResult.errors.length > 0) {
    console.error(`  Errors: ${scanResult.errors.join(', ')}`);
  }
  
  // Step 3: Enrich photos with JSON metadata
  enrichPhotos(db);
  
  console.log('\n=== Import Complete ===');
}

// Run
main();