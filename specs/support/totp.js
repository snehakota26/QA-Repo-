// RFC 4226 (HOTP) / RFC 6238 (TOTP) implementation - no external dependency needed.
// Used to generate MFA codes for the dedicated Azure Portal automation account so CI can
// sign in fresh every run instead of relying on a manually re-captured storage state.
const crypto = require('node:crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(base32) {
  const clean = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) throw new Error(`Invalid base32 character: ${char}`);
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateHotp(key, counter, { digits = 6 } = {}) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binaryCode % 10 ** digits).toString().padStart(digits, '0');
}

function generateTotp(base32Secret, { step = 30, digits = 6, timestamp = Date.now() } = {}) {
  const key = base32Decode(base32Secret);
  const counter = Math.floor(timestamp / 1000 / step);
  return generateHotp(key, counter, { digits });
}

// Seconds left before the current code rotates. Submitting a code in its last moments is a
// common CI flake: it expires between being typed and being validated server-side.
function secondsRemainingInWindow({ step = 30, timestamp = Date.now() } = {}) {
  return step - (Math.floor(timestamp / 1000) % step);
}

module.exports = { base32Decode, generateHotp, generateTotp, secondsRemainingInWindow };
