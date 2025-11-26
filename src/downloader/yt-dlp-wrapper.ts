import { execa, ExecaError } from 'execa';
import path from 'path';
import { logger } from '../utils/logger.js';
import { VideoProvider } from '../crawler/video-extractor.js';

export interface DownloadOptions {
  url: string;
  outputPath: string; // Path without extension
  provider: VideoProvider;
  cookiesFile?: string;
  downloadSubs: boolean;
  subsLang: string;
  referer?: string;
}

export interface DownloadResult {
  success: boolean;
  outputFile?: string;
  error?: string;
}

/**
 * Build yt-dlp arguments based on provider and options
 */
function buildArgs(options: DownloadOptions): string[] {
  const args: string[] = [];

  // Output template - yt-dlp will add extension
  args.push('-o', `${options.outputPath}.%(ext)s`);

  // Best quality
  args.push('-f', 'bestvideo+bestaudio/best');

  // Merge to mp4 when possible
  args.push('--merge-output-format', 'mp4');

  // Don't download playlists
  args.push('--no-playlist');

  // Subtitles
  if (options.downloadSubs) {
    args.push('--write-subs');
    args.push('--sub-langs', options.subsLang);
    args.push('--embed-subs');
  }

  // Provider-specific options
  switch (options.provider) {
    case 'wistia':
      // Wistia often needs cookies for private videos
      if (options.cookiesFile) {
        args.push('--cookies', options.cookiesFile);
      }
      args.push('--referer', options.referer || 'https://www.skool.com/');
      break;

    case 'vimeo':
      // Vimeo private videos need cookies and referer
      if (options.cookiesFile) {
        args.push('--cookies', options.cookiesFile);
      }
      if (options.referer) {
        args.push('--referer', options.referer);
      }
      break;

    case 'youtube':
      // YouTube generally works without special options
      // But cookies help with age-restricted content
      args.push('--cookies-from-browser', 'chrome');
      break;

    case 'loom':
      // Loom works well with yt-dlp
      if (options.cookiesFile) {
        args.push('--cookies', options.cookiesFile);
      }
      break;

    case 'native':
      // Native Skool videos need auth headers
      if (options.cookiesFile) {
        args.push('--cookies', options.cookiesFile);
      }
      args.push('--referer', 'https://www.skool.com/');
      args.push(
        '--add-header',
        'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      );
      break;

    default:
      // Unknown provider - try with cookies
      if (options.cookiesFile) {
        args.push('--cookies', options.cookiesFile);
      }
      break;
  }

  // Progress output
  args.push('--progress');
  args.push('--newline');

  // Don't overwite if exists
  args.push('--no-overwrites');

  // Retry on failure
  args.push('--retries', '3');
  args.push('--fragment-retries', '3');

  // The URL to download
  args.push(options.url);

  return args;
}

/**
 * Download a video using yt-dlp
 */
export async function downloadVideo(
  options: DownloadOptions,
  onProgress?: (percent: number) => void
): Promise<DownloadResult> {
  const args = buildArgs(options);

  logger.debug(`yt-dlp ${args.join(' ')}`);

  try {
    const process = execa('yt-dlp', args);

    // Parse progress from stdout
    if (process.stdout) {
      process.stdout.on('data', (data: Buffer) => {
        const output = data.toString();

        // Parse download progress
        const progressMatch = output.match(/(\d+\.?\d*)%/);
        if (progressMatch && onProgress) {
          onProgress(parseFloat(progressMatch[1]));
        }
      });
    }

    await process;

    // Find the output file (yt-dlp adds extension)
    const outputFile = await findOutputFile(options.outputPath);

    return {
      success: true,
      outputFile,
    };
  } catch (error) {
    const execaError = error as ExecaError;

    // Check for common errors
    let errorMessage = execaError.message;
    const stderr = String(execaError.stderr || '');

    if (stderr) {
      if (stderr.includes('Video unavailable')) {
        errorMessage = 'Video is unavailable or private';
      } else if (stderr.includes('403')) {
        errorMessage = 'Access denied - may need fresh cookies';
      } else if (stderr.includes('404')) {
        errorMessage = 'Video not found';
      }
    }

    logger.debug(`yt-dlp error: ${stderr || execaError.message}`);

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Find the output file (yt-dlp adds extension)
 */
async function findOutputFile(basePath: string): Promise<string | undefined> {
  const fs = await import('fs/promises');
  const dir = path.dirname(basePath);
  const basename = path.basename(basePath);

  try {
    const files = await fs.readdir(dir);
    const match = files.find((f) => f.startsWith(basename));
    if (match) {
      return path.join(dir, match);
    }
  } catch {
    // Directory might not exist yet
  }

  return undefined;
}

/**
 * Check if yt-dlp is installed
 */
export async function checkYtDlp(): Promise<boolean> {
  try {
    await execa('yt-dlp', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get yt-dlp version
 */
export async function getYtDlpVersion(): Promise<string> {
  try {
    const { stdout } = await execa('yt-dlp', ['--version']);
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}
