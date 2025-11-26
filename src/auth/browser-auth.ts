import { chromium, BrowserContext, Page } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import { ensureDir } from '../utils/file-utils.js';
import { Config } from '../config.js';

export interface AuthManager {
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

/**
 * Initialize browser with persistent Chrome profile for authentication
 */
export async function initBrowser(config: Config): Promise<AuthManager> {
  logger.startSpinner('Launching browser...');

  // Use a dedicated user data directory for Playwright
  // This avoids conflicts with running Chrome
  const userDataDir = path.join(config.stateDir, 'browser-profile');
  await ensureDir(userDataDir);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  logger.succeedSpinner('Browser launched');

  return {
    context,
    page,
    close: async () => {
      await context.close();
    },
  };
}

/**
 * Check if user is logged into Skool
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    // Check for common logged-in indicators
    const loggedInSelector = '[data-testid="user-menu"], [class*="avatar"], [class*="UserMenu"]';
    const loginButton = 'a[href*="login"], button:has-text("Log in")';

    // If we can find the login button, we're not logged in
    const hasLoginButton = await page.locator(loginButton).first().isVisible({ timeout: 2000 }).catch(() => false);
    if (hasLoginButton) {
      return false;
    }

    // Try to find logged-in indicator
    const hasUserMenu = await page.locator(loggedInSelector).first().isVisible({ timeout: 2000 }).catch(() => false);
    return hasUserMenu;
  } catch {
    return false;
  }
}

/**
 * Wait for user to manually log in
 * Polls every 5 seconds to check if login succeeded
 */
export async function waitForLogin(page: Page, targetUrl: string): Promise<void> {
  logger.info('');
  logger.info('Please log in to Skool in the browser window...');
  logger.info('Waiting for login (checking every 5 seconds)...');

  // Navigate to the login page or target URL
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch {
    // Page may already be loading, continue
  }

  // Poll for login status instead of waiting for Enter
  let attempts = 0;
  const maxAttempts = 24; // 2 minutes max wait

  while (attempts < maxAttempts) {
    await page.waitForTimeout(5000);
    attempts++;

    const loggedIn = await isLoggedIn(page);
    if (loggedIn) {
      logger.success('Login detected!');
      return;
    }

    // Also check if we're on a classroom page (means we're logged in)
    const currentUrl = page.url();
    if (currentUrl.includes('/classroom') && !currentUrl.includes('login')) {
      logger.success('Login detected (on classroom page)!');
      return;
    }

    logger.debug(`Still waiting for login... (${attempts}/${maxAttempts})`);
  }

  logger.warn('Login timeout - continuing anyway...');
}

/**
 * Navigate to Skool and ensure we're logged in
 */
export async function ensureAuthenticated(
  page: Page,
  targetUrl: string
): Promise<void> {
  logger.startSpinner('Checking authentication...');

  try {
    // Use domcontentloaded with longer timeout - networkidle can hang
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Give page time to render
    await page.waitForTimeout(3000);
  } catch (error) {
    logger.stopSpinner();
    logger.warn('Page load slow, continuing with login check...');
  }

  const loggedIn = await isLoggedIn(page);

  if (loggedIn) {
    logger.succeedSpinner('Already logged in');
    return;
  }

  logger.stopSpinner();
  await waitForLogin(page, targetUrl);
}

/**
 * Export cookies to file for yt-dlp
 */
export async function exportCookies(
  context: BrowserContext,
  outputPath: string
): Promise<void> {
  const cookies = await context.cookies();
  await ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, JSON.stringify(cookies, null, 2));
  logger.debug(`Cookies exported to ${outputPath}`);
}

/**
 * Convert cookies to Netscape format for yt-dlp
 */
export async function exportNetscapeCookies(
  context: BrowserContext,
  outputPath: string
): Promise<void> {
  const cookies = await context.cookies();

  const lines = [
    '# Netscape HTTP Cookie File',
    '# https://curl.haxx.se/rfc/cookie_spec.html',
    '# This is a generated file! Do not edit.',
    '',
  ];

  for (const cookie of cookies) {
    const domain = cookie.domain.startsWith('.') ? cookie.domain : `.${cookie.domain}`;
    const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const path = cookie.path || '/';
    const secure = cookie.secure ? 'TRUE' : 'FALSE';
    const expires = cookie.expires ? Math.floor(cookie.expires) : '0';

    lines.push(
      `${domain}\t${includeSubdomains}\t${path}\t${secure}\t${expires}\t${cookie.name}\t${cookie.value}`
    );
  }

  await ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, lines.join('\n'));
  logger.debug(`Netscape cookies exported to ${outputPath}`);
}
