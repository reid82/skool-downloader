#!/usr/bin/env node
/**
 * Debug script - click on a course using JS click
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

  // Try to click using evaluate
  const result = await page.evaluate(() => {
    const buttons = document.querySelectorAll('[role="button"]');
    const info: string[] = [];
    
    for (const btn of buttons) {
      const text = btn.textContent?.trim()?.substring(0, 40);
      if (text && text.includes('Day 1')) {
        info.push(`Found: ${text}`);
        (btn as HTMLElement).click();
        info.push('Clicked!');
        break;
      }
    }
    
    return info;
  });
  
  console.log('Click result:', result);
  
  await page.waitForTimeout(3000);
  console.log('URL after click:', page.url());

  // Check for module links now
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

  console.log(`\nModule links (${moduleLinks.length}):`);
  for (const link of moduleLinks.slice(0, 25)) {
    console.log(`  ${link.text}`);
    console.log(`    ${link.href}`);
  }

  // Get all course IDs from the URL
  console.log('\n\nAll __NEXT_DATA__ course children:');
  const childrenInfo = await page.evaluate(() => {
    const script = document.getElementById('__NEXT_DATA__');
    if (!script?.textContent) return [];
    
    try {
      const data = JSON.parse(script.textContent);
      const courses = data.props?.pageProps?.allCourses || [];
      const results: Array<{title: string, id: string, numModules: number}> = [];
      
      for (const course of courses) {
        results.push({
          title: course.metadata?.title || 'Unknown',
          id: course.id,
          numModules: course.metadata?.numModules || 0
        });
      }
      return results;
    } catch {
      return [];
    }
  });
  
  for (const c of childrenInfo) {
    console.log(`  ${c.title} (${c.numModules} modules) - ${c.id}`);
  }

  console.log('\nBrowser closing in 5 seconds...');
  await page.waitForTimeout(5000);

  await context.close();
}

main().catch(console.error);
