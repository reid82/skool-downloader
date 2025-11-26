#!/usr/bin/env node
/**
 * Debug - try calling Skool API to get course children
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

async function main() {
  const userDataDir = path.join('.skool-state', 'browser-profile');
  await fs.mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1400, height: 900 },
  });

  const page = await context.newPage();
  
  // Go to classroom first to get cookies
  console.log('Navigating to classroom...');
  await page.goto('https://www.skool.com/your-community/classroom', { 
    waitUntil: 'domcontentloaded', 
    timeout: 60000 
  });
  await page.waitForTimeout(5000);

  // Get course ID from __NEXT_DATA__
  const nextData = await page.evaluate(() => {
    const script = document.getElementById('__NEXT_DATA__');
    if (script?.textContent) {
      try { return JSON.parse(script.textContent); } catch { return null; }
    }
    return null;
  });

  const courses = nextData?.props?.pageProps?.allCourses || [];
  const firstCourse = courses.find((c: { metadata?: { hasAccess?: number } }) => 
    c.metadata?.hasAccess === 1
  );
  
  if (!firstCourse) {
    console.log('No accessible course found');
    await context.close();
    return;
  }

  const courseId = firstCourse.id;
  const groupId = firstCourse.groupId;
  console.log(`\nCourse: ${firstCourse.metadata.title}`);
  console.log(`Course ID: ${courseId}`);
  console.log(`Group ID: ${groupId}`);

  // Try to fetch course children via API
  console.log('\n\nTrying Skool API endpoints...\n');
  
  // Try different API endpoints
  const endpoints = [
    `https://api2.skool.com/course/${courseId}/modules`,
    `https://api2.skool.com/course/${courseId}/children`,
    `https://api2.skool.com/groups/${groupId}/courses/${courseId}`,
    `https://api2.skool.com/v2/course/${courseId}`,
    `https://api2.skool.com/v1/courses/${courseId}/modules`,
  ];

  for (const endpoint of endpoints) {
    console.log(`Trying: ${endpoint}`);
    try {
      const result = await page.evaluate(async (url: string) => {
        try {
          const resp = await fetch(url, { credentials: 'include' });
          const data = await resp.json();
          return { status: resp.status, data };
        } catch (e) {
          return { error: String(e) };
        }
      }, endpoint);
      console.log(`  Result: ${JSON.stringify(result).substring(0, 200)}\n`);
    } catch (e) {
      console.log(`  Error: ${e}\n`);
    }
  }

  // Try directly navigating to a URL with courseId
  const courseUrl = `https://www.skool.com/your-community/classroom/${courseId}`;
  console.log(`\nTrying navigation: ${courseUrl}`);
  await page.goto(courseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  console.log(`Redirected to: ${page.url()}`);

  // Check if this is the course page with modules
  const pageText = await page.evaluate(() => {
    return document.body.innerText.substring(0, 500);
  });
  console.log(`\nPage text: ${pageText.substring(0, 300)}...`);

  // Check for module links
  const moduleLinks = await page.evaluate(() => {
    const links: Array<{text: string, href: string}> = [];
    document.querySelectorAll('a').forEach(a => {
      if (a.href.includes('md=')) {
        const text = a.textContent?.trim();
        if (text && text.length > 0 && text.length < 100) {
          if (!links.some(l => l.href === a.href)) {
            links.push({ text, href: a.href });
          }
        }
      }
    });
    return links;
  });

  console.log(`\nModule links found (${moduleLinks.length}):`);
  for (const link of moduleLinks.slice(0, 10)) {
    console.log(`  ${link.text}`);
    console.log(`    -> ${link.href}`);
  }

  console.log('\nBrowser staying open for 20 seconds...');
  await page.waitForTimeout(20000);

  await context.close();
  console.log('Done!');
}

main().catch(console.error);
