import PQueue from 'p-queue';
import { logger } from '../utils/logger.js';
import { downloadVideo, DownloadOptions, DownloadResult } from './yt-dlp-wrapper.js';
import { ProgressTracker, LessonState } from '../state/progress-tracker.js';
import { ensureDir } from '../utils/file-utils.js';
import path from 'path';

export interface QueuedDownload {
  lesson: LessonState;
  downloadUrl: string;
  outputPath: string;
  cookiesFile?: string;
  referer?: string;
  downloadSubs: boolean;
  subsLang: string;
}

export class DownloadQueue {
  private queue: PQueue;
  private tracker: ProgressTracker;
  private completed: number = 0;
  private failed: number = 0;
  private total: number = 0;

  constructor(tracker: ProgressTracker, concurrency: number = 2) {
    this.queue = new PQueue({ concurrency });
    this.tracker = tracker;
  }

  async add(download: QueuedDownload): Promise<void> {
    this.total++;

    this.queue.add(async () => {
      await this.processDownload(download);
    });
  }

  private async processDownload(download: QueuedDownload): Promise<void> {
    const { lesson, downloadUrl, outputPath } = download;

    logger.startSpinner(
      `[${this.completed + this.failed + 1}/${this.total}] Downloading: ${lesson.lessonTitle}`
    );

    // Mark as started
    this.tracker.markStarted(lesson.id);

    // Ensure output directory exists
    await ensureDir(path.dirname(outputPath));

    const options: DownloadOptions = {
      url: downloadUrl,
      outputPath,
      provider: (lesson.videoProvider as DownloadOptions['provider']) || 'unknown',
      cookiesFile: download.cookiesFile,
      downloadSubs: download.downloadSubs,
      subsLang: download.subsLang,
      referer: download.referer,
    };

    const result = await downloadVideo(options, (percent) => {
      logger.updateSpinner(
        `[${this.completed + this.failed + 1}/${this.total}] ${lesson.lessonTitle} - ${percent.toFixed(1)}%`
      );
    });

    if (result.success) {
      this.tracker.markCompleted(lesson.id, result.outputFile || outputPath);
      this.completed++;
      logger.succeedSpinner(
        `[${this.completed + this.failed}/${this.total}] Completed: ${lesson.lessonTitle}`
      );
    } else {
      this.tracker.markFailed(lesson.id, result.error || 'Unknown error');
      this.failed++;
      logger.failSpinner(
        `[${this.completed + this.failed}/${this.total}] Failed: ${lesson.lessonTitle} - ${result.error}`
      );
    }
  }

  async waitForAll(): Promise<void> {
    await this.queue.onIdle();
  }

  getStats(): { completed: number; failed: number; total: number } {
    return {
      completed: this.completed,
      failed: this.failed,
      total: this.total,
    };
  }

  pause(): void {
    this.queue.pause();
  }

  resume(): void {
    this.queue.start();
  }

  clear(): void {
    this.queue.clear();
  }
}
