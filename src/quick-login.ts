#!/usr/bin/env node
/**
 * Quick login - opens browser for manual login, waits for classroom page
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

async function main() {
  const url = `https://www.skool.com/your-community/classroom`;

  console.log(`Opening ${url}...`);
  console.log('Please log in manually. Script will continue when you reach the classroom page.\n');

  const userDataDir = path.join('.skool-state', 'browser-profile');
  await fs.mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1400, height: 900 },
  });

  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for user to log in - check every 5 seconds
  let attempts = 0;
  while (attempts < 60) {  // 5 minute max
    await page.waitForTimeout(5000);
    attempts++;
    
    const currentUrl = page.url();
    const pageText = await page.evaluate(() => document.body.innerText);
    
    // Check if we're logged in and on classroom
    if (currentUrl.includes('/classroom') && !pageText.includes('LOG IN')) {
      console.log('\nLogin detected! On classroom page.');
      break;
    }
    
    console.log(`Waiting for login... (${attempts * 5}s)`);
  }

  // Now explore the classroom
  console.log('\nExploring classroom...\n');
  
  await page.waitForTimeout(5000);

  // Get all text content
  const textContent = await page.evaluate(() => {
    return document.body.innerText.split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 3 && s.length < 100)
      .slice(0, 50);
  });

  console.log('Page text:');
  for (const line of textContent) {
    console.log(`  ${line}`);
  }

  // Try to find and click on a course
  console.log('\n\nLooking for clickable course items...');
  
  // Get info about role="button" elements
  const buttons = await page.evaluate(() => {
    const results: Array<{text: string, classes: string, tag: string, clickable: boolean}> = [];
    document.querySelectorAll('[role="button"]').forEach(el => {
      results.push({
        text: el.textContent?.trim()?.substring(0, 50) || '',
        classes: el.className.toString().substring(0, 50),
        tag: el.tagName,
        clickable: (el as HTMLElement).onclick !== null
      });
    });
    return results;
  });

  console.log(`\nButton elements (${buttons.length}):`);
  for (const btn of buttons) {
    console.log(`  [${btn.tag}] "${btn.text}"`);
  }

  // Try clicking the first course using Playwright's click
  if (buttons.length > 0) {
    console.log('\n\nAttempting to click first course...');
    const courseButton = page.locator('[role="button"]').first();
    await courseButton.click({ force: true, timeout: 5000 }).catch(e => {
      console.log('Click failed:', e.message);
    });
    
    await page.waitForTimeout(3000);
    console.log('URL after click:', page.url());
    
    // Check for modules
    const moduleLinks = await page.evaluate(() => {
      const links: Array<{text: string, href: string}> = [];
      document.querySelectorAll('a').forEach(a => {
        if (a.href.includes('md=')) {
          links.push({
            text: a.textContent?.trim()?.substring(0, 50) || '',
            href: a.href
          });
        }
      });
      return links;
    });

    console.log(`\nModule links found (${moduleLinks.length}):`);
    for (const link of moduleLinks.slice(0, 20)) {
      console.log(`  ${link.text}`);
      console.log(`    -> ${link.href}`);
    }
    
    // Also check page text again
    const newText = await page.evaluate(() => {
      return document.body.innerText.split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 3 && s.length < 100)
        .slice(0, 30);
    });
    
    console.log('\n\nPage text after click:');
    for (const line of newText) {
      console.log(`  ${line}`);
    }
  }

  console.log('\n\nKeeping browser open for 30 seconds for manual inspection...');
  await page.waitForTimeout(30000);

  await context.close();
  console.log('Done!');
}

main().catch(console.error);
