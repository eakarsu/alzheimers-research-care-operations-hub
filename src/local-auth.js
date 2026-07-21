'use strict';

const crypto = require('node:crypto');

function hashLocalPassword(password, salt = crypto.randomBytes(16)) {
  const derived = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyLocalPassword(password, encoded) {
  const [algorithm, saltHex, expectedHex] = String(encoded || '').split('$');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/i.test(saltHex || '') || !/^[a-f0-9]{64}$/i.test(expectedHex || '')) return false;
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(actual, Buffer.from(expectedHex, 'hex'));
}

module.exports = { hashLocalPassword, verifyLocalPassword };
