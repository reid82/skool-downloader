import sanitize from 'sanitize-filename';
import fs from 'fs/promises';
import path from 'path';

/**
 * Create a safe filename from a string
 */
export function safeFilename(name: string): string {
  return sanitize(name)
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 200); // Limit length
}

/**
 * Generate output path for a video
 */
export function generateOutputPath(
  baseDir: string,
  courseName: string,
  moduleIndex: number,
  moduleTitle: string,
  lessonIndex: number,
  lessonTitle: string
): string {
  const courseDir = safeFilename(courseName);
  const moduleDir = `${String(moduleIndex + 1).padStart(2, '0')}_${safeFilename(moduleTitle)}`;
  const lessonFile = `${String(lessonIndex + 1).padStart(2, '0')}_${safeFilename(lessonTitle)}`;

  return path.join(baseDir, courseDir, moduleDir, lessonFile);
}

/**
 * Ensure directory exists
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Check if file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find video file with any extension
 */
export async function findVideoFile(basePath: string): Promise<string | null> {
  const extensions = ['.mp4', '.mkv', '.webm', '.mov'];

  for (const ext of extensions) {
    const fullPath = basePath + ext;
    if (await fileExists(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

/**
 * Get file size in MB
 */
export async function getFileSizeMB(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath);
  return stats.size / (1024 * 1024);
}
