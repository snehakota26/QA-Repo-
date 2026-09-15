const { generateTotp } = require('./totp');

// Scripted Microsoft/Azure AD sign-in for a dedicated automation account with TOTP-based MFA
// (no MFA exemption needed - a real code is generated and submitted every run). Only used
// when AZURE_PORTAL_USERNAME/AZURE_PORTAL_PASSWORD/TOTP_SECRET are configured; otherwise the
// existing storage-state flow is used instead. Selectors target Microsoft's standard login UI
// text - re-verify against this tenant's login pages if Microsoft changes that UI.
async function signInWithTotp(page, { username, password, totpSecret }) {
  await page.goto('https://portal.azure.com/#home');

  await page.getByPlaceholder('Email, phone, or Skype').fill(username);
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Some tenants show a "verify your identity" method chooser before the code input.
  const useCodeLink = page.getByRole('link', { name: /use a verification code|use another method|more ways to sign in/i });
  if (await useCodeLink.isVisible({ timeout: 10 * 1000 }).catch(() => false)) {
    await useCodeLink.click();
  }

  const codeInput = page.getByPlaceholder(/code/i).first();
  await codeInput.waitFor({ state: 'visible', timeout: 60 * 1000 });
  await codeInput.fill(generateTotp(totpSecret));
  await page.getByRole('button', { name: /verify|sign in/i }).click();

  // "Stay signed in?" prompt - optional depending on tenant policy.
  const staySignedInYes = page.getByRole('button', { name: 'Yes' });
  if (await staySignedInYes.isVisible({ timeout: 15 * 1000 }).catch(() => false)) {
    await staySignedInYes.click();
  }

  await page.waitForURL(/portal\.azure\.com/, { timeout: 60 * 1000 });
}

module.exports = { signInWithTotp };
