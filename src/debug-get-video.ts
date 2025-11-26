#!/usr/bin/env node
/**
 * Debug - navigate to a module page and find video
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
  const capturedUrls: string[] = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('.m3u8') || url.includes('mux') || url.includes('stream') ||
        url.includes('video') || url.includes('playback') || url.includes('wistia') ||
        url.includes('vimeo') || url.includes('cloudfront')) {
      capturedUrls.push(url);
    }
  });

  // Navigate directly to a module within a course
  const moduleUrl = 'https://www.skool.com/your-community/classroom/COURSE_ID?md=MODULE_ID';
  console.log(`Navigating to module: ${moduleUrl}`);
  
  await page.goto(moduleUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);  // Wait for video to load

  console.log('Current URL:', page.url());

  // Check for video elements
  const videoInfo = await page.evaluate(() => {
    const info: Record<string, unknown[]> = {
      videos: [],
      iframes: [],
      muxPlayers: [],
      allVideoRelated: [],
    };

    // Videos
    document.querySelectorAll('video').forEach(v => {
      (info.videos as unknown[]).push({
        src: v.src,
        sources: Array.from(v.querySelectorAll('source')).map(s => s.src),
        poster: v.poster,
        currentSrc: v.currentSrc,
        id: v.id,
        className: v.className,
      });
    });

    // Iframes (excluding Stripe)
    document.querySelectorAll('iframe').forEach(f => {
      if (!f.src.includes('stripe')) {
        (info.iframes as unknown[]).push({ 
          src: f.src,
          className: f.className,
        });
      }
    });
    
    // Mux player elements
    document.querySelectorAll('mux-player, mux-video, [class*="mux"], [data-playback-id]').forEach(m => {
      (info.muxPlayers as unknown[]).push({
        tag: m.tagName,
        className: m.className,
        playbackId: m.getAttribute('data-playback-id') || m.getAttribute('playback-id'),
        attrs: Object.fromEntries(Array.from(m.attributes).map(a => [a.name, a.value.substring(0, 100)])),
      });
    });

    // Any elements with video-related attributes
    document.querySelectorAll('[data-video], [data-video-url], [data-media-url]').forEach(el => {
      (info.allVideoRelated as unknown[]).push({
        tag: el.tagName,
        attrs: Object.fromEntries(Array.from(el.attributes).map(a => [a.name, a.value.substring(0, 100)])),
      });
    });

    return info;
  });

  console.log('\n=== Video Elements ===');
  console.log('Videos:', JSON.stringify(videoInfo.videos, null, 2));
  console.log('Iframes:', JSON.stringify(videoInfo.iframes, null, 2));
  console.log('Mux Players:', JSON.stringify(videoInfo.muxPlayers, null, 2));
  console.log('All video related:', JSON.stringify(videoInfo.allVideoRelated, null, 2));

  // Get __NEXT_DATA__
  const nextData = await page.evaluate(() => {
    const script = document.getElementById('__NEXT_DATA__');
    if (script?.textContent) {
      try { return JSON.parse(script.textContent); } catch { return null; }
    }
    return null;
  });

  if (nextData) {
    await fs.writeFile('.skool-state/module-video-next-data.json', JSON.stringify(nextData, null, 2));
    console.log('\nSaved __NEXT_DATA__ to .skool-state/module-video-next-data.json');
    
    // Look for videos in the data
    const pp = nextData.props?.pageProps;
    console.log('\n=== pageProps.videos ===');
    console.log(JSON.stringify(pp?.videos, null, 2));
    
    console.log('\n=== pageProps.currentModule ===');
    console.log(JSON.stringify(pp?.currentModule, null, 2));
  }

  // Print captured network URLs
  console.log('\n=== Captured Video Network URLs ===');
  for (const url of capturedUrls) {
    console.log(`  ${url.substring(0, 150)}`);
  }

  // Get page text to see what content is shown
  const pageText = await page.evaluate(() => {
    return document.body.innerText.split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 3 && s.length < 100)
      .slice(0, 25);
  });

  console.log('\n=== Page Text ===');
  for (const line of pageText) {
    console.log(`  ${line}`);
  }

  console.log('\nBrowser staying open for 30 seconds...');
  await page.waitForTimeout(30000);

  await context.close();
  console.log('Done!');
}

main().catch(console.error);
