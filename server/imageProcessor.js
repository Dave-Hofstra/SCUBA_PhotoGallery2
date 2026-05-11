const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { getDb } = require('./database');

// Configuration
const THUMBNAIL_WIDTH = 400;
const DISPLAY_WIDTH = 1800;
const THUMBNAIL_SUFFIX = '-thumbnail';
const DISPLAY_SUFFIX = '-optimized';
const OUTPUT_FORMAT = 'webp';

/**
 * Generate a thumbnail and display image for a single photo.
 * @param {object} photo - Photo record from database (must have id, original_path, filename)
 * @param {string} cacheRoot - Root path for cache (e.g., ./cache)
 * @returns {object} Result with paths
 */
async function processPhoto(photo, cacheRoot) {
  const result = {
    photoId: photo.id,
    filename: photo.filename,
    success: false,
    thumbnailPath: null,
    displayPath: null,
    error: null
  };

  const originalPath = photo.original_path;
  if (!originalPath || !fs.existsSync(originalPath)) {
    result.error = `Original file not found: ${originalPath}`;
    return result;
  }

  const parsed = path.parse(photo.filename);
  const baseName = parsed.name;
  const thumbDir = path.join(cacheRoot, 'thumbnails');
  const displayDir = path.join(cacheRoot, 'display');

  // Ensure cache directories exist
  fs.mkdirSync(thumbDir, { recursive: true });
  fs.mkdirSync(displayDir, { recursive: true });

  const thumbFilename = `${baseName}${THUMBNAIL_SUFFIX}.${OUTPUT_FORMAT}`;
  const displayFilename = `${baseName}${DISPLAY_SUFFIX}.${OUTPUT_FORMAT}`;
  const thumbPath = path.join(thumbDir, thumbFilename);
  const displayPath = path.join(displayDir, displayFilename);

  try {
    // Generate thumbnail (if not already cached)
    if (!fs.existsSync(thumbPath)) {
      await sharp(originalPath)
        .rotate() // Auto-rotate based on EXIF orientation
        .resize(THUMBNAIL_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(thumbPath);
      console.log(`  Thumbnail created: ${thumbFilename}`);
    } else {
      console.log(`  Thumbnail exists: ${thumbFilename}`);
    }

    // Generate display image (if not already cached)
    if (!fs.existsSync(displayPath)) {
      await sharp(originalPath)
        .rotate() // Auto-rotate based on EXIF orientation
        .resize(DISPLAY_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(displayPath);
      console.log(`  Display image created: ${displayFilename}`);
    } else {
      console.log(`  Display image exists: ${displayFilename}`);
    }

    // Update database with paths
    const db = getDb();
    const relativeThumbPath = path.join('thumbnails', thumbFilename);
    const relativeDisplayPath = path.join('display', displayFilename);

    db.prepare(`
      UPDATE photos SET
        thumbnail_path = ?,
        display_path = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(relativeThumbPath, relativeDisplayPath, photo.id);

    result.success = true;
    result.thumbnailPath = relativeThumbPath;
    result.displayPath = relativeDisplayPath;
  } catch (err) {
    result.error = err.message;
    console.error(`  Error processing ${photo.filename}: ${err.message}`);
  }

  return result;
}

/**
 * Process all photos that don't have generated images yet.
 * @param {string} cacheRoot - Root path for cache
 * @returns {Array} Array of processing results
 */
async function processAllUnprocessed(cacheRoot) {
  const db = getDb();
  const photos = db.prepare(
    'SELECT id, filename, original_path FROM photos WHERE thumbnail_path IS NULL OR display_path IS NULL'
  ).all();

  console.log(`\nProcessing ${photos.length} unprocessed photos...`);

  const results = [];
  for (const photo of photos) {
    const result = await processPhoto(photo, cacheRoot);
    results.push(result);
  }

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  console.log(`\nProcessing complete: ${successCount} succeeded, ${failCount} failed`);

  return results;
}

/**
 * Process a single photo by its database ID.
 * @param {number} photoId - Database photo ID
 * @param {string} cacheRoot - Root path for cache
 * @returns {object} Processing result
 */
async function processPhotoById(photoId, cacheRoot) {
  const db = getDb();
  const photo = db.prepare('SELECT id, filename, original_path FROM photos WHERE id = ?').get(photoId);

  if (!photo) {
    return { photoId, success: false, error: 'Photo not found' };
  }

  return await processPhoto(photo, cacheRoot);
}

module.exports = { processPhoto, processAllUnprocessed, processPhotoById };