import fs from 'fs/promises';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { logger } from '../utils/logger.js';
import { ensureDir, safeFilename } from '../utils/file-utils.js';
import {
  ExtractedLink,
  ModuleContent,
  getGoogleDriveDirectUrl,
  getDropboxDirectUrl,
} from '../crawler/content-extractor.js';

export interface DownloadResult {
  url: string;
  success: boolean;
  outputPath?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * Get filename from URL or Content-Disposition header
 */
function getFilenameFromUrl(url: string, contentDisposition?: string): string {
  // Try Content-Disposition header first
  if (contentDisposition) {
    const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (match) {
      let filename = match[1].replace(/['"]/g, '');
      // Decode URL-encoded filenames
      try {
        filename = decodeURIComponent(filename);
      } catch {
        // Keep as-is if decoding fails
      }
      return safeFilename(filename);
    }
  }

  // Extract from URL path
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const segments = pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1];

    if (lastSegment && lastSegment.includes('.')) {
      // Decode URL-encoded filenames
      try {
        return safeFilename(decodeURIComponent(lastSegment));
      } catch {
        return safeFilename(lastSegment);
      }
    }
  } catch {
    // URL parsing failed
  }

  return '';
}

/**
 * Infer file extension from Content-Type
 */
function getExtensionFromContentType(contentType: string): string {
  const mimeToExt: Record<string, string> = {
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/zip': '.zip',
    'application/x-zip-compressed': '.zip',
    'text/plain': '.txt',
    'text/html': '.html',
    'text/markdown': '.md',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'application/json': '.json',
  };

  const baseMime = contentType.split(';')[0].trim().toLowerCase();
  return mimeToExt[baseMime] || '';
}

/**
 * Download a file from URL
 */
async function downloadFile(
  url: string,
  outputPath: string,
  followRedirects: number = 5
): Promise<{ success: boolean; finalPath?: string; error?: string; requiresAuth?: boolean }> {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: '*/*',
      },
    };

    const request = protocol.get(options, async (response) => {
      // Handle redirects
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        const redirectUrl = response.headers.location;
        if (redirectUrl && followRedirects > 0) {
          // Resolve relative redirects
          const absoluteUrl = new URL(redirectUrl, url).href;
          const result = await downloadFile(absoluteUrl, outputPath, followRedirects - 1);
          resolve(result);
          return;
        }
      }

      // Check for auth required (401, 403) or not found (404)
      if (response.statusCode === 401 || response.statusCode === 403) {
        resolve({ success: false, requiresAuth: true, error: 'Authentication required' });
        return;
      }

      if (response.statusCode === 404) {
        resolve({ success: false, error: 'File not found (404)' });
        return;
      }

      if (response.statusCode && response.statusCode >= 400) {
        resolve({ success: false, error: `HTTP ${response.statusCode}` });
        return;
      }

      // Get filename and extension
      const contentDisposition = response.headers['content-disposition'] as string | undefined;
      const contentType = response.headers['content-type'] || '';

      let finalPath = outputPath;

      // If output path doesn't have extension, try to determine it
      if (!path.extname(outputPath)) {
        const urlFilename = getFilenameFromUrl(url, contentDisposition);
        if (urlFilename && path.extname(urlFilename)) {
          finalPath = outputPath + path.extname(urlFilename);
        } else {
          const ext = getExtensionFromContentType(contentType);
          if (ext) {
            finalPath = outputPath + ext;
          }
        }
      }

      // Ensure directory exists
      await ensureDir(path.dirname(finalPath));

      // Download to file
      const fileStream = await fs.open(finalPath, 'w');
      const writeStream = fileStream.createWriteStream();

      response.pipe(writeStream);

      writeStream.on('finish', async () => {
        await fileStream.close();
        resolve({ success: true, finalPath });
      });

      writeStream.on('error', async (err) => {
        await fileStream.close();
        resolve({ success: false, error: err.message });
      });
    });

    request.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    // Set timeout
    request.setTimeout(30000, () => {
      request.destroy();
      resolve({ success: false, error: 'Download timeout' });
    });
  });
}

/**
 * Download a resource/link to a file
 */
export async function downloadResource(
  link: ExtractedLink,
  outputDir: string,
  index: number
): Promise<DownloadResult> {
  let downloadUrl = link.url;

  // Convert to direct download URLs where possible
  if (link.type === 'google-drive' || link.type === 'google-doc') {
    const directUrl = getGoogleDriveDirectUrl(link.url);
    if (directUrl) {
      downloadUrl = directUrl;
    }
  } else if (link.url.includes('dropbox.com')) {
    downloadUrl = getDropboxDirectUrl(link.url);
  }

  // Skip Notion pages - they're web pages, not downloadable files
  // But we'll save the link in the markdown content
  if (link.type === 'notion') {
    return {
      url: link.url,
      success: false,
      skipped: true,
      skipReason: 'Notion pages cannot be directly downloaded (link preserved in content)',
    };
  }

  // Generate output filename
  const safeTitle = safeFilename(link.text) || `resource_${index + 1}`;
  const basePath = path.join(outputDir, 'resources', safeTitle);

  logger.debug(`Downloading resource: ${link.text} from ${downloadUrl}`);

  const result = await downloadFile(downloadUrl, basePath);

  if (result.requiresAuth) {
    return {
      url: link.url,
      success: false,
      skipped: true,
      skipReason: 'Requires authentication',
    };
  }

  if (!result.success) {
    return {
      url: link.url,
      success: false,
      error: result.error,
    };
  }

  return {
    url: link.url,
    success: true,
    outputPath: result.finalPath,
  };
}

/**
 * Download all resources from module content
 */
export async function downloadModuleResources(
  content: ModuleContent,
  outputDir: string
): Promise<DownloadResult[]> {
  const results: DownloadResult[] = [];

  // Download all embedded links that are downloadable files
  for (let i = 0; i < content.embeddedLinks.length; i++) {
    const link = content.embeddedLinks[i];

    // Skip links that are clearly not files
    if (link.type === 'external' && !isLikelyFile(link.url)) {
      results.push({
        url: link.url,
        success: false,
        skipped: true,
        skipReason: 'External link (not a file)',
      });
      continue;
    }

    const result = await downloadResource(link, outputDir, i);
    results.push(result);
  }

  return results;
}

/**
 * Check if a URL is likely a downloadable file
 */
function isLikelyFile(url: string): boolean {
  const lowerUrl = url.toLowerCase();

  // Check for common file extensions
  const fileExtensions = [
    '.pdf',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
    '.zip',
    '.rar',
    '.7z',
    '.txt',
    '.csv',
    '.mp3',
    '.wav',
    '.mp4',
    '.mov',
    '.avi',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.svg',
  ];

  for (const ext of fileExtensions) {
    if (lowerUrl.includes(ext)) {
      return true;
    }
  }

  // Check for file-hosting services
  const fileHostPatterns = [
    'drive.google.com/file',
    'dropbox.com/s/',
    'dropbox.com/scl/',
    'dl.dropboxusercontent.com',
    'amazonaws.com',
    's3.',
    'cloudfront.net',
    'cdn.',
  ];

  for (const pattern of fileHostPatterns) {
    if (lowerUrl.includes(pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Save module content as markdown file
 */
export async function saveModuleContent(
  content: ModuleContent,
  moduleTitle: string,
  outputDir: string,
  resourceResults: DownloadResult[]
): Promise<string> {
  await ensureDir(outputDir);

  let markdown = `# ${moduleTitle}\n\n`;

  // Add description if available
  if (content.description) {
    markdown += `## Description\n\n${content.description}\n\n`;
  }

  // Add main content
  if (content.markdownContent) {
    markdown += `## Content\n\n${content.markdownContent}\n\n`;
  }

  // Add resources section
  if (content.resources.length > 0 || content.embeddedLinks.length > 0) {
    markdown += `## Resources & Links\n\n`;

    // List attached resources
    if (content.resources.length > 0) {
      markdown += `### Attached Resources\n\n`;
      for (const resource of content.resources) {
        markdown += `- [${resource.title}](${resource.link})\n`;
      }
      markdown += '\n';
    }

    // List embedded links
    const nonResourceLinks = content.embeddedLinks.filter(
      (l) => !content.resources.some((r) => r.link === l.url)
    );
    if (nonResourceLinks.length > 0) {
      markdown += `### Links in Content\n\n`;
      for (const link of nonResourceLinks) {
        markdown += `- [${link.text}](${link.url}) *(${link.type})*\n`;
      }
      markdown += '\n';
    }
  }

  // Add downloaded files section
  const successfulDownloads = resourceResults.filter((r) => r.success);
  if (successfulDownloads.length > 0) {
    markdown += `## Downloaded Files\n\n`;
    for (const result of successfulDownloads) {
      const relativePath = path.relative(outputDir, result.outputPath!);
      markdown += `- [${path.basename(result.outputPath!)}](./${relativePath})\n`;
    }
    markdown += '\n';
  }

  // Add skipped/failed section for reference
  const skippedOrFailed = resourceResults.filter((r) => !r.success);
  if (skippedOrFailed.length > 0) {
    markdown += `## Notes\n\n`;
    markdown += `Some resources could not be downloaded:\n`;
    for (const result of skippedOrFailed) {
      const reason = result.skipReason || result.error || 'Unknown error';
      markdown += `- ${result.url}: ${reason}\n`;
    }
    markdown += '\n';
  }

  // Save markdown file
  const contentFile = path.join(outputDir, 'content.md');
  await fs.writeFile(contentFile, markdown, 'utf-8');

  return contentFile;
}
