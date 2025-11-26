import { Command } from 'commander';
import chalk from 'chalk';
import { getConfig, Config } from './config.js';
import { logger } from './utils/logger.js';
import { initBrowser, ensureAuthenticated, exportNetscapeCookies } from './auth/browser-auth.js';
import { crawlCourseStructure, extractModuleVideo, extractSlug, modulesToLessons, Module } from './crawler/course-crawler.js';
import { extractModuleContent } from './crawler/content-extractor.js';
import { ProgressTracker } from './state/progress-tracker.js';
import { DownloadQueue } from './downloader/download-queue.js';
import { downloadModuleResources, saveModuleContent } from './downloader/resource-downloader.js';
import { checkYtDlp, getYtDlpVersion } from './downloader/yt-dlp-wrapper.js';
import { generateOutputPath, ensureDir } from './utils/file-utils.js';
import path from 'path';

const program = new Command();

program
  .name('skool-dl')
  .description('Bulk download videos from Skool.com membership sites')
  .version('1.0.0');

// Download command
program
  .command('download')
  .description('Download all videos and content from a Skool classroom')
  .argument('<url>', 'Skool community URL (e.g., https://www.skool.com/community-name)')
  .option('-o, --output <dir>', 'Output directory', './downloads')
  .option('-c, --concurrency <n>', 'Concurrent downloads', '2')
  .option('-m, --module <name>', 'Download specific module only')
  .option('--no-subs', 'Skip subtitle download')
  .option('--no-content', 'Skip text content and resource download')
  .option('--content-only', 'Only download text content and resources (no videos)')
  .option('--dry-run', 'List videos without downloading')
  .action(async (url: string, options) => {
    await downloadCommand(url, options);
  });

// Login command
program
  .command('login')
  .description('Open browser to log in to Skool')
  .argument('[url]', 'Skool URL to log in to', 'https://www.skool.com')
  .action(async (url: string) => {
    await loginCommand(url);
  });

// Status command
program
  .command('status')
  .description('Show download progress for a course')
  .argument('<url>', 'Skool community URL')
  .action(async (url: string) => {
    await statusCommand(url);
  });

// Resume command
program
  .command('resume')
  .description('Resume interrupted download')
  .argument('<url>', 'Skool community URL')
  .option('-o, --output <dir>', 'Output directory', './downloads')
  .option('-c, --concurrency <n>', 'Concurrent downloads', '2')
  .action(async (url: string, options) => {
    await resumeCommand(url, options);
  });

async function downloadCommand(
  url: string,
  options: {
    output: string;
    concurrency: string;
    module?: string;
    subs: boolean;
    content: boolean;
    contentOnly: boolean;
    dryRun: boolean;
  }
): Promise<void> {
  const config = getConfig({
    downloadDir: options.output,
    concurrency: parseInt(options.concurrency, 10),
    downloadSubs: options.subs,
  });

  const downloadContent = options.content !== false;
  const contentOnly = options.contentOnly === true;

  // Check prerequisites (yt-dlp only needed for videos)
  if (!contentOnly && !(await checkYtDlp())) {
    logger.error('yt-dlp not found. Please install it: brew install yt-dlp');
    process.exit(1);
  }

  if (!contentOnly) {
    const ytdlpVersion = await getYtDlpVersion();
    logger.info(`Using yt-dlp ${ytdlpVersion}`);
  }

  if (contentOnly) {
    logger.info('Content-only mode: downloading text and resources (no videos)');
  } else if (downloadContent) {
    logger.info('Downloading videos, text content, and resources');
  }

  // Ensure classroom URL
  const classroomUrl = url.includes('/classroom')
    ? url
    : `${url.replace(/\/$/, '')}/classroom`;

  const slug = extractSlug(url);

  // Initialize progress tracker
  const tracker = new ProgressTracker(config.stateDir, slug);
  await tracker.load();

  // Initialize browser
  const browser = await initBrowser(config);

  try {
    // Ensure logged in
    await ensureAuthenticated(browser.page, classroomUrl);

    // Export cookies for yt-dlp
    const cookiesFile = path.join(config.stateDir, 'cookies.txt');
    await exportNetscapeCookies(browser.context, cookiesFile);

    // Crawl course structure
    const course = await crawlCourseStructure(browser.page, classroomUrl);

    // Initialize tracker with course info
    tracker.initialize(classroomUrl, course.name);

    // Filter by course if specified
    let modules = course.modules;
    if (options.module) {
      // Filter to modules matching the course/module name
      modules = modules.filter((m) =>
        m.title.toLowerCase().includes(options.module!.toLowerCase()) ||
        m.courseTitle.toLowerCase().includes(options.module!.toLowerCase())
      );
      if (modules.length === 0) {
        logger.error(`No modules found matching "${options.module}"`);
        return;
      }
      logger.info(`Filtered to ${modules.length} modules matching "${options.module}"`);
    }

    // Group modules by course for display
    const courseGroups = new Map<string, Module[]>();
    for (const mod of modules) {
      const existing = courseGroups.get(mod.courseTitle) || [];
      existing.push(mod);
      courseGroups.set(mod.courseTitle, existing);
    }

    logger.info(`\nCourse: ${chalk.bold(course.name)}`);
    logger.info(`Courses: ${course.courses.length}, Modules: ${modules.length}\n`);

    // Dry run - just list videos
    if (options.dryRun) {
      for (const [courseTitle, mods] of courseGroups) {
        console.log(chalk.cyan(`\n${courseTitle}:`));
        for (const mod of mods) {
          console.log(`  ${mod.index + 1}. ${mod.title}`);
        }
      }
      console.log(chalk.gray('\n(Dry run - no files downloaded)'));
      return;
    }

    // Add all modules to tracker
    for (const mod of modules) {
      tracker.addLesson({
        id: mod.id,
        moduleIndex: mod.index,
        lessonIndex: mod.index,
        moduleTitle: mod.courseTitle,
        lessonTitle: mod.title,
      });
    }
    await tracker.save();

    // Create download queue (only if downloading videos)
    const queue = contentOnly ? null : new DownloadQueue(tracker, config.concurrency);

    // Track content download stats
    let contentFilesDownloaded = 0;
    let resourcesDownloaded = 0;
    let resourcesSkipped = 0;

    // Process each module
    let processedCount = 0;
    const totalModules = modules.length;

    for (const mod of modules) {
      processedCount++;
      logger.startSpinner(
        `[${processedCount}/${totalModules}] Processing: ${mod.title}`
      );

      // Generate output directory for this module
      const courseIndex = course.courses.findIndex(c => c.id === mod.courseId);
      const outputPath = generateOutputPath(
        config.downloadDir,
        course.name,
        courseIndex >= 0 ? courseIndex : 0,
        mod.courseTitle,
        mod.index,
        mod.title
      );
      // Each lesson gets its own directory (outputPath is the base filename, so add a folder)
      const moduleDir = outputPath;

      // Check if video already completed (only relevant if downloading videos)
      const existing = tracker.getLesson(mod.id);
      if (!contentOnly && existing?.status === 'completed') {
        logger.succeedSpinner(
          `[${processedCount}/${totalModules}] Already downloaded: ${mod.title}`
        );
        continue;
      }

      // Navigate to module page (needed for both video and content extraction)
      await browser.page.goto(mod.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await browser.page.waitForTimeout(config.delayBetweenPages);

      // Extract video info (if not content-only)
      let videoInfo = null;
      if (!contentOnly) {
        videoInfo = await extractModuleVideo(
          browser.page,
          mod,
          0 // Already waited above
        );

        // Update lesson with video info
        tracker.updateLesson(mod.id, {
          videoUrl: videoInfo.downloadUrl || undefined,
          videoProvider: videoInfo.provider,
        });
      }

      // Extract module content (if enabled)
      if (downloadContent || contentOnly) {
        logger.updateSpinner(
          `[${processedCount}/${totalModules}] Extracting content: ${mod.title}`
        );

        try {
          const moduleContent = await extractModuleContent(browser.page);

          // Download resources
          if (moduleContent.embeddedLinks.length > 0 || moduleContent.resources.length > 0) {
            logger.updateSpinner(
              `[${processedCount}/${totalModules}] Downloading resources: ${mod.title}`
            );

            const resourceResults = await downloadModuleResources(moduleContent, moduleDir);

            // Count results
            for (const result of resourceResults) {
              if (result.success) {
                resourcesDownloaded++;
              } else if (result.skipped) {
                resourcesSkipped++;
              }
            }

            // Save content markdown file
            await saveModuleContent(moduleContent, mod.title, moduleDir, resourceResults);
            contentFilesDownloaded++;
          } else if (moduleContent.description || moduleContent.markdownContent) {
            // Save content even without resources
            await saveModuleContent(moduleContent, mod.title, moduleDir, []);
            contentFilesDownloaded++;
          }
        } catch (contentError) {
          logger.debug(`Failed to extract content for ${mod.title}: ${contentError}`);
        }
      }

      // Handle video download (if not content-only)
      if (!contentOnly) {
        if (!videoInfo?.downloadUrl) {
          logger.warnSpinner(
            `[${processedCount}/${totalModules}] No video found: ${mod.title}`
          );
          tracker.markSkipped(mod.id, 'No video found');
          continue;
        }

        logger.succeedSpinner(
          `[${processedCount}/${totalModules}] Found ${videoInfo.provider}: ${mod.title}`
        );

        // Add to download queue - video goes inside the lesson directory
        const videoOutputPath = path.join(moduleDir, 'video');
        await queue!.add({
          lesson: tracker.getLesson(mod.id)!,
          downloadUrl: videoInfo.downloadUrl,
          outputPath: videoOutputPath,
          cookiesFile,
          referer: mod.url,
          downloadSubs: config.downloadSubs,
          subsLang: config.subsLang,
        });
      } else {
        logger.succeedSpinner(
          `[${processedCount}/${totalModules}] Content extracted: ${mod.title}`
        );
      }
    }

    // Save progress
    await tracker.save();

    // Wait for all video downloads to complete (if any)
    if (queue) {
      logger.info('\nStarting video downloads...\n');
      await queue.waitForAll();
    }

    // Final stats
    const stats = tracker.getStats();
    console.log('\n' + chalk.bold('Download Complete!'));

    if (!contentOnly) {
      console.log(chalk.cyan('\nVideos:'));
      console.log(chalk.green(`  Completed: ${stats.completed}`));
      if (stats.failed > 0) {
        console.log(chalk.red(`  Failed: ${stats.failed}`));
      }
      if (stats.skipped > 0) {
        console.log(chalk.yellow(`  Skipped: ${stats.skipped}`));
      }
    }

    if (downloadContent || contentOnly) {
      console.log(chalk.cyan('\nContent:'));
      console.log(chalk.green(`  Content files saved: ${contentFilesDownloaded}`));
      console.log(chalk.green(`  Resources downloaded: ${resourcesDownloaded}`));
      if (resourcesSkipped > 0) {
        console.log(chalk.yellow(`  Resources skipped: ${resourcesSkipped} (auth required or external links)`));
      }
    }

    console.log(`\nFiles saved to: ${path.resolve(config.downloadDir)}`);
  } finally {
    await browser.close();
    await tracker.save();
  }
}

async function loginCommand(url: string): Promise<void> {
  const config = getConfig();

  logger.info('Opening browser for Skool login...');

  const browser = await initBrowser(config);

  try {
    await browser.page.goto(url);
    logger.info('\nPlease log in to Skool in the browser window.');
    logger.info('Press Enter here when you are done...');

    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });

    // Export cookies
    const cookiesFile = path.join(config.stateDir, 'cookies.txt');
    await exportNetscapeCookies(browser.context, cookiesFile);

    logger.success('Cookies saved! You can now use the download command.');
  } finally {
    await browser.close();
  }
}

async function statusCommand(url: string): Promise<void> {
  const slug = extractSlug(url);
  const config = getConfig();

  const tracker = new ProgressTracker(config.stateDir, slug);
  const loaded = await tracker.load();

  if (!loaded || !tracker.hasExistingProgress()) {
    logger.info('No download progress found for this course.');
    return;
  }

  const stats = tracker.getStats();
  const state = tracker.getState();

  console.log(chalk.bold(`\nCourse: ${state.courseName}`));
  console.log(`URL: ${state.url}`);
  console.log(`Started: ${new Date(state.startedAt).toLocaleString()}`);
  console.log(`Last updated: ${new Date(state.lastUpdated).toLocaleString()}`);
  console.log('\nProgress:');
  console.log(chalk.green(`  Completed: ${stats.completed}/${stats.total}`));
  console.log(chalk.red(`  Failed: ${stats.failed}`));
  console.log(chalk.yellow(`  Skipped: ${stats.skipped}`));
  console.log(chalk.blue(`  Pending: ${stats.pending}`));

  // Show failed lessons
  const failedLessons = state.lessons.filter((l) => l.status === 'failed');
  if (failedLessons.length > 0) {
    console.log(chalk.red('\nFailed lessons:'));
    for (const lesson of failedLessons) {
      console.log(`  - ${lesson.lessonTitle}: ${lesson.error}`);
    }
  }
}

async function resumeCommand(
  url: string,
  options: { output: string; concurrency: string }
): Promise<void> {
  const slug = extractSlug(url);
  const config = getConfig({
    downloadDir: options.output,
    concurrency: parseInt(options.concurrency, 10),
  });

  const tracker = new ProgressTracker(config.stateDir, slug);
  const loaded = await tracker.load();

  if (!loaded || !tracker.hasExistingProgress()) {
    logger.error('No previous download found. Use the download command to start a new download.');
    return;
  }

  const pending = tracker.getPendingLessons();
  if (pending.length === 0) {
    logger.success('All lessons already downloaded!');
    return;
  }

  logger.info(`Resuming download: ${pending.length} lessons remaining`);

  // Check prerequisites
  if (!(await checkYtDlp())) {
    logger.error('yt-dlp not found. Please install it: brew install yt-dlp');
    process.exit(1);
  }

  // Initialize browser
  const browser = await initBrowser(config);

  try {
    // Ensure logged in
    const classroomUrl = tracker.getState().url;
    await ensureAuthenticated(browser.page, classroomUrl);

    // Export cookies
    const cookiesFile = path.join(config.stateDir, 'cookies.txt');
    await exportNetscapeCookies(browser.context, cookiesFile);

    // Create download queue
    const queue = new DownloadQueue(tracker, config.concurrency);

    // Process pending lessons
    for (const lesson of pending) {
      // If no video URL, need to re-extract
      if (!lesson.videoUrl) {
        logger.startSpinner(`Re-extracting: ${lesson.lessonTitle}`);

        // We need to navigate and extract again
        // This is simplified - in full implementation, we'd store the lesson URL
        logger.warnSpinner(`Skipping (needs re-crawl): ${lesson.lessonTitle}`);
        continue;
      }

      const outputPath = generateOutputPath(
        config.downloadDir,
        tracker.getCourseName(),
        lesson.moduleIndex,
        lesson.moduleTitle,
        lesson.lessonIndex,
        lesson.lessonTitle
      );

      await queue.add({
        lesson,
        downloadUrl: lesson.videoUrl,
        outputPath,
        cookiesFile,
        downloadSubs: config.downloadSubs,
        subsLang: config.subsLang,
      });
    }

    // Wait for downloads
    await queue.waitForAll();

    // Final stats
    const stats = tracker.getStats();
    console.log(chalk.bold('\nResume Complete!'));
    console.log(chalk.green(`  Completed: ${stats.completed}`));
    if (stats.failed > 0) {
      console.log(chalk.red(`  Failed: ${stats.failed}`));
    }
  } finally {
    await browser.close();
    await tracker.save();
  }
}

export { program };
