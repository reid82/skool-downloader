import { Page } from 'playwright';
import { logger } from '../utils/logger.js';

export interface Resource {
  title: string;
  link: string;
  type: 'attachment' | 'link';
}

export interface ExtractedLink {
  text: string;
  url: string;
  type: 'pdf' | 'google-doc' | 'google-drive' | 'notion' | 'external' | 'unknown';
}

export interface ModuleContent {
  description: string;
  htmlContent: string;
  markdownContent: string;
  resources: Resource[];
  embeddedLinks: ExtractedLink[];
}

/**
 * Detect the type of a URL
 */
function detectLinkType(url: string): ExtractedLink['type'] {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes('.pdf') || lowerUrl.includes('/pdf/')) {
    return 'pdf';
  }
  if (lowerUrl.includes('docs.google.com') || lowerUrl.includes('drive.google.com/file')) {
    return 'google-doc';
  }
  if (lowerUrl.includes('drive.google.com')) {
    return 'google-drive';
  }
  if (lowerUrl.includes('notion.site') || lowerUrl.includes('notion.so')) {
    return 'notion';
  }

  return 'external';
}

/**
 * Convert HTML content to Markdown
 */
function htmlToMarkdown(html: string): string {
  let md = html;

  // Remove script and style tags
  md = md.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  md = md.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Convert headings
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
  md = md.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n');
  md = md.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n');

  // Convert bold and italic
  md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');

  // Convert links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

  // Convert images
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi, '![$2]($1)');
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '![]($1)');

  // Convert lists
  md = md.replace(/<ul[^>]*>/gi, '\n');
  md = md.replace(/<\/ul>/gi, '\n');
  md = md.replace(/<ol[^>]*>/gi, '\n');
  md = md.replace(/<\/ol>/gi, '\n');
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');

  // Convert paragraphs and line breaks
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Convert blockquotes
  md = md.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, '> $1\n\n');

  // Convert code
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
  md = md.replace(/<pre[^>]*>(.*?)<\/pre>/gi, '```\n$1\n```\n');

  // Remove remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  md = md.replace(/&nbsp;/g, ' ');
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&rsquo;/g, "'");
  md = md.replace(/&lsquo;/g, "'");
  md = md.replace(/&rdquo;/g, '"');
  md = md.replace(/&ldquo;/g, '"');
  md = md.replace(/&mdash;/g, '-');
  md = md.replace(/&ndash;/g, '-');

  // Clean up extra whitespace
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();

  return md;
}

/**
 * Parse resources JSON string from Skool metadata
 */
export function parseResources(resourcesJson: string | undefined): Resource[] {
  if (!resourcesJson || resourcesJson === '[]') {
    return [];
  }

  try {
    const parsed = JSON.parse(resourcesJson) as Array<{ title: string; link: string }>;
    return parsed.map((r) => ({
      title: r.title,
      link: r.link,
      type: 'attachment' as const,
    }));
  } catch (error) {
    logger.debug(`Failed to parse resources JSON: ${error}`);
    return [];
  }
}

/**
 * Extract module content from the current page
 */
export async function extractModuleContent(page: Page): Promise<ModuleContent> {
  // Extract content from the page
  const content = await page.evaluate(() => {
    // Find the main content area - Skool uses various content containers
    const contentSelectors = [
      '[class*="ModuleContent"]',
      '[class*="module-content"]',
      '[class*="ContentBody"]',
      '[class*="content-body"]',
      '[class*="RichText"]',
      '[class*="rich-text"]',
      'article',
      '.prose',
      '[data-testid="module-content"]',
    ];

    let contentElement: Element | null = null;
    for (const selector of contentSelectors) {
      contentElement = document.querySelector(selector);
      if (contentElement) break;
    }

    // If no content container found, try to find the main content area
    if (!contentElement) {
      // Look for content after the video player
      const videoWrapper = document.querySelector('[class*="VideoWrapper"], [class*="video-wrapper"], video');
      if (videoWrapper?.parentElement) {
        // Get siblings after video
        const parent = videoWrapper.parentElement;
        const siblings = Array.from(parent.children);
        const videoIndex = siblings.indexOf(videoWrapper as Element);
        const contentSiblings = siblings.slice(videoIndex + 1);
        if (contentSiblings.length > 0) {
          const tempDiv = document.createElement('div');
          contentSiblings.forEach((s) => tempDiv.appendChild(s.cloneNode(true)));
          contentElement = tempDiv;
        }
      }
    }

    // Extract all links from the content
    const links: Array<{ text: string; url: string }> = [];
    if (contentElement) {
      contentElement.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href');
        const text = a.textContent?.trim();
        if (href && text && !href.startsWith('#') && !href.startsWith('javascript:')) {
          // Skip Skool internal navigation links
          if (!href.includes('/classroom') || href.includes('http')) {
            links.push({ text, url: href });
          }
        }
      });
    }

    // Also search the entire page for links that might be in other areas
    document.querySelectorAll('main a[href], [role="main"] a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      const text = a.textContent?.trim();
      if (href && text && !href.startsWith('#') && !href.startsWith('javascript:')) {
        // Only include external links or document links
        if (
          href.includes('pdf') ||
          href.includes('docs.google') ||
          href.includes('drive.google') ||
          href.includes('notion') ||
          href.includes('dropbox') ||
          (href.startsWith('http') && !href.includes('skool.com'))
        ) {
          // Avoid duplicates
          if (!links.some((l) => l.url === href)) {
            links.push({ text, url: href });
          }
        }
      }
    });

    return {
      html: contentElement?.innerHTML || '',
      text: contentElement?.textContent?.trim() || '',
      links,
    };
  });

  // Also extract from __NEXT_DATA__ for description
  const nextDataContent = await page.evaluate(() => {
    const script = document.getElementById('__NEXT_DATA__');
    if (script?.textContent) {
      try {
        const data = JSON.parse(script.textContent);
        const pageProps = data?.props?.pageProps;

        // Try to find module description from various locations
        const selectedModule = pageProps?.selectedModule;
        const course = pageProps?.course;

        // Find the selected module in the course tree
        let moduleDesc = '';
        let moduleResources = '[]';

        const findModule = (node: { course?: { id?: string; metadata?: { desc?: string; resources?: string } }; children?: unknown[] }): { desc: string; resources: string } | null => {
          if (node.course && node.course.id === selectedModule) {
            return {
              desc: node.course.metadata?.desc || '',
              resources: node.course.metadata?.resources || '[]',
            };
          }
          if (node.children) {
            for (const child of node.children as typeof node[]) {
              const result = findModule(child);
              if (result) return result;
            }
          }
          return null;
        };

        if (course) {
          const found = findModule(course);
          if (found) {
            moduleDesc = found.desc;
            moduleResources = found.resources;
          }
        }

        return { description: moduleDesc, resources: moduleResources };
      } catch {
        return { description: '', resources: '[]' };
      }
    }
    return { description: '', resources: '[]' };
  });

  // Parse resources from metadata
  const resources = parseResources(nextDataContent.resources);

  // Process embedded links
  const embeddedLinks: ExtractedLink[] = content.links.map((link) => ({
    text: link.text,
    url: link.url,
    type: detectLinkType(link.url),
  }));

  // Add resources as links too (deduplicated)
  for (const resource of resources) {
    if (!embeddedLinks.some((l) => l.url === resource.link)) {
      embeddedLinks.push({
        text: resource.title,
        url: resource.link,
        type: detectLinkType(resource.link),
      });
    }
  }

  return {
    description: nextDataContent.description,
    htmlContent: content.html,
    markdownContent: htmlToMarkdown(content.html),
    resources,
    embeddedLinks,
  };
}

/**
 * Check if a URL is publicly downloadable (no auth required)
 */
export function isPubliclyDownloadable(url: string): boolean {
  const lowerUrl = url.toLowerCase();

  // Direct file links are typically public
  if (
    lowerUrl.endsWith('.pdf') ||
    lowerUrl.endsWith('.doc') ||
    lowerUrl.endsWith('.docx') ||
    lowerUrl.endsWith('.xls') ||
    lowerUrl.endsWith('.xlsx') ||
    lowerUrl.endsWith('.ppt') ||
    lowerUrl.endsWith('.pptx') ||
    lowerUrl.endsWith('.zip') ||
    lowerUrl.endsWith('.txt')
  ) {
    return true;
  }

  // Google Drive/Docs with specific share patterns
  if (lowerUrl.includes('drive.google.com') && lowerUrl.includes('/file/d/')) {
    return true; // May need to convert to direct download
  }

  // Public Notion pages
  if (lowerUrl.includes('notion.site') || (lowerUrl.includes('notion.so') && !lowerUrl.includes('/login'))) {
    return true;
  }

  // Dropbox public links
  if (lowerUrl.includes('dropbox.com') && (lowerUrl.includes('/s/') || lowerUrl.includes('dl='))) {
    return true;
  }

  return false;
}

/**
 * Convert Google Drive view URL to direct download URL
 */
export function getGoogleDriveDirectUrl(url: string): string | null {
  // Extract file ID from various Google Drive URL formats
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /id=([a-zA-Z0-9_-]+)/,
    /\/d\/([a-zA-Z0-9_-]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      const fileId = match[1];
      return `https://drive.google.com/uc?export=download&id=${fileId}`;
    }
  }

  return null;
}

/**
 * Convert Dropbox share URL to direct download URL
 */
export function getDropboxDirectUrl(url: string): string {
  // Change dl=0 to dl=1 for direct download
  return url.replace('dl=0', 'dl=1').replace('www.dropbox.com', 'dl.dropboxusercontent.com');
}
