const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;

async function hashPassword(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  return await bcrypt.hash(plaintext, SALT_ROUNDS);
}

async function verifyPassword(plaintext, hash) {
  if (!plaintext || !hash || typeof plaintext !== 'string' || typeof hash !== 'string') {
    return false;
  }
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch (error) {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
