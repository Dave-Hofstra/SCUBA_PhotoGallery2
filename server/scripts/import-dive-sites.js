#!/usr/bin/env node
/**
 * Import dive sites from dlexch JSON file and CSV dive log.
 *
 * Usage:
 *   node server/scripts/import-dive-sites.js
 *
 * Reads:
 *   - Share Dive Site 2026-05-06 17.31.40.dlexch (JSON) — master list of all dive sites
 *   - David Hofstra csv all dives.csv (CSV) — dive log with City/Island and Country/Region
 *
 * Writes to:
 *   - dive_site_list table in SQLite
 */

const path = require('path');
const fs = require('fs');
const { getDb, initializeSchema } = require('../database');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DIVE_LOG_DIR = path.join(PROJECT_ROOT, 'DiveLog_Import');

// Accept file paths as command-line arguments, or use defaults from DiveLog_Import folder
const args = process.argv.slice(2);
const DLEXCH_PATH = args[0] || path.join(DIVE_LOG_DIR, 'Share Dive Site 2026-05-06 17.31.40.dlexch');
const CSV_PATH = args[1] || path.join(DIVE_LOG_DIR, 'David Hofstra csv all dives - 2026-05-09.csv');

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

async function main() {
  console.log('=== Import Dive Sites ===\n');

  // Initialize database
  initializeSchema();
  const db = getDb();

  // Check if files exist
  if (!fs.existsSync(DLEXCH_PATH)) {
    console.error(`ERROR: dlexch file not found at: ${DLEXCH_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`ERROR: CSV file not found at: ${CSV_PATH}`);
    process.exit(1);
  }

  // Parse dlexch
  console.log('Reading dlexch file...');
  const dlexchSites = parseDlexch(DLEXCH_PATH);
  console.log(`  Found ${dlexchSites.length} dive sites in dlexch file\n`);

  // Parse CSV
  console.log('Reading CSV file...');
  const csvLookup = parseCsv(CSV_PATH);
  console.log(`  Found ${Object.keys(csvLookup).length} unique dive sites in CSV\n`);

  // Merge and insert
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO dive_site_list (dive_site_name, city_island, country_region, latitude, longitude, full_name, dive_count, updated_at)
    VALUES (@dive_site_name, @city_island, @country_region, @latitude, @longitude, @full_name, @dive_count, datetime('now'))
  `);

  let inserted = 0;
  let matched = 0;
  let unmatched = [];

  const transaction = db.transaction(() => {
    for (const site of dlexchSites) {
      const csvData = csvLookup[site.full_name];
      let cityIsland = site.city_island;
      let countryRegion = '';
      let diveCount = 0;

      if (csvData) {
        // CSV has City/Island and Country/Region — use those
        if (csvData.city_island) cityIsland = csvData.city_island;
        countryRegion = csvData.country_region;
        diveCount = csvData.dive_count || 0;
        matched++;
      } else {
        // Try to derive country from city_island
        if (site.city_island) {
          const parts = site.city_island.split(',').map(s => s.trim());
          if (parts.length >= 2) {
            countryRegion = parts[parts.length - 1];
          }
        }
        unmatched.push(site.full_name);
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
      inserted++;
    }
  });

  transaction();

  console.log(`\nResults:`);
  console.log(`  Inserted/updated: ${inserted} dive sites`);
  console.log(`  Matched with CSV: ${matched}`);
  console.log(`  Unmatched: ${unmatched.length}`);

  if (unmatched.length > 0) {
    console.log('\nUnmatched dive sites (no CSV entry found):');
    unmatched.forEach(name => console.log(`  - ${name}`));
  }

  console.log('\n=== Import complete ===');
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});