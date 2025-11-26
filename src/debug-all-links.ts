#!/usr/bin/env node
/**
 * Debug script to find ALL links and clickable elements
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

async function main() {
  const courseId = '5e585832b4e0457e9d0d524bbcecc744';
  const url = `https://www.skool.com/your-community/classroom?md=${courseId}`;

  console.log(`Opening ${url}...`);

  const userDataDir = path.join('.skool-state', 'browser-profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1400, height: 900 },
  });

  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('\nWaiting 8 seconds for page to fully load...\n');
  await page.waitForTimeout(8000);

  console.log('Current URL:', page.url());

  // Get ALL links
  const allLinks = await page.evaluate(() => {
    const links: Array<{text: string, href: string}> = [];
    document.querySelectorAll('a').forEach(a => {
      const href = a.href;
      const text = a.textContent?.trim()?.substring(0, 60);
      if (href && text) {
        links.push({ text, href });
      }
    });
    return links;
  });

  console.log(`\nAll links on page (${allLinks.length}):`);
  for (const link of allLinks.slice(0, 30)) {
    console.log(`  ${link.text}`);
    console.log(`    -> ${link.href}`);
  }

  // Get all text content to see what's visible
  const textContent = await page.evaluate(() => {
    return document.body.innerText.split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 3 && s.length < 100)
      .slice(0, 60);
  });

  console.log('\n\nPage text content (first 60 lines):');
  for (const line of textContent) {
    console.log(`  ${line}`);
  }

  // Look for clickable divs that might be modules
  const clickables = await page.evaluate(() => {
    const items: Array<{text: string, dataId?: string}> = [];
    document.querySelectorAll('[role="button"], [onclick], [data-module-id], [data-lesson-id], [data-id]').forEach(el => {
      const text = el.textContent?.trim()?.substring(0, 60);
      const dataId = el.getAttribute('data-id') || el.getAttribute('data-module-id') || el.getAttribute('data-lesson-id');
      if (text) {
        items.push({ text, dataId: dataId || undefined });
      }
    });
    return items;
  });

  console.log(`\n\nClickable elements (${clickables.length}):`);
  for (const item of clickables.slice(0, 20)) {
    console.log(`  ${item.text}${item.dataId ? ` [data-id=${item.dataId}]` : ''}`);
  }

  // Save full HTML
  const html = await page.content();
  await fs.writeFile('.skool-state/course-page.html', html);
  console.log('\nFull HTML saved to .skool-state/course-page.html');

  console.log('\nBrowser closing in 5 seconds...');
  await page.waitForTimeout(5000);

  await context.close();
}

main().catch(console.error);
