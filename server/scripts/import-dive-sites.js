#!/usr/bin/env node
/**
 * Import dive sites from dlexch JSON file and CSV dive log.
 *
 * Can be used as:
 *   CLI:  node server/scripts/import-dive-sites.js [dlexchPath] [csvPath]
 *   Module: const { runImport } = require('./scripts/import-dive-sites');
 *            runImport(dlexchPath, csvPath)
 *
 * Reads:
 *   - Share Dive Site .dlexch (JSON) — master list of all dive sites
 *   - David Hofstra csv all dives.csv (CSV) — dive log with City/Island and Country/Region
 *
 * Writes to:
 *   - dive_site_list table in SQLite
 */

const path = require('path');
const fs = require('fs');
const { getDb, initializeSchema } = require('../database');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DIVE_LOG_DIR = path.join(PROJECT_ROOT, 'Extra_Assets', 'DiveLog_Imports');

// Accept file paths as command-line arguments, or use defaults from Extra_Assets/DiveLog_Imports folder
const args = process.argv.slice(2);
const DEFAULT_DLEXCH_PATH = path.join(DIVE_LOG_DIR, 'Share Dive Site 2026-05-06 17.31.40.dlexch');
const DEFAULT_CSV_PATH = path.join(DIVE_LOG_DIR, 'David Hofstra csv all dives - 2026-05-09.csv');

function parseDlexch(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const json = JSON.parse(raw);
  const places = json.Data || [];

  const sites = [];
  for (const entry of places) {
    if (entry.ItemType !== 'Place') continue;
    const data = entry.Data || {};
    const fullName = data.name || '';
    const gps = data.gpsLocation || {};

    // Parse "Bonaire, Klein: Bonadventure" into city_island + dive_site_name
    let diveSiteName = fullName;
    let cityIsland = '';
    const colonIdx = fullName.indexOf(': ');
    if (colonIdx > 0) {
      cityIsland = fullName.substring(0, colonIdx).trim();
      diveSiteName = fullName.substring(colonIdx + 2).trim();
    }

    sites.push({
      full_name: fullName.trim(),
      dive_site_name: diveSiteName,
      city_island: cityIsland,
      latitude: gps.latitude != null ? gps.latitude : null,
      longitude: gps.longitude != null ? gps.longitude : null
    });
  }

  return sites;
}

function parseCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter(line => line.trim().length > 0);

  if (lines.length < 2) return {};

  // Parse header to find column indices
  const header = parseCsvLine(lines[0]);
  const diveSiteIdx = header.indexOf('Dive Site');
  const cityIdx = header.indexOf('City/Island');
  const countryIdx = header.indexOf('Country/Region');

  if (diveSiteIdx === -1) {
    console.error('Could not find "Dive Site" column in CSV header');
    return {};
  }

  const lookup = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const diveSite = cols[diveSiteIdx] ? cols[diveSiteIdx].trim() : '';
    if (!diveSite) continue;

    if (!lookup[diveSite]) {
      lookup[diveSite] = {
        city_island: cityIdx >= 0 && cols[cityIdx] ? cols[cityIdx].trim() : '',
        country_region: countryIdx >= 0 && cols[countryIdx] ? cols[countryIdx].trim() : '',
        dive_count: 0
      };
    }
    lookup[diveSite].dive_count++;
  }

  return lookup;
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Run the dive site import programmatically.
 * @param {string} [dlexchPath] - Path to .dlexch file (uses default if omitted)
 * @param {string} [csvPath] - Path to .csv file (uses default if omitted)
 * @returns {object} { inserted, matched, unmatched, errors }
 */
function runImport(dlexchPath, csvPath) {
  const result = { inserted: 0, matched: 0, unmatched: [], errors: [] };

  // Initialize database
  initializeSchema();
  const db = getDb();

  const resolvedDlexch = dlexchPath || DEFAULT_DLEXCH_PATH;
  const resolvedCsv = csvPath || DEFAULT_CSV_PATH;

  // Check if at least one file exists
  const dlexchExists = fs.existsSync(resolvedDlexch);
  const csvExists = fs.existsSync(resolvedCsv);

  if (!dlexchExists && !csvExists) {
    result.errors.push('No input files found');
    return result;
  }

  // Parse dlexch if it exists
  let dlexchSites = [];
  if (dlexchExists) {
    try {
      dlexchSites = parseDlexch(resolvedDlexch);
    } catch (err) {
      result.errors.push(`Failed to parse dlexch file: ${err.message}`);
    }
  }

  // Parse CSV if it exists
  let csvLookup = {};
  if (csvExists) {
    try {
      csvLookup = parseCsv(resolvedCsv);
    } catch (err) {
      result.errors.push(`Failed to parse CSV file: ${err.message}`);
    }
  }

  // If we have no dlexch data, nothing more to do
  if (dlexchSites.length === 0) {
    result.errors.push('No dive sites found in dlexch file');
    return result;
  }

  // Merge and insert
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO dive_site_list (dive_site_name, city_island, country_region, latitude, longitude, full_name, dive_count, updated_at)
    VALUES (@dive_site_name, @city_island, @country_region, @latitude, @longitude, @full_name, @dive_count, datetime('now'))
  `);

  const transaction = db.transaction(() => {
    for (const site of dlexchSites) {
      const csvData = csvLookup[site.full_name];
      let cityIsland = site.city_island;
      let countryRegion = '';
      let diveCount = 0;

      if (csvData) {
        if (csvData.city_island) cityIsland = csvData.city_island;
        countryRegion = csvData.country_region;
        diveCount = csvData.dive_count || 0;
        result.matched++;
      } else {
        if (site.city_island) {
          const parts = site.city_island.split(',').map(s => s.trim());
          if (parts.length >= 2) {
            countryRegion = parts[parts.length - 1];
          }
        }
        result.unmatched.push(site.full_name);
      }

      insertStmt.run({
        dive_site_name: site.dive_site_name,
        city_island: cityIsland,
        country_region: countryRegion,
        latitude: site.latitude,
        longitude: site.longitude,
        full_name: site.full_name,
        dive_count: diveCount
      });
      result.inserted++;
    }
  });

  transaction();

  return result;
}

async function main() {
  console.log('=== Import Dive Sites ===\n');

  const dlexchPath = args[0] || DEFAULT_DLEXCH_PATH;
  const csvPath = args[1] || DEFAULT_CSV_PATH;

  const result = runImport(dlexchPath, csvPath);

  if (result.errors.length > 0) {
    result.errors.forEach(err => console.error(`ERROR: ${err}`));
  }

  console.log(`\nResults:`);
  console.log(`  Inserted/updated: ${result.inserted} dive sites`);
  console.log(`  Matched with CSV: ${result.matched}`);
  console.log(`  Unmatched: ${result.unmatched.length}`);

  if (result.unmatched.length > 0) {
    console.log('\nUnmatched dive sites (no CSV entry found):');
    result.unmatched.forEach(name => console.log(`  - ${name}`));
  }

  console.log('\n=== Import complete ===');
}

// Export for programmatic use
module.exports = { runImport };

// CLI entrypoint
if (require.main === module) {
  main().catch(err => {
    console.error('Import failed:', err);
    process.exit(1);
  });
}