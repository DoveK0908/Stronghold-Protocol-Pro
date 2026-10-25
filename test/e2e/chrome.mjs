// The Chrome build the browser tests drive. Every browser test used to hard-code the macOS path and only honour
// CHROME_PATH, so on a Windows or Linux machine they all reported "no browser" even when one was installed. This
// resolves the first candidate that exists: CHROME_PATH, then the usual Chrome/Chromium/Edge locations per platform
// (Edge is a Chromium build and the browser most Windows machines actually have; the e2e helpers only need CDP).
// It stays a plain module — not a test file — so `node --check` and the import boundary test see no new edges.

import { existsSync } from 'node:fs';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter((p) => typeof p === 'string' && p.length > 0);

/** The first installed browser of the list, or null when there is none. */
export const findChrome = () => CANDIDATES.find((p) => existsSync(p)) ?? null;

/**
 * The executable every browser test launches. `CHROME_PATH` wins; with nothing installed this keeps the old macOS
 * default so the failure message still names a real path.
 */
export const CHROME = findChrome() ?? CANDIDATES[1] ?? CANDIDATES[0];
