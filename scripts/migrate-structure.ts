#!/usr/bin/env npx tsx

/**
 * Migration script to reorganize existing downloads into the new structure.
 *
 * Old structure: downloads/Course/01_Section/01_Lesson.mp4
 * New structure: downloads/Course/01_Section/01_Lesson/video.mp4
 *
 * This script moves video files into their own directories without re-downloading.
 */

import fs from 'fs/promises';
import path from 'path';

const DOWNLOADS_DIR = './downloads';
const DRY_RUN = process.argv.includes('--dry-run');

interface MigrationAction {
  type: 'move';
  from: string;
  to: string;
}

async function findVideoFiles(dir: string): Promise<string[]> {
  const videos: string[] = [];

  async function walk(currentDir: string) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.mp4', '.mkv', '.webm', '.mov'].includes(ext)) {
          videos.push(fullPath);
        }
      }
    }
  }

  await walk(dir);
  return videos;
}

async function planMigration(videos: string[]): Promise<MigrationAction[]> {
  const actions: MigrationAction[] = [];

  for (const videoPath of videos) {
    const dir = path.dirname(videoPath);
    const filename = path.basename(videoPath);
    const ext = path.extname(filename);
    const basename = path.basename(filename, ext);

    // Check if already in new structure (video is inside a folder named after the lesson)
    // New structure: .../01_Lesson/video.mp4
    // Old structure: .../01_Section/01_Lesson.mp4
    if (filename === 'video.mp4' || filename === 'video.mkv' || filename === 'video.webm') {
      // Already migrated
      continue;
    }

    // Create new directory path based on the video filename (without extension)
    const newDir = path.join(dir, basename);
    const newPath = path.join(newDir, `video${ext}`);

    actions.push({
      type: 'move',
      from: videoPath,
      to: newPath,
    });

    // Also check for subtitle files with the same base name
    const subtitleExts = ['.srt', '.vtt', '.en.srt', '.en.vtt'];
    for (const subExt of subtitleExts) {
      const subPath = path.join(dir, basename + subExt);
      try {
        await fs.access(subPath);
        actions.push({
          type: 'move',
          from: subPath,
          to: path.join(newDir, `video${subExt}`),
        });
      } catch {
        // Subtitle file doesn't exist, skip
      }
    }
  }

  return actions;
}

async function executeMigration(actions: MigrationAction[]): Promise<void> {
  for (const action of actions) {
    if (action.type === 'move') {
      const newDir = path.dirname(action.to);

      if (DRY_RUN) {
        console.log(`[DRY RUN] Would move:`);
        console.log(`  From: ${action.from}`);
        console.log(`  To:   ${action.to}`);
        console.log('');
      } else {
        // Create directory
        await fs.mkdir(newDir, { recursive: true });

        // Move file
        await fs.rename(action.from, action.to);
        console.log(`Moved: ${path.basename(action.from)} -> ${action.to}`);
      }
    }
  }
}

async function main() {
  console.log('=== Skool Downloads Migration Script ===\n');

  if (DRY_RUN) {
    console.log('Running in DRY RUN mode - no files will be moved.\n');
  }

  // Check if downloads directory exists
  try {
    await fs.access(DOWNLOADS_DIR);
  } catch {
    console.error(`Downloads directory not found: ${DOWNLOADS_DIR}`);
    process.exit(1);
  }

  // Find all video files
  console.log('Scanning for video files...');
  const videos = await findVideoFiles(DOWNLOADS_DIR);
  console.log(`Found ${videos.length} video files.\n`);

  if (videos.length === 0) {
    console.log('No videos to migrate.');
    return;
  }

  // Plan migration
  console.log('Planning migration...');
  const actions = await planMigration(videos);

  if (actions.length === 0) {
    console.log('All videos already in new structure. Nothing to migrate.');
    return;
  }

  console.log(`${actions.length} files to migrate.\n`);

  // Execute migration
  await executeMigration(actions);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Run without --dry-run to actually move files.');
  } else {
    console.log(`\nMigration complete! ${actions.length} files moved.`);
  }
}

main().catch(console.error);
