#!/usr/bin/env node
/**
 * Debug script - intercept network requests to find the modules API
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

async function main() {
  const url = `https://www.skool.com/your-community/classroom`;

  console.log(`Opening ${url}...`);

  const userDataDir = path.join('.skool-state', 'browser-profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1400, height: 900 },
  });

  const page = await context.newPage();

  // Intercept all requests
  const apiRequests: Array<{url: string, method: string, response?: string}> = [];
  
  page.on('response', async (response) => {
    const url = response.url();
    // Only interested in API calls that might return modules
    if (url.includes('/api/') || url.includes('graphql') || 
        (url.includes('skool.com') && response.request().method() === 'POST') ||
        url.includes('classroom') || url.includes('course') || url.includes('module')) {
      
      const req = {
        url,
        method: response.request().method(),
        response: undefined as string | undefined
      };
      
      try {
        const text = await response.text();
        if (text.length < 5000) {
          req.response = text.substring(0, 1000);
        } else {
          req.response = `[${text.length} bytes]`;
        }
      } catch {}
      
      apiRequests.push(req);
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('\nWaiting 5 seconds...');
  await page.waitForTimeout(5000);

  // Now click on first course
  console.log('\nClicking first course...');
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('[role="button"]');
    for (const btn of buttons) {
      const text = btn.textContent;
      if (text?.includes('Day 1')) {
        (btn as HTMLElement).click();
        break;
      }
    }
  });

  await page.waitForTimeout(3000);

  console.log(`\n\nAPI requests intercepted (${apiRequests.length}):`);
  for (const req of apiRequests) {
    console.log(`\n${req.method} ${req.url}`);
    if (req.response) {
      console.log(`  Response: ${req.response.substring(0, 200)}`);
    }
  }

  // Save all requests
  await fs.writeFile('.skool-state/api-requests.json', JSON.stringify(apiRequests, null, 2));
  console.log('\n\nSaved to .skool-state/api-requests.json');

  console.log('\nBrowser closing in 5 seconds...');
  await page.waitForTimeout(5000);

  await context.close();
}

main().catch(console.error);
