const bcrypt = require('bcryptjs');

/**
 * Verify a plaintext passcode against a stored bcrypt hash.
 * @param {string} passcode - The plaintext passcode to verify
 * @param {string} hash - The stored bcrypt hash
 * @returns {boolean} Whether the passcode matches
 */
function verifyPasscode(passcode, hash) {
  if (!passcode || !hash) return false;
  return bcrypt.compareSync(passcode, hash);
}

/**
 * Hash a plaintext passcode using bcrypt.
 * @param {string} passcode - The plaintext passcode to hash
 * @returns {string} The bcrypt hash
 */
function hashPasscode(passcode) {
  return bcrypt.hashSync(passcode, 10);
}

module.exports = { verifyPasscode, hashPasscode };