'use strict';

// Apps that are always blocked — never tracked
const DEFAULT_BLOCKED_APPS = new Set([
  '1Password',
  '1Password 7',
  '1Password 8',
  'Keychain Access',
  'System Preferences',
  'System Settings',
  'FaceTime',
  'Messages',
  'Photos',
  'Signal',
  'WhatsApp',
]);

// Browser app names — handled by Chrome extension, not desktop agent
const BROWSER_APP_NAMES = new Set([
  'Google Chrome',
  'Google Chrome Canary',
  'Chromium',
  'Arc',
  'Brave Browser',
  'Safari',
  'Firefox',
  'Firefox Developer Edition',
  'Microsoft Edge',
  'Opera',
]);

// Window title patterns that indicate sensitive content — skip screenshots
const SENSITIVE_TITLE_PATTERNS = [
  /password/i,
  /log\s?in/i,
  /sign\s?in/i,
  /authenticate/i,
  /credentials/i,
  /1password/i,
  /keychain/i,
  /private\s+browsing/i,
  /incognito/i,
  /banking/i,
  /paypal/i,
];

// URL patterns for sensitive pages (used by Chrome extension, exported for completeness)
const SENSITIVE_URL_PATTERNS = [
  /\/login/i,
  /\/signin/i,
  /\/sign-in/i,
  /\/auth/i,
  /\/password/i,
  /\/oauth/i,
  /\/sso/i,
];

let userBlocklist = new Set();

/**
 * Set the user-defined blocklist (from settings).
 * @param {string[]} appNames
 */
function setUserBlocklist(appNames) {
  userBlocklist = new Set((appNames || []).map((a) => a.trim()).filter(Boolean));
}

/**
 * Returns true if the app should be skipped entirely (not tracked at all).
 * @param {string} appName
 */
function isBlocked(appName) {
  if (!appName) return false;
  return DEFAULT_BLOCKED_APPS.has(appName) || userBlocklist.has(appName);
}

/**
 * Returns true if the app is a browser and should defer to the Chrome extension.
 * @param {string} appName
 */
function isBrowser(appName) {
  return BROWSER_APP_NAMES.has(appName);
}

/**
 * Returns true if the window title suggests sensitive content
 * (e.g. password manager, login screen). Screenshots should be skipped.
 * @param {string} windowTitle
 */
function isPasswordScreen(windowTitle) {
  if (!windowTitle) return false;
  return SENSITIVE_TITLE_PATTERNS.some((pattern) => pattern.test(windowTitle));
}

/**
 * Returns true if the URL looks like an auth/login page.
 * @param {string} url
 */
function isSensitiveUrl(url) {
  if (!url) return false;
  return SENSITIVE_URL_PATTERNS.some((pattern) => pattern.test(url));
}

/**
 * Returns true if tracking should be completely skipped for this window.
 * @param {string} appName
 * @param {string} windowTitle
 */
function shouldSkip(appName, windowTitle) {
  return isBlocked(appName) || isPasswordScreen(windowTitle);
}

/**
 * Returns true if a screenshot should NOT be taken for this window.
 * (Broader than shouldSkip — includes password screens even in tracked apps.)
 * @param {string} appName
 * @param {string} windowTitle
 */
function shouldSkipScreenshot(appName, windowTitle) {
  return isBlocked(appName) || isPasswordScreen(windowTitle);
}

module.exports = {
  setUserBlocklist,
  isBlocked,
  isBrowser,
  isPasswordScreen,
  isSensitiveUrl,
  shouldSkip,
  shouldSkipScreenshot,
};
