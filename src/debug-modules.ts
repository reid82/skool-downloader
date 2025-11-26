#!/usr/bin/env node
/**
 * Debug script to find modules in DOM when on a course page
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

async function main() {
  // First course
  const courseId = '5e585832b4e0457e9d0d524bbcecc744';
  const url = `https://www.skool.com/your-community/classroom?md=${courseId}`;

  console.log(`Opening ${url}...`);

  const userDataDir = path.join('.skool-state', 'browser-profile');
  await fs.mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1400, height: 900 },
  });

  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('\nWaiting 5 seconds for page to fully load...\n');
  await page.waitForTimeout(5000);

  console.log('Current URL:', page.url());

  // Look for links with md= parameter (module links)
  const moduleLinks = await page.evaluate(() => {
    const links: Array<{text: string, href: string, md: string}> = [];
    const allLinks = document.querySelectorAll('a[href*="md="]');
    
    allLinks.forEach(link => {
      const href = (link as HTMLAnchorElement).href;
      const text = link.textContent?.trim();
      const mdMatch = href.match(/md=([a-f0-9]+)/);
      
      if (mdMatch && text && !links.some(l => l.md === mdMatch[1])) {
        links.push({
          text: text.substring(0, 80),
          href,
          md: mdMatch[1]
        });
      }
    });
    
    return links;
  });

  console.log(`\nFound ${moduleLinks.length} module links:`);
  for (const link of moduleLinks.slice(0, 25)) {
    console.log(`  - ${link.text}`);
    console.log(`    md=${link.md}`);
  }

  // Also look at the sidebar structure
  const sidebarItems = await page.evaluate(() => {
    // Skool typically has a sidebar with course/module navigation
    const items: string[] = [];
    
    // Look for common sidebar selectors
    const selectors = [
      '[class*="sidebar"] a',
      '[class*="nav"] a',
      '[class*="menu"] a',
      '[class*="lesson"] a',
      '[class*="module"] a',
      '[role="navigation"] a'
    ];
    
    for (const sel of selectors) {
      const elements = document.querySelectorAll(sel);
      if (elements.length > 0) {
        items.push(`${sel}: ${elements.length} elements`);
      }
    }
    
    return items;
  });

  console.log('\nSidebar selectors found:');
  for (const item of sidebarItems) {
    console.log(`  ${item}`);
  }

  console.log('\nBrowser closing in 5 seconds...');
  await page.waitForTimeout(5000);

  await context.close();
  console.log('Done!');
}

main().catch(console.error);
