#!/usr/bin/env node
/**
 * Debug script - click on a course to see modules
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

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('\nWaiting 5 seconds for page to fully load...\n');
  await page.waitForTimeout(5000);

  // Click on the first course to expand it
  console.log('Looking for course items to click...');
  
  // Find elements with role="button" that contain course titles
  const courseButtons = await page.$$('[role="button"]');
  console.log(`Found ${courseButtons.length} button elements`);
  
  if (courseButtons.length > 0) {
    const firstCourse = courseButtons[0];
    const text = await firstCourse.textContent();
    console.log(`\nClicking first course: ${text?.substring(0, 50)}...`);
    await firstCourse.click();
    
    await page.waitForTimeout(3000);
    
    console.log('URL after click:', page.url());
    
    // Check for modules now
    const moduleLinks = await page.evaluate(() => {
      const links: Array<{text: string, href: string}> = [];
      document.querySelectorAll('a[href*="md="]').forEach(a => {
        const href = (a as HTMLAnchorElement).href;
        const text = a.textContent?.trim()?.substring(0, 60);
        if (text && href && !links.some(l => l.href === href)) {
          links.push({ text, href });
        }
      });
      return links;
    });
    
    console.log(`\nModule links after clicking (${moduleLinks.length}):`);
    for (const link of moduleLinks.slice(0, 20)) {
      console.log(`  ${link.text}`);
      console.log(`    -> ${link.href}`);
    }
    
    // Get visible text
    const visibleText = await page.evaluate(() => {
      return document.body.innerText.split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 3 && s.length < 80)
        .slice(0, 40);
    });
    
    console.log('\nVisible text after click:');
    for (const line of visibleText) {
      console.log(`  ${line}`);
    }
    
    // Save __NEXT_DATA__ after click
    const nextData = await page.evaluate(() => {
      const script = document.getElementById('__NEXT_DATA__');
      if (script?.textContent) {
        try { return JSON.parse(script.textContent); } catch { return null; }
      }
      return null;
    });
    
    if (nextData) {
      await fs.writeFile('.skool-state/after-click-next-data.json', JSON.stringify(nextData, null, 2));
      console.log('\nSaved __NEXT_DATA__ to .skool-state/after-click-next-data.json');
    }
  }

  console.log('\nBrowser closing in 5 seconds...');
  await page.waitForTimeout(5000);

  await context.close();
}

main().catch(console.error);
