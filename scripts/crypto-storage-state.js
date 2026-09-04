// Encrypts/decrypts .auth/azure-portal-state.json for storage in the repo, so the
// CI workflow (azure-portal-e2e.yml) doesn't need to carry the whole session as a
// GitHub secret (which has a 48KB size limit and is fragile to copy/paste via clipboard).
// Only the short passphrase needs to be a secret.
//
// Usage:
//   node scripts/crypto-storage-state.js encrypt <passphrase>
//   node scripts/crypto-storage-state.js decrypt <passphrase>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const jsonPath = path.join(__dirname, '..', '.auth', 'azure-portal-state.json');
const encPath = path.join(__dirname, '..', '.auth', 'azure-portal-state.enc.b64');

const [, , mode, passphraseArg] = process.argv;
const passphrase = passphraseArg || process.env.AZURE_PORTAL_STATE_PASSPHRASE;
if (!['encrypt', 'decrypt'].includes(mode) || !passphrase) {
  console.error('Usage: node scripts/crypto-storage-state.js <encrypt|decrypt> [passphrase]');
  console.error('(or set the AZURE_PORTAL_STATE_PASSPHRASE env var instead of passing it as an arg)');
  process.exit(1);
}

if (mode === 'encrypt') {
  const plaintext = fs.readFileSync(jsonPath);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const blob = Buffer.concat([salt, iv, authTag, ciphertext]);
  fs.mkdirSync(path.dirname(encPath), { recursive: true });
  fs.writeFileSync(encPath, blob.toString('base64'));
  console.log(`Encrypted -> ${encPath}`);
} else {
  const blob = Buffer.from(fs.readFileSync(encPath, 'utf8'), 'base64');
  const salt = blob.subarray(0, 16);
  const iv = blob.subarray(16, 28);
  const authTag = blob.subarray(28, 44);
  const ciphertext = blob.subarray(44);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  fs.writeFileSync(jsonPath, plaintext);
  console.log(`Decrypted -> ${jsonPath}`);
}
