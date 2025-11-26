#!/usr/bin/env node
/**
 * Debug script - inspect video loading on a specific module page
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

async function main() {
  // Get URL from command line or use default
  const url = process.argv[2] || 'https://www.skool.com/your-community/classroom/COURSE_ID?md=MODULE_ID';

  console.log(`\nDebugging video capture on: ${url}\n`);

  const userDataDir = path.join('.skool-state', 'browser-profile');
  await fs.mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1400, height: 900 },
  });

  const page = await context.newPage();

  // Capture ALL network requests
  const capturedUrls: string[] = [];
  page.on('response', (response) => {
    const url = response.url();
    // Log video-related URLs
    if (url.includes('.m3u8') || url.includes('mux') || url.includes('stream') ||
        url.includes('video') || url.includes('.mp4') || url.includes('.ts')) {
      console.log(`[NETWORK] ${url.substring(0, 120)}`);
      capturedUrls.push(url);
    }
  });

  // Navigate to page
  console.log('Navigating to page...');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Check what's on the page BEFORE clicking
  console.log('\n=== BEFORE CLICKING ===');
  const beforeInfo = await page.evaluate(() => {
    const info: Record<string, unknown> = {};

    // Check for video elements
    const videos = document.querySelectorAll('video');
    info.videoCount = videos.length;
    info.videos = Array.from(videos).map(v => ({
      src: v.src,
      currentSrc: v.currentSrc,
      className: v.className,
      parentClass: v.parentElement?.className,
    }));

    // Check for video wrappers - expanded search
    const wrappers = document.querySelectorAll('[class*="Video"], [class*="video"], [class*="player"], [class*="Player"], [class*="media"], [class*="Media"]');
    info.wrapperCount = wrappers.length;
    info.wrappers = Array.from(wrappers).slice(0, 10).map(w => ({
      tag: w.tagName,
      className: w.className,
      id: w.id,
    }));

    // Check for iframes
    const iframes = document.querySelectorAll('iframe');
    info.iframeCount = iframes.length;
    info.iframes = Array.from(iframes).map(f => ({
      src: f.src,
    }));

    // Check for play buttons or overlays
    const playButtons = document.querySelectorAll('button[aria-label*="play" i], [class*="play"], [class*="Play"]');
    info.playButtonCount = playButtons.length;
    info.playButtons = Array.from(playButtons).slice(0, 5).map(b => ({
      tag: b.tagName,
      className: b.className,
      ariaLabel: b.getAttribute('aria-label'),
      text: b.textContent?.substring(0, 50),
    }));

    // Check for any clickable elements in the main content area
    const mainContent = document.querySelector('main') || document.querySelector('[class*="content"]') || document.body;
    const clickables = mainContent.querySelectorAll('div[role="button"], button, [onclick], [class*="click"], [class*="thumb"], [class*="Thumb"], [class*="poster"], [class*="Poster"]');
    info.clickableCount = clickables.length;
    info.clickables = Array.from(clickables).slice(0, 10).map(c => ({
      tag: c.tagName,
      className: c.className,
      role: c.getAttribute('role'),
    }));

    // Dump all div classes to find patterns
    const allDivs = document.querySelectorAll('div[class]');
    const classNames = new Set<string>();
    allDivs.forEach(d => {
      d.className.split(' ').forEach(c => {
        if (c.length > 3 && c.length < 50) classNames.add(c);
      });
    });
    info.uniqueClasses = Array.from(classNames).filter(c =>
      c.toLowerCase().includes('video') ||
      c.toLowerCase().includes('player') ||
      c.toLowerCase().includes('media') ||
      c.toLowerCase().includes('embed') ||
      c.toLowerCase().includes('mux') ||
      c.toLowerCase().includes('stream')
    );

    // Get page title and check if module loaded
    info.pageTitle = document.title;
    info.moduleTitle = document.querySelector('h1, h2, [class*="title"], [class*="Title"]')?.textContent?.substring(0, 100);

    return info;
  });

  console.log(JSON.stringify(beforeInfo, null, 2));

  // Try clicking various elements
  console.log('\n=== TRYING TO TRIGGER VIDEO ===');

  const clickSelectors = [
    // Exact matches for what we found on the page
    '.styled__VideoWrapper-sc-c9r8op-2',
    '.styled__VideoPlayerWrapper-sc-bpv3k2-0',
    // Generic patterns
    '[class*="VideoWrapper"]',
    '[class*="video-wrapper"]',
    '[class*="VideoPlayerWrapper"]',
    '[class*="VideoContainer"]',
    '[class*="video-container"]',
    '[class*="Video"]',
    '[class*="player"]',
    '[class*="Player"]',
    'mux-player',
    'video',
    '[class*="play"]',
    '[class*="Play"]',
    'button[aria-label*="play" i]',
  ];

  for (const selector of clickSelectors) {
    try {
      const element = page.locator(selector).first();
      if (await element.isVisible({ timeout: 500 }).catch(() => false)) {
        const box = await element.boundingBox();
        console.log(`Found ${selector} at ${box?.x},${box?.y} (${box?.width}x${box?.height})`);

        console.log(`  Clicking ${selector}...`);
        await element.click({ timeout: 2000 });
        await page.waitForTimeout(3000);

        // Check if video appeared
        const hasVideo = await page.locator('video').first().isVisible({ timeout: 1000 }).catch(() => false);
        console.log(`  Video visible after click: ${hasVideo}`);

        if (hasVideo) {
          break;
        }
      }
    } catch (e) {
      // Continue
    }
  }

  // Check what's on the page AFTER clicking
  console.log('\n=== AFTER CLICKING ===');
  const afterInfo = await page.evaluate(() => {
    const info: Record<string, unknown> = {};

    const videos = document.querySelectorAll('video');
    info.videoCount = videos.length;
    info.videos = Array.from(videos).map(v => ({
      src: v.src,
      currentSrc: v.currentSrc,
      className: v.className,
      readyState: v.readyState,
      paused: v.paused,
    }));

    return info;
  });

  console.log(JSON.stringify(afterInfo, null, 2));

  // Print captured URLs
  console.log('\n=== CAPTURED VIDEO URLS ===');
  if (capturedUrls.length === 0) {
    console.log('No video URLs captured!');
  } else {
    for (const url of capturedUrls) {
      console.log(`  ${url}`);
    }
  }

  // Wait and watch for more network activity
  console.log('\n=== Waiting 10 more seconds for network activity... ===');
  await page.waitForTimeout(10000);

  if (capturedUrls.length > 0) {
    console.log('\nFinal captured URLs:');
    for (const url of capturedUrls) {
      console.log(`  ${url}`);
    }
  }

  console.log('\nBrowser staying open for 30 seconds for manual inspection...');
  await page.waitForTimeout(30000);

  await context.close();
  console.log('Done!');
}

main().catch(console.error);
