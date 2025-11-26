#!/usr/bin/env node
/**
 * Debug script to inspect Skool's DOM structure
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

async function main() {
  const url = process.argv[2] || 'https://www.skool.com/your-community/classroom';

  console.log(`Opening ${url}...`);

  const userDataDir = path.join('.skool-state', 'browser-profile');
  await fs.mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1400, height: 900 },
  });

  const page = await context.newPage();

  // Navigate and wait for network to settle
  await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });

  console.log('\nWaiting 10 seconds for page to fully load...\n');
  await page.waitForTimeout(10000);

  console.log('=== Inspecting Skool DOM Structure ===\n');
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
    await fs.writeFile('.skool-state/next-data.json', JSON.stringify(nextData, null, 2));
    console.log('Full __NEXT_DATA__ saved to .skool-state/next-data.json');

    // Try to find classroom/course data
    const props = nextData.props?.pageProps;
    if (props) {
      console.log('\nPageProps keys:', Object.keys(props));

      // Look for course-related data
      for (const key of Object.keys(props)) {
        const value = props[key];
        if (value && typeof value === 'object') {
          if (Array.isArray(value) && value.length > 0) {
            console.log(`  ${key}: Array[${value.length}]`);
            if (value[0] && typeof value[0] === 'object') {
              console.log(`    First item keys: ${Object.keys(value[0]).join(', ')}`);
            }
          } else if (!Array.isArray(value)) {
            console.log(`  ${key}: Object with keys: ${Object.keys(value).slice(0, 10).join(', ')}`);
          }
        }
      }
    }
  } else {
    console.log('\n__NEXT_DATA__ not found or empty');
  }

  // Look for any elements that could be course content
  const courseElements = await page.evaluate(() => {
    const results: string[] = [];

    // Look for any text content that might be lesson titles
    const allText = document.body.innerText;
    const lines = allText.split('\n').filter(l => l.trim().length > 3 && l.trim().length < 100);

    // Find unique lines that might be course content
    const uniqueLines = [...new Set(lines)].slice(0, 50);

    return uniqueLines;
  });

  console.log('\n=== Page Text Content (first 30 lines) ===');
  for (const line of courseElements.slice(0, 30)) {
    console.log(`  ${line}`);
  }

  // Try to find clickable course items by looking at the rendered content
  const clickableItems = await page.evaluate(() => {
    const items: Array<{text: string, tag: string, classes: string}> = [];

    // Look for divs/spans that might be clickable course items
    const allElements = document.querySelectorAll('div, span, a, button');

    for (const el of allElements) {
      const text = el.textContent?.trim();
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent?.trim())
        .join('');

      // Only include elements with direct text content (not nested)
      if (directText && directText.length > 5 && directText.length < 80) {
        const classes = el.className.toString();
        // Look for classes that suggest course/lesson items
        if (classes.includes('title') || classes.includes('name') ||
            classes.includes('lesson') || classes.includes('module') ||
            classes.includes('course') || classes.includes('item')) {
          items.push({
            text: directText,
            tag: el.tagName,
            classes: classes.substring(0, 100),
          });
        }
      }
    }

    // Dedupe
    const seen = new Set();
    return items.filter(item => {
      if (seen.has(item.text)) return false;
      seen.add(item.text);
      return true;
    });
  });

  console.log(`\n=== Elements with course-related classes (${clickableItems.length} found) ===`);
  for (const item of clickableItems.slice(0, 20)) {
    console.log(`  [${item.tag}] "${item.text}"`);
    console.log(`    classes: ${item.classes}`);
  }

  // Save the full HTML for manual inspection
  const fullHtml = await page.content();
  await fs.writeFile('.skool-state/full-page.html', fullHtml);
  console.log('\nFull page HTML saved to .skool-state/full-page.html');

  // Keep browser open briefly
  console.log('\nBrowser closing in 10 seconds...');
  await page.waitForTimeout(10000);

  await context.close();
  console.log('Done!');
}

main().catch(console.error);
