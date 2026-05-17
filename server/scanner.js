const fs = require('fs');
const path = require('path');
const { getDb } = require('./database');

/**
 * Scan a photo library folder and register photos in the database.
 * 
 * Expected folder structure:
 *   photos/<library_name>/<category_name>/*.jpg
 * 
 * @param {string} libraryName - The folder name of the library (e.g., "Wall_Photos")
 * @param {string} libraryPath - Full path to the library folder
 * @returns {object} Summary of what was scanned
 */
function scanLibrary(libraryName, libraryPath) {
  const db = getDb();
  const results = {
    library: libraryName,
    categoriesFound: 0,
    photosFound: 0,
    photosRegistered: 0,
    photosSkipped: 0,
    errors: []
  };

  // Supported image extensions
  const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

  // Ensure library exists in database
  let library = db.prepare('SELECT id FROM libraries WHERE name = ?').get(libraryName);
  if (!library) {
    const displayName = libraryName.replace(/_/g, ' ');
    const info = db.prepare(
      'INSERT INTO libraries (name, display_name, path) VALUES (?, ?, ?)'
    ).run(libraryName, displayName, libraryPath);
    library = { id: info.lastInsertRowid };
    console.log(`  Created library: ${displayName} (id=${library.id})`);
  } else {
    console.log(`  Found existing library: ${libraryName} (id=${library.id})`);
  }

  // Read category folders
  let categoryDirs;
  try {
    categoryDirs = fs.readdirSync(libraryPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
      .sort();
  } catch (err) {
    results.errors.push(`Cannot read library path: ${libraryPath} - ${err.message}`);
    return results;
  }

  results.categoriesFound = categoryDirs.length;

  // If no category subdirectories, treat the library folder itself as a single category
  if (categoryDirs.length === 0) {
    results.categoriesFound = 1;
    const categoryName = path.basename(libraryPath);
    const count = scanCategory(db, library.id, categoryName, libraryPath, IMAGE_EXTS, results);
    results.photosFound += count.found;
    results.photosRegistered += count.registered;
    results.photosSkipped += count.skipped;
  } else {
    categoryDirs.forEach((catName, index) => {
      const catPath = path.join(libraryPath, catName);
      const count = scanCategory(db, library.id, catName, catPath, IMAGE_EXTS, results, index);
      results.photosFound += count.found;
      results.photosRegistered += count.registered;
      results.photosSkipped += count.skipped;
    });
  }

  return results;
}

/**
 * Scan a single category folder and register photos.
 */
function scanCategory(db, libraryId, categoryName, categoryPath, imageExts, results, sortOrder) {
  let files;
  try {
    files = fs.readdirSync(categoryPath)
      .filter(f => {
        const ext = path.extname(f).toLowerCase();
        return imageExts.has(ext);
      })
      .sort();
  } catch (err) {
    results.errors.push(`Cannot read category path: ${categoryPath} - ${err.message}`);
    return { found: 0, registered: 0, skipped: 0 };
  }

  if (files.length === 0) {
    return { found: 0, registered: 0, skipped: 0 };
  }

  // Read CustomTitle.txt if it exists in the category folder
  let customTitle = null;
  const customTitlePath = path.join(categoryPath, 'CustomTitle.txt');
  try {
    if (fs.existsSync(customTitlePath)) {
      const content = fs.readFileSync(customTitlePath, 'utf-8').trim();
      const firstLine = content.split('\n')[0].trim();
      if (firstLine) {
        customTitle = firstLine;
        console.log(`    Custom title found: "${customTitle}"`);
      }
    }
  } catch (err) {
    console.log(`    Could not read CustomTitle.txt: ${err.message}`);
  }

  // Ensure category exists in database
  let category = db.prepare(
    'SELECT id FROM categories WHERE library_id = ? AND name = ?'
  ).get(libraryId, categoryName);

  if (!category) {
    const info = db.prepare(
      'INSERT INTO categories (library_id, name, sort_order, display_name) VALUES (?, ?, ?, ?)'
    ).run(libraryId, categoryName, sortOrder != null ? sortOrder : 0, customTitle);
    category = { id: info.lastInsertRowid };
    console.log(`    Created category: ${categoryName} (id=${category.id})`);
  } else {
    // Update sort_order and display_name for existing categories
    if (sortOrder != null) {
      db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?').run(sortOrder, category.id);
    }
    if (customTitle !== null) {
      db.prepare('UPDATE categories SET display_name = ? WHERE id = ?').run(customTitle, category.id);
    }
  }

  let found = 0, registered = 0, skipped = 0;

  files.forEach(filename => {
    found++;
    const relativePath = path.join(categoryName, filename);
    const fullPath = path.join(categoryPath, filename);

    // Check if photo already registered
    const existing = db.prepare(
      'SELECT id FROM photos WHERE library_id = ? AND relative_path = ?'
    ).get(libraryId, relativePath);

    if (existing) {
      skipped++;
      return;
    }

    // Register the photo
    const title = path.parse(filename).name;
    db.prepare(`
      INSERT INTO photos (library_id, category_id, filename, relative_path, original_path, title, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(libraryId, category.id, filename, relativePath, fullPath, title, found);

    registered++;
    console.log(`      Registered: ${filename}`);
  });

  return { found, registered, skipped };
}

/**
 * Scan all libraries in the photos directory.
 * @param {string} photosRootPath - Root path containing library folders
 * @returns {Array} Array of scan results per library
 */
function scanAllLibraries(photosRootPath) {
  const photosRoot = photosRootPath || path.join(__dirname, '..', 'photos');

  console.log(`\nScanning photos root: ${photosRoot}`);

  let libraryDirs;
  try {
    libraryDirs = fs.readdirSync(photosRoot, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
      .sort();
  } catch (err) {
    console.error(`Cannot read photos root: ${photosRoot} - ${err.message}`);
    return [];
  }

  if (libraryDirs.length === 0) {
    console.log('  No library folders found.');
    return [];
  }

  const allResults = [];
  libraryDirs.forEach(libName => {
    const libPath = path.join(photosRoot, libName);
    console.log(`\nScanning library: ${libName}`);
    const result = scanLibrary(libName, libPath);
    allResults.push(result);
    console.log(`  Result: ${result.photosRegistered} registered, ${result.photosSkipped} skipped, ${result.errors.length} errors`);
  });

  return allResults;
}

/**
 * Remove database records and cache files for photos whose original files no longer exist.
 * @param {string} cacheRoot - Root path for cache (e.g., ./cache)
 * @returns {object} Summary of cleanup
 */
function cleanupDeletedPhotos(cacheRoot) {
  const db = getDb();
  const results = {
    recordsRemoved: 0,
    cacheFilesRemoved: 0,
    errors: []
  };

  const photos = db.prepare('SELECT id, filename, original_path, thumbnail_path, display_path FROM photos').all();

  photos.forEach(photo => {
    if (!photo.original_path || !fs.existsSync(photo.original_path)) {
      // Remove cache files if they exist
      if (photo.thumbnail_path) {
        const thumbFull = path.join(cacheRoot, photo.thumbnail_path);
        try {
          if (fs.existsSync(thumbFull)) {
            fs.unlinkSync(thumbFull);
            results.cacheFilesRemoved++;
          }
        } catch (err) {
          results.errors.push(`Failed to delete thumbnail ${thumbFull}: ${err.message}`);
        }
      }
      if (photo.display_path) {
        const displayFull = path.join(cacheRoot, photo.display_path);
        try {
          if (fs.existsSync(displayFull)) {
            fs.unlinkSync(displayFull);
            results.cacheFilesRemoved++;
          }
        } catch (err) {
          results.errors.push(`Failed to delete display ${displayFull}: ${err.message}`);
        }
      }

      // Remove database record
      db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
      results.recordsRemoved++;
      console.log(`  Removed deleted photo: ${photo.filename} (id=${photo.id})`);
    }
  });

  return results;
}

module.exports = { scanLibrary, scanAllLibraries, cleanupDeletedPhotos };
