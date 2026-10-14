const assert = require('assert');

function caesarEncode(str, shift) {
  return str.replace(/[A-Z]/g, c => String.fromCharCode(((c.charCodeAt(0) - 65 + shift) % 26) + 65));
}

function caesarDecode(str, shift) {
  return str.replace(/[A-Z]/g, c => String.fromCharCode(((c.charCodeAt(0) - 65 - shift + 26) % 26) + 65));
}

function encodeLayered(plaintext) {
  const caesar = caesarEncode(plaintext, 3);
  const b64 = Buffer.from(caesar, 'utf8').toString('base64');
  return Buffer.from(b64, 'utf8').toString('hex');
}

function decodeLayered(hexCiphertext) {
  const b64 = Buffer.from(hexCiphertext, 'hex').toString('utf8');
  const caesar = Buffer.from(b64, 'base64').toString('utf8');
  return caesarDecode(caesar, 3);
}

function testCrypto() {
  console.log('--- Running Cryptography Unit Test ---');
  const original = 'CYBER_DEFENSE_GRID';
  const ciphertext = encodeLayered(original);
  assert.strictEqual(ciphertext, '526b4a46534656665230684a534646575346394b56557848');
  
  const decrypted = decodeLayered(ciphertext);
  assert.strictEqual(decrypted, original);
  console.log('✅ Level 3 Cryptography Unit Test Passed: Hex -> Base64 -> Caesar(-3) correctly restores plaintext.');
}

if (require.main === module) {
  testCrypto();
}

module.exports = {
  caesarEncode,
  caesarDecode,
  encodeLayered,
  decodeLayered,
  testCrypto
};
