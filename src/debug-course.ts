#!/usr/bin/env node
/**
 * Debug script to inspect a specific course's DOM structure
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

async function main() {
  // Navigate to a specific course
  const url = 'https://www.skool.com/your-community/classroom?md=YOUR_MODULE_ID';

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

  // Extract __NEXT_DATA__ content
  const nextData = await page.evaluate(() => {
    const script = document.getElementById('__NEXT_DATA__');
    if (script?.textContent) {
      try {
        return JSON.parse(script.textContent);
      } catch {
        return null;
      }
    }
    return null;
  });

  if (nextData) {
    console.log('\n__NEXT_DATA__ found!');

    // Save full data for inspection
    await fs.writeFile('.skool-state/course-next-data.json', JSON.stringify(nextData, null, 2));
    console.log('Full __NEXT_DATA__ saved to .skool-state/course-next-data.json');

    const props = nextData.props?.pageProps;
    if (props) {
      console.log('\nPageProps keys:', Object.keys(props));
      
      // Look specifically for course data
      if (props.course) {
        console.log('\nCourse object found!');
        console.log('Course keys:', Object.keys(props.course));
        if (props.course.children) {
          console.log(`Course has ${props.course.children.length} children`);
          console.log('First child:', JSON.stringify(props.course.children[0], null, 2).substring(0, 500));
        } else {
          console.log('No children property on course');
        }
      }
      
      // Look for modules or lessons
      for (const key of Object.keys(props)) {
        const value = props[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          if (value.children || value.modules || value.lessons) {
            console.log(`\n${key} has nested content:`, Object.keys(value));
          }
        }
      }
    }
  } else {
    console.log('\n__NEXT_DATA__ not found or empty');
  }

  console.log('\nBrowser closing in 5 seconds...');
  await page.waitForTimeout(5000);

  await context.close();
  console.log('Done!');
}

main().catch(console.error);
