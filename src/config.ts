import path from 'path';
import os from 'os';

export interface Config {
  // Paths
  stateDir: string;
  downloadDir: string;
  cookiesFile: string;

  // Chrome profile for cookies
  chromeUserDataDir: string;

  // Download settings
  concurrency: number;
  quality: 'best' | '1080p' | '720p' | '480p';
  downloadSubs: boolean;
  subsLang: string;

  // Rate limiting
  delayBetweenPages: number; // ms
  delayBetweenDownloads: number; // ms
}

export const defaultConfig: Config = {
  stateDir: '.skool-state',
  downloadDir: './downloads',
  cookiesFile: '.skool-state/cookies.json',

  chromeUserDataDir: path.join(
    os.homedir(),
    'Library/Application Support/Google/Chrome'
  ),

  concurrency: 2,
  quality: 'best',
  downloadSubs: true,
  subsLang: 'en',

  delayBetweenPages: 2000,
  delayBetweenDownloads: 1000,
};

export function getConfig(overrides: Partial<Config> = {}): Config {
  return { ...defaultConfig, ...overrides };
}
