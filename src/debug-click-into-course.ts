#!/usr/bin/env node
/**
 * Debug script - click into a course to explore modules
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

async function main() {
  const url = `https://www.skool.com/your-community/classroom`;

  console.log(`Opening ${url}...`);

  const userDataDir = path.join('.skool-state', 'browser-profile');
  await fs.mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1400, height: 900 },
  });

  const page = await context.newPage();
  
  // Set up network interception
  const capturedUrls: string[] = [];
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('api') || url.includes('.m3u8') || url.includes('video') || 
        url.includes('mux') || url.includes('wistia') || url.includes('vimeo')) {
      capturedUrls.push(url);
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  console.log('\nLooking for course cards to click...');
  
  // Find course cards - they should have role="button" and contain course titles
  const courseCards = await page.locator('[role="button"]').all();
  console.log(`Found ${courseCards.length} button elements`);

  // Click the first course (Day 1)
  if (courseCards.length > 0) {
    const firstCard = courseCards[0];
    const text = await firstCard.textContent();
    console.log(`\nClicking: "${text?.substring(0, 50)}..."`);
    await firstCard.click();
    await page.waitForTimeout(3000);
    
    console.log('URL after first click:', page.url());
    
    // Now look for module links with "md=" in the expanded sidebar
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

    console.log(`\nModule links found after expanding course (${moduleLinks.length}):`);
    for (const link of moduleLinks.slice(0, 30)) {
      console.log(`  ${link.text}`);
      console.log(`    -> ${link.href}`);
    }

    // If we found module links, click on the first one
    if (moduleLinks.length > 0) {
      console.log(`\n\nNavigating to first module: ${moduleLinks[0].text}`);
      await page.goto(moduleLinks[0].href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000);
      
      console.log('URL after module navigation:', page.url());
      
      // Check for video elements
      const videoInfo = await page.evaluate(() => {
        const info: Record<string, unknown[]> = {
          videos: [],
          iframes: [],
          wistia: [],
          mux: [],
        };

        // Videos
        document.querySelectorAll('video').forEach(v => {
          info.videos.push({
            src: v.src,
            sources: Array.from(v.querySelectorAll('source')).map(s => s.src),
            poster: v.poster,
          });
        });

        // Iframes
        document.querySelectorAll('iframe').forEach(f => {
          if (!f.src.includes('stripe')) {
            info.iframes.push({ src: f.src });
          }
        });

        // Wistia
        document.querySelectorAll('[class*="wistia"]').forEach(w => {
          info.wistia.push({
            className: w.className,
            id: w.id,
          });
        });
        
        // Mux player
        document.querySelectorAll('mux-player, [class*="mux"]').forEach(m => {
          info.mux.push({
            tag: m.tagName,
            className: m.className,
            attrs: Array.from(m.attributes).map(a => `${a.name}=${a.value.substring(0, 50)}`),
          });
        });

        return info;
      });

      console.log('\n=== Video Elements ===');
      console.log(JSON.stringify(videoInfo, null, 2));
      
      // Save __NEXT_DATA__ from module page
      const nextData = await page.evaluate(() => {
        const script = document.getElementById('__NEXT_DATA__');
        if (script?.textContent) {
          try { return JSON.parse(script.textContent); } catch { return null; }
        }
        return null;
      });

      if (nextData) {
        await fs.writeFile('.skool-state/module-next-data.json', JSON.stringify(nextData, null, 2));
        console.log('\nSaved __NEXT_DATA__ to .skool-state/module-next-data.json');
        
        // Check for video info in pageProps
        const pp = nextData.props?.pageProps;
        if (pp?.videos) {
          console.log('\n=== Videos from __NEXT_DATA__ ===');
          console.log(JSON.stringify(pp.videos, null, 2));
        }
        if (pp?.currentModule) {
          console.log('\n=== Current Module from __NEXT_DATA__ ===');
          console.log(JSON.stringify(pp.currentModule, null, 2));
        }
      }
      
      // Get page text
      const pageText = await page.evaluate(() => {
        return document.body.innerText.split('\n')
          .map(s => s.trim())
          .filter(s => s.length > 3 && s.length < 100)
          .slice(0, 30);
      });

      console.log('\n=== Page Text ===');
      for (const line of pageText) {
        console.log(`  ${line}`);
      }
    }
  }
  
  console.log('\n=== Captured Network URLs ===');
  for (const url of capturedUrls.slice(0, 30)) {
    console.log(`  ${url.substring(0, 120)}`);
  }

  console.log('\nBrowser staying open for 30 seconds...');
  await page.waitForTimeout(30000);

  await context.close();
  console.log('Done!');
}

main().catch(console.error);
