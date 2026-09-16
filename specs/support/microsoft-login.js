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

const LOGIN_HOST = 'login.microsoftonline.com';

const onLoginHost = page => page.url().includes(LOGIN_HOST);

// Entra-joined machines complete sign-in via Seamless SSO without ever showing the password
// prompt, while CI runners always have to type it. Leaving the login host is the signal that
// authentication finished, whichever route it took.
function waitUntilOffLoginHost(page, timeout) {
  return page.waitForURL(url => !String(url).includes(LOGIN_HOST), { timeout });
}

async function signInWithTotp(page, { username, password, totpSecret }) {
  await page.goto('https://portal.azure.com/#home');

  const emailInput = page.getByPlaceholder('Email, phone, or Skype');
  const sawEmailPrompt = await emailInput
    .waitFor({ state: 'visible', timeout: 30 * 1000 })
    .then(() => true)
    .catch(() => false);

  if (!sawEmailPrompt) {
    if (!onLoginHost(page)) {
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
    waitUntilOffLoginHost(page, 45 * 1000)
  ]).catch(() => {});

  if (!onLoginHost(page)) {
    console.log('[microsoft-login] Signed in via single sign-on after the username step.');
    return;
  }

  await assertNoSignInError(page, 'username');
  await assertNoBlockingInterstitial(page);

  if (!(await passwordInput.isVisible().catch(() => false))) {
    const heading = ((await page.locator('h1, h2, [role="heading"]').first().textContent().catch(() => '')) || '').trim();
    throw new Error(
      `Password field never appeared after submitting the username. Current URL: ${page.url()}` +
        (heading ? ` | On-screen heading: "${heading}"` : '') +
        '. A redirect away from Microsoft to another identity provider means the tenant is federated, ' +
        'which this scripted flow does not handle.'
    );
  }

  await passwordInput.fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await assertNoSignInError(page, 'password');
  await assertNoBlockingInterstitial(page);

  // Some tenants show a "verify your identity" method chooser before the code input.
  const useCodeLink = page.getByRole('link', { name: /use a verification code|use another method|more ways to sign in/i });
  if (await useCodeLink.isVisible({ timeout: 10 * 1000 }).catch(() => false)) {
    await useCodeLink.click();
  }

  const codeInput = page.getByPlaceholder(/code/i).first();
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
