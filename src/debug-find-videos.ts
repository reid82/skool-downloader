#!/usr/bin/env node
/**
 * Debug script - navigate using Skool's API structure to find videos
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
  
  // Capture all network responses
  const capturedResponses: Array<{url: string, data?: unknown}> = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('api2.skool.com') || url.includes('.m3u8') || 
        url.includes('mux') || url.includes('stream')) {
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('json')) {
          const data = await response.json().catch(() => null);
          capturedResponses.push({ url, data });
        } else {
          capturedResponses.push({ url });
        }
      } catch {
        capturedResponses.push({ url });
      }
    }
  });

  // Go to classroom
  console.log('Navigating to classroom...');
  await page.goto('https://www.skool.com/your-community/classroom', { 
    waitUntil: 'domcontentloaded', 
    timeout: 60000 
  });
  await page.waitForTimeout(5000);

  // Get courses from __NEXT_DATA__
  const nextData = await page.evaluate(() => {
    const script = document.getElementById('__NEXT_DATA__');
    if (script?.textContent) {
      try { return JSON.parse(script.textContent); } catch { return null; }
    }
    return null;
  });

  if (!nextData) {
    console.log('No __NEXT_DATA__ found');
    await context.close();
    return;
  }

  const courses = nextData.props?.pageProps?.allCourses || [];
  console.log(`\nFound ${courses.length} courses`);
  
  // Get first course with access
  const firstCourse = courses.find((c: { metadata?: { hasAccess?: number } }) => 
    c.metadata?.hasAccess === 1
  );
  
  if (!firstCourse) {
    console.log('No accessible courses found');
    await context.close();
    return;
  }
  
  console.log(`\nFirst accessible course: ${firstCourse.metadata.title}`);
  console.log(`Course ID: ${firstCourse.id}`);
  console.log(`Modules: ${firstCourse.metadata.numModules}`);

  // Try clicking on the course using JavaScript
  console.log('\nClicking course via JavaScript...');
  await page.evaluate((courseTitle: string) => {
    const elements = document.querySelectorAll('[role="button"]');
    for (const el of elements) {
      if (el.textContent?.includes(courseTitle)) {
        (el as HTMLElement).click();
        return true;
      }
    }
    return false;
  }, firstCourse.metadata.title);
  
  await page.waitForTimeout(3000);
  console.log('URL after click:', page.url());

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

  console.log(`\nModule links after click (${moduleLinks.length}):`);
  for (const link of moduleLinks.slice(0, 10)) {
    console.log(`  ${link.text}`);
    console.log(`    -> ${link.href}`);
  }

  // If we found modules, navigate to the first one
  if (moduleLinks.length > 0) {
    console.log(`\n\nNavigating to module: ${moduleLinks[0].text}`);
    await page.goto(moduleLinks[0].href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);  // Wait longer for video to load

    console.log('URL:', page.url());

    // Check for video elements
    const videoInfo = await page.evaluate(() => {
      const info: Record<string, unknown> = {
        videos: [] as unknown[],
        iframes: [] as unknown[],
        muxPlayers: [] as unknown[],
        allElements: [] as string[],
      };

      // Videos
      document.querySelectorAll('video').forEach(v => {
        (info.videos as unknown[]).push({
          src: v.src,
          sources: Array.from(v.querySelectorAll('source')).map(s => s.src),
          poster: v.poster,
          currentSrc: v.currentSrc,
        });
      });

      // Iframes (excluding Stripe)
      document.querySelectorAll('iframe').forEach(f => {
        if (!f.src.includes('stripe')) {
          (info.iframes as unknown[]).push({ src: f.src });
        }
      });
      
      // Mux player - look for various mux elements
      document.querySelectorAll('mux-player, mux-video, [class*="mux"], [data-mux]').forEach(m => {
        (info.muxPlayers as unknown[]).push({
          tag: m.tagName,
          className: m.className,
          attrs: Object.fromEntries(Array.from(m.attributes).map(a => [a.name, a.value.substring(0, 100)])),
        });
      });

      // Look for any element with video-related data attributes
      const videoRelated = document.querySelectorAll('[data-video-id], [data-playback-id], [data-media]');
      videoRelated.forEach(el => {
        (info.allElements as string[]).push(`${el.tagName}: ${Array.from(el.attributes).map(a => `${a.name}=${a.value.substring(0, 50)}`).join(', ')}`);
      });

      return info;
    });

    console.log('\n=== Video Elements ===');
    console.log(JSON.stringify(videoInfo, null, 2));

    // Get the page's __NEXT_DATA__
    const moduleNextData = await page.evaluate(() => {
      const script = document.getElementById('__NEXT_DATA__');
      if (script?.textContent) {
        try { return JSON.parse(script.textContent); } catch { return null; }
      }
      return null;
    });

    if (moduleNextData) {
      await fs.writeFile('.skool-state/module-page-next-data.json', JSON.stringify(moduleNextData, null, 2));
      console.log('\nSaved __NEXT_DATA__ to .skool-state/module-page-next-data.json');
      
      // Look for videos in the data
      const pp = moduleNextData.props?.pageProps;
      if (pp?.videos && pp.videos.length > 0) {
        console.log('\n=== Videos from pageProps ===');
        console.log(JSON.stringify(pp.videos, null, 2));
      }
      if (pp?.currentModule) {
        console.log('\n=== currentModule ===');
        console.log(JSON.stringify(pp.currentModule, null, 2));
      }
    }
  }
  
  // Print captured API responses
  console.log('\n=== Captured API Responses ===');
  for (const resp of capturedResponses) {
    console.log(`  ${resp.url.substring(0, 100)}`);
    if (resp.data) {
      console.log(`    Data keys: ${Object.keys(resp.data).join(', ')}`);
    }
  }

  console.log('\nBrowser staying open for 30 seconds...');
  await page.waitForTimeout(30000);

  await context.close();
  console.log('Done!');
}

main().catch(console.error);
