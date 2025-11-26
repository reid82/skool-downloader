#!/usr/bin/env node
/**
 * Debug script - find valid module URLs from a course
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

async function main() {
  const classroomUrl = process.argv[2] || 'https://www.skool.com/your-community/classroom';

  console.log(`\nFinding modules from: ${classroomUrl}\n`);

  const userDataDir = path.join('.skool-state', 'browser-profile');
  await fs.mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1400, height: 900 },
  });

  const page = await context.newPage();

  // Navigate to classroom
  console.log('Navigating to classroom...');
  await page.goto(classroomUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  console.log('Page title:', await page.title());
  console.log('Current URL:', page.url());

  // Get courses from __NEXT_DATA__
  const nextData = await page.evaluate(() => {
    const script = document.getElementById('__NEXT_DATA__');
    if (script?.textContent) {
      try { return JSON.parse(script.textContent); } catch { return null; }
    }
    return null;
  });

  if (nextData?.props?.pageProps?.allCourses) {
    const courses = nextData.props.pageProps.allCourses;
    console.log(`\nFound ${courses.length} courses:`);
    for (const course of courses.slice(0, 5)) {
      console.log(`  - ${course.metadata?.title || course.name} (${course.name}) - hasAccess: ${course.metadata?.hasAccess}`);
    }

    // Click on first accessible course
    const accessibleCourse = courses.find((c: { metadata?: { hasAccess?: number } }) => c.metadata?.hasAccess === 1);
    if (accessibleCourse) {
      console.log(`\nNavigating to first accessible course: ${accessibleCourse.metadata.title}`);
      const slug = classroomUrl.match(/skool\.com\/([^\/]+)/)?.[1] || '';
      const courseUrl = `https://www.skool.com/${slug}/classroom/${accessibleCourse.name}`;
      console.log(`Course URL: ${courseUrl}`);

      await page.goto(courseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000);

      // Try expanding accordions
      console.log('\nTrying to expand accordions...');
      const accordions = await page.locator('[aria-expanded="false"]').all();
      console.log(`Found ${accordions.length} collapsed sections`);

      for (const accordion of accordions.slice(0, 5)) {
        try {
          await accordion.click({ timeout: 1000 });
          await page.waitForTimeout(500);
        } catch {}
      }

      // Find module links
      const moduleLinks = await page.evaluate(() => {
        const links: Array<{ text: string; href: string }> = [];
        document.querySelectorAll('a').forEach((a) => {
          if (a.href.includes('md=')) {
            const text = a.textContent?.trim();
            if (text && text.length > 0 && text.length < 150) {
              if (!links.some((l) => l.href === a.href)) {
                links.push({ text, href: a.href });
              }
            }
          }
        });
        return links;
      });

      console.log(`\nFound ${moduleLinks.length} module links:`);
      for (const link of moduleLinks.slice(0, 10)) {
        console.log(`  - ${link.text}`);
        console.log(`    ${link.href}`);
      }

      // Try navigating to first module
      if (moduleLinks.length > 0) {
        console.log(`\n\nNavigating to first module: ${moduleLinks[0].text}`);
        await page.goto(moduleLinks[0].href, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);

        console.log('Page title:', await page.title());

        // Check for video elements
        const videoInfo = await page.evaluate(() => {
          return {
            videos: document.querySelectorAll('video').length,
            iframes: Array.from(document.querySelectorAll('iframe')).map(f => f.src).filter(s => !s.includes('stripe')),
            videoClasses: Array.from(document.querySelectorAll('[class*="video"], [class*="Video"], [class*="player"], [class*="Player"]')).map(e => e.className),
          };
        });

        console.log('\nVideo info on module page:');
        console.log(JSON.stringify(videoInfo, null, 2));
      }
    }
  } else {
    console.log('No __NEXT_DATA__ or courses found');
  }

  console.log('\nBrowser staying open for 30 seconds...');
  await page.waitForTimeout(30000);

  await context.close();
  console.log('Done!');
}

main().catch(console.error);
