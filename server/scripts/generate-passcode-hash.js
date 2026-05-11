/**
 * Generate a bcrypt hash for a passcode.
 * Run with: node scripts/generate-passcode-hash.js <passcode>
 * Example: node scripts/generate-passcode-hash.js 5545
 */
const { hashPasscode } = require('../services/auth');

const passcode = process.argv[2];

if (!passcode) {
  console.error('Usage: node scripts/generate-passcode-hash.js <passcode>');
  process.exit(1);
}

const hash = hashPasscode(passcode);
console.log(`Passcode: ${passcode}`);
console.log(`Hash: ${hash}`);
console.log('\nAdd this to your .env file as:');
console.log(`ADMIN_PASSCODE_HASH=${hash}`);