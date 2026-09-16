const { generateTotp, secondsRemainingInWindow } = require('./totp');

// Scripted Microsoft Entra ID sign-in for a dedicated automation account with TOTP-based MFA.
// A real code is generated and submitted every run, so there is no session to expire and
// nothing to re-capture - unlike a Playwright storage state, which dies within hours.
// Selectors target Microsoft's standard login UI text - re-verify against this tenant's
// login pages if Microsoft changes that UI.

const MIN_WINDOW_SECONDS = 6;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Entra rejections all look identical to Playwright: a page that never advances. Surfacing
// the on-screen text turns a 60s timeout into an actionable error.
async function assertNoSignInError(page, stage) {
  const error = page.locator('#passwordError, #idTD_Error, [role="alert"]').first();
  const text = ((await error.textContent({ timeout: 2000 }).catch(() => '')) || '').trim();
  if (text) {
    throw new Error(`Microsoft sign-in failed at the ${stage} step: ${text}`);
  }
}

// Interstitials that mean the automation account is misconfigured rather than the test
// being wrong. Without this they hang until the step times out with no explanation.
async function assertNoBlockingInterstitial(page) {
  const blockers = [
    {
      pattern: /Help us protect your account|More information required/i,
      hint: 'the account is being forced to register MFA - complete registration once interactively, then use that authenticator secret as TOTP_SECRET'
    },
    {
      pattern: /Update your password|Your password has expired/i,
      hint: 'the account password expired - set the automation account password to never expire'
    },
    {
      pattern: /Approve sign.?in request|Open your Authenticator app/i,
      hint: 'the tenant is forcing Authenticator push/number-matching instead of a code - enable the "Software OATH token" method for this account'
    },
    {
      pattern: /can.t be accessed right now|blocked by Conditional Access|device is not compliant/i,
      hint: 'a Conditional Access policy is blocking the GitHub runner - exclude the automation account from device-compliance/named-location policies'
    }
  ];

  const body = (await page.locator('body').innerText().catch(() => '')) || '';
  for (const { pattern, hint } of blockers) {
    if (pattern.test(body)) {
      throw new Error(`Microsoft sign-in blocked: ${hint}.`);
    }
  }
}

const PORTAL_URL_PART = 'portal.azure.com';

// Reaching the portal is the only reliable "authenticated" signal: the sign-in journey spans
// several Microsoft hosts (login.microsoftonline.com, login.microsoft.com for the FIDO
// bridge), so "left the login host" wrongly reports success midway through.
const onPortal = page => page.url().includes(PORTAL_URL_PART);

function waitUntilOnPortal(page, timeout) {
  return page.waitForURL(url => String(url).includes(PORTAL_URL_PART), { timeout });
}

// Passkey-first tenants open a FIDO prompt instead of asking for a password, and offer the
// other methods behind a "Sign in another way" link leading to a "Choose a way to sign in"
// list. Walk that path to reach the requested method.
async function chooseSignInMethod(page, optionPattern) {
  const option = page
    .getByRole('button', { name: optionPattern })
    .or(page.getByRole('link', { name: optionPattern }))
    .or(page.getByText(optionPattern));
  const anotherWayPattern = /sign in another way|other ways to sign in|use another method|more ways to sign in|having trouble/i;
  const anotherWay = page
    .getByRole('link', { name: anotherWayPattern })
    .or(page.getByRole('button', { name: anotherWayPattern }));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await option.first().isVisible({ timeout: 5 * 1000 }).catch(() => false)) {
      await option.first().click();
      return true;
    }
    if (!(await anotherWay.first().isVisible({ timeout: 5 * 1000 }).catch(() => false))) {
      return false;
    }
    await anotherWay.first().click();
  }
  return false;
}

async function signInWithTotp(page, { username, password, totpSecret }) {
  await page.goto('https://portal.azure.com/#home');

  const emailInput = page.getByPlaceholder('Email, phone, or Skype');
  const sawEmailPrompt = await emailInput
    .waitFor({ state: 'visible', timeout: 30 * 1000 })
    .then(() => true)
    .catch(() => false);

  if (!sawEmailPrompt) {
    if (onPortal(page)) {
      console.log('[microsoft-login] Already signed in (single sign-on) - no credentials needed.');
      return;
    }
    throw new Error(`Stalled on the sign-in page without a username field. Current URL: ${page.url()}`);
  }

  await emailInput.fill(username);
  await page.getByRole('button', { name: 'Next' }).click();

  const passwordInput = page.getByPlaceholder('Password');
  const errorText = page.locator('#usernameError, #passwordError, #idTD_Error, [role="alert"]').first();
  await Promise.race([
    passwordInput.waitFor({ state: 'visible', timeout: 45 * 1000 }),
    errorText.waitFor({ state: 'visible', timeout: 45 * 1000 }),
    waitUntilOnPortal(page, 45 * 1000)
  ]).catch(() => {});

  if (onPortal(page)) {
    console.log('[microsoft-login] Signed in via single sign-on after the username step.');
    return;
  }

  await assertNoSignInError(page, 'username');

  if (!(await passwordInput.isVisible().catch(() => false))) {
    console.log('[microsoft-login] Password prompt not shown - selecting the password method.');
    await chooseSignInMethod(page, /use my password|use your password/i);
    await passwordInput.waitFor({ state: 'visible', timeout: 45 * 1000 }).catch(() => {});
  }

  await assertNoBlockingInterstitial(page);

  if (!(await passwordInput.isVisible().catch(() => false))) {
    const heading = ((await page.locator('h1, h2, [role="heading"]').first().textContent().catch(() => '')) || '').trim();
    throw new Error(
      `Password field never appeared after submitting the username. Current URL: ${page.url()}` +
        (heading ? ` | On-screen heading: "${heading}"` : '') +
        '. If the tenant requires phishing-resistant (FIDO2/passkey) sign-in with no password ' +
        'fallback, this flow cannot be scripted.'
    );
  }

  await passwordInput.fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await assertNoSignInError(page, 'password');
  await assertNoBlockingInterstitial(page);

  const codeInput = page.getByPlaceholder(/code/i).first();
  if (!(await codeInput.isVisible({ timeout: 10 * 1000 }).catch(() => false))) {
    console.log('[microsoft-login] Code prompt not shown - selecting the verification code method.');
    await chooseSignInMethod(page, /verification code|authenticator app|enter a code/i);
  }

  await codeInput.waitFor({ state: 'visible', timeout: 60 * 1000 });

  // Never submit a code that is about to rotate - otherwise it can expire between being
  // typed and being validated server-side, which fails only intermittently.
  const remaining = secondsRemainingInWindow();
  if (remaining < MIN_WINDOW_SECONDS) {
    await sleep((remaining + 1) * 1000);
  }

  await codeInput.fill(generateTotp(totpSecret));
  await page.getByRole('button', { name: /verify|sign in/i }).click();
  await assertNoSignInError(page, 'verification code');

  // "Stay signed in?" prompt - optional depending on tenant policy.
  const staySignedInYes = page.getByRole('button', { name: 'Yes' });
  if (await staySignedInYes.isVisible({ timeout: 15 * 1000 }).catch(() => false)) {
    await staySignedInYes.click();
  }

  await page.waitForURL(/portal\.azure\.com/, { timeout: 60 * 1000 });
}

module.exports = { signInWithTotp };
