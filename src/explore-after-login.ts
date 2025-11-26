#!/usr/bin/env node
/**
 * Wait 60s for login, then explore the classroom
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

async function main() {
  const url = `https://www.skool.com/your-community/classroom`;

  console.log(`Opening ${url}...`);
  console.log('You have 60 seconds to log in...\n');

  const userDataDir = path.join('.skool-state', 'browser-profile');
  await fs.mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1400, height: 900 },
  });

  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait 60 seconds for login
  console.log('Waiting 60 seconds for login...');
  await page.waitForTimeout(60000);
  
  console.log('\n60 seconds passed. Exploring page...\n');
  console.log('Current URL:', page.url());

  // Navigate to classroom if not already there
  if (!page.url().includes('/classroom')) {
    console.log('Navigating to classroom...');
    await page.goto(`https://www.skool.com/your-community/classroom`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
  }

  // Get page text
  const textContent = await page.evaluate(() => {
    return document.body.innerText.split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 3 && s.length < 100)
      .slice(0, 40);
  });

  console.log('\nPage text:');
  for (const line of textContent) {
    console.log(`  ${line}`);
  }

  // Look for module links with md=
  const moduleLinks = await page.evaluate(() => {
    const links: Array<{text: string, href: string}> = [];
    document.querySelectorAll('a').forEach(a => {
      if (a.href.includes('md=')) {
        links.push({
          text: a.textContent?.trim()?.substring(0, 60) || '',
          href: a.href
        });
      }
    });
    return links;
  });

  console.log(`\nModule links (${moduleLinks.length}):`);
  for (const link of moduleLinks.slice(0, 20)) {
    console.log(`  ${link.text} -> ${link.href}`);
  }

  // Try clicking on a course card using force click
  console.log('\n\nTrying to click first course...');
  
  const clicked = await page.evaluate(() => {
    const buttons = document.querySelectorAll('[role="button"]');
    for (const btn of buttons) {
      const text = btn.textContent;
      if (text?.includes('Day 1') || text?.includes('Welcome')) {
        (btn as HTMLElement).click();
        return `Clicked: ${text?.substring(0, 50)}`;
      }
    }
    return 'No course button found';
  });
  
  console.log(clicked);
  await page.waitForTimeout(3000);
  
  console.log('URL after click:', page.url());

  // Check for module links again
  const linksAfter = await page.evaluate(() => {
    const links: Array<{text: string, href: string}> = [];
    document.querySelectorAll('a').forEach(a => {
      if (a.href.includes('md=')) {
        const text = a.textContent?.trim()?.substring(0, 60) || '';
        if (text && !links.some(l => l.href === a.href)) {
          links.push({ text, href: a.href });
        }
      }
    });
    return links;
  });

  console.log(`\nModule links after click (${linksAfter.length}):`);
  for (const link of linksAfter.slice(0, 20)) {
    console.log(`  ${link.text}`);
    console.log(`    -> ${link.href}`);
  }

  // Save __NEXT_DATA__
  const nextData = await page.evaluate(() => {
    const script = document.getElementById('__NEXT_DATA__');
    if (script?.textContent) {
      try { return JSON.parse(script.textContent); } catch { return null; }
    }
    return null;
  });
  
  if (nextData) {
    await fs.writeFile('.skool-state/explored-next-data.json', JSON.stringify(nextData, null, 2));
    console.log('\nSaved __NEXT_DATA__ to .skool-state/explored-next-data.json');
    
    // Check for course children
    const pp = nextData.props?.pageProps;
    if (pp?.allCourses) {
      console.log(`\nallCourses: ${pp.allCourses.length} courses`);
      for (const c of pp.allCourses.slice(0, 5)) {
        console.log(`  - ${c.metadata?.title} (${c.metadata?.numModules} modules)`);
        if (c.children) {
          console.log(`    Has ${c.children.length} children`);
        }
      }
    }
  }

  console.log('\nBrowser closing in 10 seconds...');
  await page.waitForTimeout(10000);

  await context.close();
  console.log('Done!');
}

main().catch(console.error);
