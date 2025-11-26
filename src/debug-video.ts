#!/usr/bin/env node
/**
 * Debug script - inspect video elements on a course page
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

async function main() {
  // Navigate to the "Day 1" course directly
  const url = `https://www.skool.com/your-community/classroom?md=YOUR_MODULE_ID`;

  console.log(`Opening ${url}...`);

  const userDataDir = path.join('.skool-state', 'browser-profile');
  await fs.mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1400, height: 900 },
  });

  const page = await context.newPage();
  
  // Set up network interception for video URLs
  const capturedUrls: string[] = [];
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('.m3u8') || url.includes('wistia') || url.includes('vimeo') || 
        url.includes('youtube') || url.includes('loom') || url.includes('mux') ||
        url.includes('cloudfront') || url.includes('video') || url.includes('.mp4')) {
      capturedUrls.push(url);
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('\nWaiting 10 seconds for page to fully load and video to appear...\n');
  await page.waitForTimeout(10000);

  console.log('URL:', page.url());

  // Look for video elements
  const videoInfo = await page.evaluate(() => {
    const info: Record<string, unknown[]> = {
      videos: [],
      iframes: [],
      wistia: [],
      scripts: [],
    };

    // Check for video elements
    document.querySelectorAll('video').forEach(v => {
      info.videos.push({
        src: v.src,
        sources: Array.from(v.querySelectorAll('source')).map(s => s.src),
        poster: v.poster,
        classList: v.className,
      });
    });

    // Check for iframes
    document.querySelectorAll('iframe').forEach(f => {
      info.iframes.push({
        src: f.src,
        classList: f.className,
      });
    });

    // Check for Wistia embeds
    document.querySelectorAll('[class*="wistia"]').forEach(w => {
      info.wistia.push({
        className: w.className,
        id: w.id,
        innerHTML: w.innerHTML.substring(0, 200),
      });
    });

    // Look for video-related scripts
    document.querySelectorAll('script').forEach(s => {
      const src = s.src;
      const content = s.textContent || '';
      if (src.includes('wistia') || src.includes('vimeo') || src.includes('youtube') ||
          content.includes('wistia') || content.includes('videoId') || content.includes('player')) {
        info.scripts.push({
          src,
          contentPreview: content.substring(0, 300),
        });
      }
    });

    return info;
  });

  console.log('\n=== Video Elements ===');
  console.log(JSON.stringify(videoInfo.videos, null, 2));

  console.log('\n=== Iframes ===');
  console.log(JSON.stringify(videoInfo.iframes, null, 2));

  console.log('\n=== Wistia Embeds ===');
  console.log(JSON.stringify(videoInfo.wistia, null, 2));

  console.log('\n=== Video Scripts ===');
  console.log(JSON.stringify(videoInfo.scripts, null, 2));

  console.log('\n=== Captured Network URLs ===');
  for (const url of capturedUrls) {
    console.log(`  ${url.substring(0, 150)}`);
  }

  // Try clicking a play button if visible
  console.log('\n\nLooking for play buttons...');
  const playButtons = await page.evaluate(() => {
    const results: string[] = [];
    document.querySelectorAll('button').forEach(b => {
      const text = b.textContent?.toLowerCase() || '';
      const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
      const classes = b.className.toLowerCase();
      if (text.includes('play') || aria.includes('play') || classes.includes('play')) {
        results.push(`${b.tagName}: ${text || aria || classes}`);
      }
    });
    // Also check for div/span with play icons
    document.querySelectorAll('[class*="play"], [aria-label*="play"]').forEach(el => {
      results.push(`${el.tagName}: ${el.className.substring(0, 50)}`);
    });
    return results;
  });

  console.log(`Found ${playButtons.length} play-related elements:`, playButtons);

  // Check __NEXT_DATA__ for video info
  const nextData = await page.evaluate(() => {
    const script = document.getElementById('__NEXT_DATA__');
    if (script?.textContent) {
      try { return JSON.parse(script.textContent); } catch { return null; }
    }
    return null;
  });

  if (nextData) {
    await fs.writeFile('.skool-state/video-page-next-data.json', JSON.stringify(nextData, null, 2));
    console.log('\nSaved __NEXT_DATA__ to .skool-state/video-page-next-data.json');
    
    // Check for videos in pageProps
    const pp = nextData.props?.pageProps;
    if (pp?.videos && pp.videos.length > 0) {
      console.log('\n=== Videos from __NEXT_DATA__ ===');
      console.log(JSON.stringify(pp.videos, null, 2));
    }
    
    // Check currentModule
    if (pp?.currentModule) {
      console.log('\n=== Current Module ===');
      console.log(JSON.stringify(pp.currentModule, null, 2));
    }
  }

  // Look at full page text
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

  console.log('\nBrowser staying open for 30 seconds for manual inspection...');
  await page.waitForTimeout(30000);

  await context.close();
  console.log('Done!');
}

main().catch(console.error);
