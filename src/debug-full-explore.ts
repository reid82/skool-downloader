#!/usr/bin/env node
/**
 * Debug - fully explore the classroom UI
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

  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Let's double-click on a course to see if it opens
  console.log('\nDouble clicking on Day 1...');
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('[role="button"]');
    for (const btn of buttons) {
      if (btn.textContent?.includes('Day 1')) {
        // Create and dispatch double click event
        const event = new MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
          view: window
        });
        btn.dispatchEvent(event);
        break;
      }
    }
  });

  await page.waitForTimeout(2000);
  console.log('URL after double-click:', page.url());

  // Check if modules appeared
  const textNow = await page.evaluate(() => {
    return document.body.innerText.split('\n')
      .filter(s => s.trim().length > 3 && s.trim().length < 100)
      .slice(0, 50);
  });

  console.log('\nText after double-click:');
  for (const line of textNow) {
    console.log(`  ${line}`);
  }

  // Check if there are now module links
  const linksNow = await page.evaluate(() => {
    const links: string[] = [];
    document.querySelectorAll('a').forEach(a => {
      if (a.href.includes('md=')) {
        links.push(`${a.textContent?.trim()?.substring(0, 50)} -> ${a.href}`);
      }
    });
    return links;
  });

  console.log(`\nLinks with md= (${linksNow.length}):`);
  for (const link of linksNow.slice(0, 20)) {
    console.log(`  ${link}`);
  }

  console.log('\nBrowser closing in 5 seconds...');
  await page.waitForTimeout(5000);
  await context.close();
}

main().catch(console.error);
