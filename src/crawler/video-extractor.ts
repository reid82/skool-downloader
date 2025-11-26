import { Page } from 'playwright';
import { logger } from '../utils/logger.js';

export type VideoProvider = 'wistia' | 'vimeo' | 'youtube' | 'loom' | 'native' | 'unknown';

export interface VideoInfo {
  provider: VideoProvider;
  url: string | null;
  embedUrl?: string;
  videoId?: string;
}

/**
 * Detect video provider from URL
 */
export function detectProvider(url: string): VideoProvider {
  if (url.includes('wistia.com') || url.includes('wistia.net')) {
    return 'wistia';
  }
  if (url.includes('vimeo.com') || url.includes('player.vimeo.com')) {
    return 'vimeo';
  }
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    return 'youtube';
  }
  if (url.includes('loom.com')) {
    return 'loom';
  }
  if (url.includes('.m3u8') || url.includes('skool.com')) {
    return 'native';
  }
  return 'unknown';
}

/**
 * Extract video information from a lesson page.
 * This function now also triggers video load to capture lazy-loaded native videos.
 */
export async function extractVideoInfo(page: Page): Promise<VideoInfo> {
  // Set up network interception for native videos BEFORE any interactions
  let capturedM3u8: string | null = null;

  const responseHandler = (response: { url: () => string }) => {
    const url = response.url();
    if (url.includes('.m3u8')) {
      logger.debug(`Captured m3u8 URL: ${url.substring(0, 80)}...`);
      capturedM3u8 = url;
    }
  };

  page.on('response', responseHandler);

  try {
    // Wait for page content to load - use domcontentloaded with timeout fallback
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // First check for video embeds that might already be present (before clicking)
    let videoInfo = await checkForVideoEmbeds(page);

    // If no video found yet, trigger video load and check again
    if (videoInfo.provider === 'unknown') {
      logger.debug('No video found initially, triggering video load...');
      await triggerVideoLoad(page);

      // Wait for m3u8 to be captured or iframe to appear
      // Poll for up to 10 seconds
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(500);
        if (capturedM3u8) {
          logger.debug('m3u8 URL captured after waiting');
          break;
        }
        // Also check if an iframe appeared
        const hasNewEmbed = await page.locator('iframe[src*="vimeo"], iframe[src*="youtube"], iframe[src*="loom"], iframe[src*="wistia"], video').first().isVisible({ timeout: 100 }).catch(() => false);
        if (hasNewEmbed) {
          logger.debug('Video embed appeared after clicking');
          break;
        }
      }

      // Check again for video embeds after triggering
      videoInfo = await checkForVideoEmbeds(page);
    }

    // If we captured an m3u8 URL via network, use that for native
    if (videoInfo.provider === 'native' && capturedM3u8) {
      videoInfo.url = capturedM3u8;
    }

    // If provider is unknown but we captured m3u8, it's native
    if (videoInfo.provider === 'unknown' && capturedM3u8) {
      return {
        provider: 'native',
        url: capturedM3u8,
        videoId: undefined,
      };
    }

    return {
      provider: videoInfo.provider,
      url: videoInfo.url,
      embedUrl: videoInfo.url || undefined,
      videoId: videoInfo.videoId || undefined,
    };
  } finally {
    page.off('response', responseHandler);
  }
}

/**
 * Check for video embeds on the page
 */
async function checkForVideoEmbeds(page: Page): Promise<{ provider: VideoProvider; url: string | null; videoId: string | null }> {
  return await page.evaluate(() => {
      // Check for Wistia
      const wistiaIframe = document.querySelector('iframe[src*="wistia.com"], iframe[src*="wistia.net"]');
      if (wistiaIframe) {
        const src = wistiaIframe.getAttribute('src') || '';
        const match = src.match(/(?:wistia\.(?:com|net)\/(?:embed\/iframe\/|medias\/))([a-zA-Z0-9]+)/);
        return {
          provider: 'wistia' as const,
          url: src,
          videoId: match?.[1] || null,
        };
      }

      // Check for Wistia embed div
      const wistiaEmbed = document.querySelector('[class*="wistia_embed"], [class*="wistia-embed"]');
      if (wistiaEmbed) {
        const className = wistiaEmbed.className;
        const match = className.match(/wistia_async_([a-zA-Z0-9]+)/);
        if (match) {
          return {
            provider: 'wistia' as const,
            url: `https://fast.wistia.com/embed/medias/${match[1]}`,
            videoId: match[1],
          };
        }
      }

      // Check for Vimeo
      const vimeoIframe = document.querySelector('iframe[src*="vimeo.com"], iframe[src*="player.vimeo.com"]');
      if (vimeoIframe) {
        const src = vimeoIframe.getAttribute('src') || '';
        const idMatch = src.match(/vimeo\.com\/(?:video\/)?(\d+)/);
        const hashMatch = src.match(/[?&]h=([a-f0-9]+)/);
        // For private videos, include the hash in the videoId so we can reconstruct the URL
        const videoId = idMatch?.[1] || null;
        const hash = hashMatch?.[1] || null;
        return {
          provider: 'vimeo' as const,
          url: src,  // Keep full embed URL
          videoId: hash ? `${videoId}:${hash}` : videoId,  // Store hash with ID
        };
      }

      // Check for YouTube
      const ytIframe = document.querySelector('iframe[src*="youtube.com"], iframe[src*="youtu.be"]');
      if (ytIframe) {
        const src = ytIframe.getAttribute('src') || '';
        const match = src.match(/(?:youtube\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]+)/);
        return {
          provider: 'youtube' as const,
          url: src,
          videoId: match?.[1] || null,
        };
      }

      // Check for Loom
      const loomIframe = document.querySelector('iframe[src*="loom.com"]');
      if (loomIframe) {
        const src = loomIframe.getAttribute('src') || '';
        const match = src.match(/loom\.com\/(?:embed|share)\/([a-zA-Z0-9]+)/);
        return {
          provider: 'loom' as const,
          url: src,
          videoId: match?.[1] || null,
        };
      }

      // Check for native video element - be more permissive
      const videoEl = document.querySelector('video');
      if (videoEl) {
        // Try multiple ways to get the video URL
        const src =
          (videoEl as HTMLVideoElement).currentSrc ||
          videoEl.getAttribute('src') ||
          videoEl.querySelector('source')?.getAttribute('src') ||
          videoEl.querySelector('source')?.getAttribute('data-src');

        // Only return if we have a usable URL (not blob:)
        if (src && !src.startsWith('blob:')) {
          return {
            provider: 'native' as const,
            url: src,
            videoId: null,
          };
        }

        // Even if we don't have src yet, mark as native so we use the captured m3u8
        return {
          provider: 'native' as const,
          url: null,
          videoId: null,
        };
      }

      return {
        provider: 'unknown' as const,
        url: null,
        videoId: null,
      };
  });
}

/**
 * Get downloadable URL for a video
 * For some providers, we need to transform the embed URL
 */
export function getDownloadableUrl(info: VideoInfo): string | null {
  if (!info.url && !info.videoId) {
    return null;
  }

  switch (info.provider) {
    case 'wistia':
      // Wistia can be downloaded via yt-dlp using the embed URL or video ID
      if (info.videoId) {
        return `https://fast.wistia.com/embed/medias/${info.videoId}`;
      }
      return info.url;

    case 'vimeo':
      // Vimeo - handle private videos with hash parameter
      if (info.videoId) {
        // Check if videoId contains hash (format: "id:hash")
        if (info.videoId.includes(':')) {
          const [id, hash] = info.videoId.split(':');
          // Use player URL for private videos - yt-dlp handles this well
          return `https://player.vimeo.com/video/${id}?h=${hash}`;
        }
        return `https://vimeo.com/${info.videoId}`;
      }
      return info.url;

    case 'youtube':
      // YouTube works with standard watch URLs
      if (info.videoId) {
        return `https://www.youtube.com/watch?v=${info.videoId}`;
      }
      return info.url;

    case 'loom':
      // Loom share URLs work with yt-dlp
      if (info.videoId) {
        return `https://www.loom.com/share/${info.videoId}`;
      }
      return info.url;

    case 'native':
      return info.url;

    default:
      return info.url;
  }
}

/**
 * Try to trigger video playback to capture network requests.
 * Skool uses lazy-loaded VideoWrapper components that only load the actual
 * video player (and trigger m3u8 requests) after user interaction.
 */
export async function triggerVideoLoad(page: Page): Promise<void> {
  // Selectors for video wrappers and play buttons, in order of specificity
  const videoTriggerSelectors = [
    // Skool-specific video wrapper - clicking this loads the actual player
    '[class*="VideoWrapper"]',
    '[class*="video-wrapper"]',
    '[class*="videoWrapper"]',
    // Video container elements that might need clicking
    '[class*="VideoContainer"]',
    '[class*="video-container"]',
    '[class*="videoContainer"]',
    // Mux player elements
    'mux-player',
    'mux-video',
    '[class*="mux"]',
    // Generic video overlays/thumbnails that trigger load
    '[class*="video-thumbnail"]',
    '[class*="video-overlay"]',
    '[class*="play-overlay"]',
    // Standard play buttons
    'button[aria-label*="play" i]',
    'button[aria-label*="Play" i]',
    'button[class*="play"]',
    '[data-testid="play"]',
    '.play-button',
    // Video elements themselves (clicking might trigger load)
    'video',
  ];

  for (const selector of videoTriggerSelectors) {
    try {
      const element = page.locator(selector).first();

      if (await element.isVisible({ timeout: 500 }).catch(() => false)) {
        logger.debug(`Clicking video trigger: ${selector}`);
        await element.click({ timeout: 1000 });
        await page.waitForTimeout(2000); // Wait for video to initialize

        // Check if we now have a video element or m3u8 was captured
        const hasVideo = await page.locator('video').first().isVisible({ timeout: 1000 }).catch(() => false);
        if (hasVideo) {
          logger.debug('Video element now visible after click');
          break;
        }
      }
    } catch {
      // Continue to next selector
    }
  }

  // Additional wait for any async video loading
  await page.waitForTimeout(1000);
}
