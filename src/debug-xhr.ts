#!/usr/bin/env node
/**
 * Debug script - capture ALL XHR/Fetch requests including RSC
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

async function main() {
  const courseId = '5e585832b4e0457e9d0d524bbcecc744'; // Day 1 course
  const url = `https://www.skool.com/your-community/classroom?md=${courseId}`;

  console.log(`Opening ${url}...`);

  const userDataDir = path.join('.skool-state', 'browser-profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1400, height: 900 },
  });

  const page = await context.newPage();

  const allRequests: Array<{url: string, method: string, type: string, status?: number}> = [];
  
  page.on('request', req => {
    allRequests.push({
      url: req.url(),
      method: req.method(),
      type: req.resourceType()
    });
  });

  page.on('response', async resp => {
    const existing = allRequests.find(r => r.url === resp.url());
    if (existing) {
      existing.status = resp.status();
    }
  });

  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(8000);

  // Filter to interesting requests
  const interesting = allRequests.filter(r => 
    r.type === 'fetch' || 
    r.type === 'xhr' || 
    r.url.includes('api') ||
    r.url.includes('graphql') ||
    r.url.includes('_rsc') ||
    r.url.includes('_next/data')
  );

  console.log(`\n\nInteresting requests (${interesting.length}):`);
  for (const req of interesting) {
    console.log(`  [${req.type}] ${req.method} ${req.url.substring(0, 120)}`);
  }

  // Let's also check if data is in __NEXT_DATA__ under a different key
  const pageData = await page.evaluate(() => {
    const script = document.getElementById('__NEXT_DATA__');
    if (!script?.textContent) return null;
    
    try {
      const data = JSON.parse(script.textContent);
      // Get all keys and their types
      const analyze = (obj: any, prefix = ''): string[] => {
        const results: string[] = [];
        if (typeof obj === 'object' && obj !== null) {
          for (const [key, value] of Object.entries(obj)) {
            const path = prefix ? `${prefix}.${key}` : key;
            if (Array.isArray(value)) {
              results.push(`${path}: Array[${value.length}]`);
            } else if (typeof value === 'object' && value !== null) {
              results.push(`${path}: Object`);
              results.push(...analyze(value, path));
            } else {
              results.push(`${path}: ${typeof value}`);
            }
          }
        }
        return results;
      };
      
      return analyze(data.props?.pageProps || {}).slice(0, 100);
    } catch {
      return null;
    }
  });

  console.log('\n\nPageProps structure:');
  for (const line of (pageData || []).slice(0, 50)) {
    console.log(`  ${line}`);
  }

  await page.waitForTimeout(3000);
  await context.close();
}

main().catch(console.error);
