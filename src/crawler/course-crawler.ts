import { Page } from 'playwright';
import { logger } from '../utils/logger.js';
import { extractVideoInfo, getDownloadableUrl, VideoInfo } from './video-extractor.js';

export interface Course {
  id: string;
  name: string; // Short URL slug (e.g., "052850dd")
  title: string;
  description: string;
  numModules: number;
  hasAccess: boolean;
  index: number;
}

export interface Module {
  id: string;
  title: string;
  courseId: string;
  courseTitle: string;
  index: number;
  url: string;
}

export interface CourseStructure {
  name: string;
  slug: string;
  url: string;
  courses: Course[];
  modules: Module[];
}

/**
 * Extract course slug from URL
 */
export function extractSlug(url: string): string {
  const match = url.match(/skool\.com\/([^\/]+)/);
  return match?.[1] || 'unknown';
}

/**
 * Parse __NEXT_DATA__ from page
 */
async function parseNextData(page: Page): Promise<Record<string, unknown> | null> {
  try {
    const nextData = await page.evaluate(() => {
      const script = document.getElementById('__NEXT_DATA__');
      if (script?.textContent) {
        return JSON.parse(script.textContent);
      }
      return null;
    });
    return nextData as Record<string, unknown>;
  } catch (error) {
    logger.debug(`Failed to parse __NEXT_DATA__: ${error}`);
    return null;
  }
}

/**
 * Extract course list from __NEXT_DATA__
 */
function extractCoursesFromNextData(nextData: Record<string, unknown>): Course[] {
  const courses: Course[] = [];

  try {
    const pageProps = (nextData as { props?: { pageProps?: { allCourses?: unknown[] } } })
      .props?.pageProps;

    if (!pageProps?.allCourses) {
      return courses;
    }

    const allCourses = pageProps.allCourses as Array<{
      id: string;
      name: string; // Short URL slug like "052850dd"
      metadata?: {
        title?: string;
        desc?: string;
        numModules?: number;
        hasAccess?: number;
      };
    }>;

    for (let i = 0; i < allCourses.length; i++) {
      const course = allCourses[i];
      const metadata = course.metadata || {};

      courses.push({
        id: course.id,
        name: course.name || course.id,
        title: metadata.title || `Course ${i + 1}`,
        description: metadata.desc || '',
        numModules: metadata.numModules || 0,
        hasAccess: metadata.hasAccess === 1,
        index: i,
      });
    }
  } catch (error) {
    logger.debug(`Error extracting courses: ${error}`);
  }

  return courses;
}

/**
 * Expand all accordion sections in the sidebar to reveal nested modules.
 * Skool uses collapsible sections that hide modules until clicked.
 */
async function expandAllAccordions(page: Page): Promise<number> {
  let expandedCount = 0;

  // Find all accordion toggles - these are typically buttons or divs with aria-expanded
  // or elements that have a chevron/arrow icon indicating they can be expanded
  const accordionSelectors = [
    // Aria-based accordion toggles (collapsed state)
    '[aria-expanded="false"]',
    // Common accordion button patterns
    'button[class*="accordion"]',
    'div[class*="accordion"][role="button"]',
    // Chevron/arrow icons that indicate expandable sections
    '[class*="chevron"]:not([class*="up"])',
    '[class*="arrow"]:not([class*="up"])',
    // Skool-specific: section headers that are clickable
    '[class*="CollapsibleSection"] > [role="button"]',
    '[class*="collapsible"] > [role="button"]',
  ];

  for (const selector of accordionSelectors) {
    try {
      const elements = await page.locator(selector).all();

      for (const element of elements) {
        try {
          // Check if element is visible and not already expanded
          if (await element.isVisible({ timeout: 500 })) {
            const ariaExpanded = await element.getAttribute('aria-expanded');

            // Only click if explicitly collapsed or no aria-expanded attribute
            if (ariaExpanded !== 'true') {
              await element.click({ timeout: 1000 });
              expandedCount++;
              await page.waitForTimeout(300); // Small delay for animation
            }
          }
        } catch {
          // Element might have become stale or invisible, continue
        }
      }
    } catch {
      // Selector might not match anything, continue
    }
  }

  // Also try clicking any role="button" elements in the sidebar that might be section headers
  // These often don't have aria-expanded but still toggle visibility
  try {
    const sidebarButtons = await page.locator('nav [role="button"], aside [role="button"], [class*="sidebar"] [role="button"]').all();

    for (const btn of sidebarButtons) {
      try {
        if (await btn.isVisible({ timeout: 500 })) {
          // Check if this looks like a section header (has text but no md= link nearby)
          const text = await btn.textContent();
          const hasModuleLink = await btn.locator('a[href*="md="]').count();

          if (text && text.length > 0 && text.length < 100 && hasModuleLink === 0) {
            await btn.click({ timeout: 1000 });
            expandedCount++;
            await page.waitForTimeout(300);
          }
        }
      } catch {
        // Continue on error
      }
    }
  } catch {
    // Ignore errors
  }

  return expandedCount;
}

/**
 * Navigate to a course page and extract module links from the sidebar.
 * Skool courses have nested modules that are only visible when viewing the course page.
 */
async function extractModulesFromCourse(
  page: Page,
  course: Course,
  baseUrl: string,
  slug: string
): Promise<Module[]> {
  const modules: Module[] = [];

  // Navigate to course page using the course name (short slug)
  // URL format: /classroom/{course.name}
  const courseUrl = `https://www.skool.com/${slug}/classroom/${course.name}`;

  logger.debug(`Navigating to course: ${courseUrl}`);

  try {
    await page.goto(courseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Expand all accordion sections to reveal nested modules
    const expandedCount = await expandAllAccordions(page);
    if (expandedCount > 0) {
      logger.debug(`Expanded ${expandedCount} accordion sections`);
      await page.waitForTimeout(1000); // Wait for content to render
    }

    // Extract module links from the sidebar
    const moduleLinks = await page.evaluate(() => {
      const links: Array<{ text: string; href: string }> = [];

      document.querySelectorAll('a').forEach((a) => {
        if (a.href.includes('md=')) {
          const text = a.textContent?.trim();
          if (text && text.length > 0 && text.length < 150) {
            if (!links.some((l) => l.href === a.href)) {
              links.push({ text, href: a.href });
            }
          }
        }
      });

      return links;
    });

    logger.debug(`Found ${moduleLinks.length} modules in course: ${course.title}`);

    for (let i = 0; i < moduleLinks.length; i++) {
      const link = moduleLinks[i];
      const mdMatch = link.href.match(/md=([a-f0-9]+)/);

      if (mdMatch) {
        modules.push({
          id: mdMatch[1],
          title: link.text,
          courseId: course.id,
          courseTitle: course.title,
          index: i,
          url: link.href,
        });
      }
    }
  } catch (error) {
    logger.debug(`Failed to extract modules from course ${course.title}: ${error}`);
  }

  return modules;
}

/**
 * Main function to crawl course structure
 */
export async function crawlCourseStructure(
  page: Page,
  classroomUrl: string
): Promise<CourseStructure> {
  logger.startSpinner('Discovering course structure...');

  // Navigate to classroom
  await page.goto(classroomUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  const slug = extractSlug(classroomUrl);
  const baseUrl = classroomUrl.split('?')[0]; // Remove any query params

  // Extract __NEXT_DATA__
  const nextData = await parseNextData(page);
  if (!nextData) {
    logger.failSpinner('Failed to parse page data');
    return {
      name: 'Unknown Course',
      slug,
      url: classroomUrl,
      courses: [],
      modules: [],
    };
  }

  // Get course name from page props
  const pageProps = (nextData as { props?: { pageProps?: { currentGroup?: { metadata?: { displayName?: string } } } } })
    .props?.pageProps;
  const courseName = pageProps?.currentGroup?.metadata?.displayName || 'Unknown Course';

  // Extract courses list
  const courses = extractCoursesFromNextData(nextData);

  logger.updateSpinner(`Found ${courses.length} courses, extracting modules...`);

  // Extract modules from each course
  const allModules: Module[] = [];

  for (const course of courses) {
    // Skip courses without access
    if (!course.hasAccess) {
      logger.debug(`Skipping locked course: ${course.title}`);
      continue;
    }

    logger.updateSpinner(`Extracting: ${course.title}...`);
    const modules = await extractModulesFromCourse(page, course, baseUrl, slug);
    allModules.push(...modules);

    // Small delay between courses
    await page.waitForTimeout(1000);
  }

  logger.succeedSpinner(
    `Found ${courses.length} courses with ${allModules.length} modules`
  );

  return {
    name: courseName,
    slug,
    url: classroomUrl,
    courses,
    modules: allModules,
  };
}

/**
 * Navigate to a module and extract video info
 */
export async function extractModuleVideo(
  page: Page,
  module: Module,
  delayMs: number = 2000
): Promise<VideoInfo & { downloadUrl: string | null }> {
  logger.debug(`Extracting video from: ${module.title}`);

  await page.goto(module.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(delayMs);

  // Extract video info (this now also triggers video load internally)
  const videoInfo = await extractVideoInfo(page);
  const downloadUrl = getDownloadableUrl(videoInfo);

  return {
    ...videoInfo,
    downloadUrl,
  };
}

// Keep old interface for compatibility
export interface Lesson {
  id: string;
  title: string;
  index: number;
  url: string;
  moduleId: string;
  moduleTitle: string;
  moduleIndex: number;
}

/**
 * Convert modules to lessons format for compatibility
 */
export function modulesToLessons(modules: Module[]): Lesson[] {
  return modules.map((m) => ({
    id: m.id,
    title: m.title,
    index: m.index,
    url: m.url,
    moduleId: m.courseId,
    moduleTitle: m.courseTitle,
    moduleIndex: m.index,
  }));
}
