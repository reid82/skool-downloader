#!/usr/bin/env node
/**
 * Debug script - navigate directly to course URL and look for modules
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

async function main() {
  // Day 1 course - has 19 modules
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

  // Get page text to see what's shown
  const pageText = await page.evaluate(() => {
    return document.body.innerText.split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 3 && s.length < 100);
  });

  console.log(`\nPage text (${pageText.length} lines):`);
  for (const line of pageText.slice(0, 50)) {
    console.log(`  ${line}`);
  }

  // Look for ALL href patterns
  const allHrefs = await page.evaluate(() => {
    const hrefs: string[] = [];
    document.querySelectorAll('a').forEach(a => {
      if (a.href && !hrefs.includes(a.href)) {
        hrefs.push(a.href);
      }
    });
    return hrefs;
  });

  console.log(`\n\nAll links (${allHrefs.length}):`);
  for (const href of allHrefs) {
    console.log(`  ${href}`);
  }

  // Check __NEXT_DATA__ for course children or selected module
  const nextDataInfo = await page.evaluate(() => {
    const script = document.getElementById('__NEXT_DATA__');
    if (!script?.textContent) return null;
    
    try {
      const data = JSON.parse(script.textContent);
      const pp = data.props?.pageProps;
      
      return {
        keys: Object.keys(pp || {}),
        selectedModule: pp?.selectedModule,
        courseType: typeof pp?.course,
        courseKeys: pp?.course ? Object.keys(pp.course) : null,
        allCoursesCount: pp?.allCourses?.length,
        firstCourseKeys: pp?.allCourses?.[0] ? Object.keys(pp.allCourses[0]) : null
      };
    } catch {
      return null;
    }
  });

  console.log('\n\n__NEXT_DATA__ info:', JSON.stringify(nextDataInfo, null, 2));

  // Save full next data
  const fullNextData = await page.evaluate(() => {
    const script = document.getElementById('__NEXT_DATA__');
    if (script?.textContent) {
      try { return JSON.parse(script.textContent); } catch { return null; }
    }
    return null;
  });
  
  if (fullNextData) {
    await fs.writeFile('.skool-state/direct-nav-next-data.json', JSON.stringify(fullNextData, null, 2));
    console.log('\nSaved to .skool-state/direct-nav-next-data.json');
  }

  console.log('\nBrowser closing in 5 seconds...');
  await page.waitForTimeout(5000);

  await context.close();
}

main().catch(console.error);
