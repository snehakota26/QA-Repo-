// Prints the current TOTP code for TOTP_SECRET so you can verify a seed copied during
// authenticator enrollment actually works, before putting it in GitHub secrets.
// Put TOTP_SECRET in .env (gitignored) to keep the seed out of shell history.
const { generateTotp, secondsRemainingInWindow } = require('../specs/support/totp');
require('dotenv').config();

const secret = (process.env.TOTP_SECRET || '').trim();
if (!secret) {
  console.error('Set TOTP_SECRET in .env (preferred) or as an environment variable, then run: npm run totp');
  process.exit(1);
}

try {
  // base32Decode silently drops characters outside the alphabet, so a typo'd or truncated
  // seed still yields plausible-looking codes that Entra rejects. Surface that here rather
  // than letting it fail as an unexplained 60s timeout in CI.
  const cleaned = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const ignored = secret.replace(/\s/g, '').length - cleaned.length;
  if (ignored > 0) {
    console.warn(`Warning: ${ignored} character(s) in TOTP_SECRET are not valid base32 and were ignored.`);
  }

  console.log(`Code: ${generateTotp(secret)}  (valid for ${secondsRemainingInWindow()}s)`);
  console.log('Confirm this matches the code your authenticator app shows for the same account right now.');
} catch (error) {
  console.error(`Could not generate a code from TOTP_SECRET: ${error.message}`);
  console.error('The seed must be the base32 "Secret key" shown behind "Can\'t scan image?" during enrollment.');
  process.exit(1);
}
