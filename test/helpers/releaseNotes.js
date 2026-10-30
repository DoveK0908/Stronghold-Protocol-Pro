import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { announcementRevision } from '../../public/js/ui/announcements.js';

/** Returning-player setup for unrelated browser flows; release notes now live in the lobby board. */
export async function seedReleaseRead(page) {
  const value = JSON.parse(readFileSync(new URL('../../data/announcements.json', import.meta.url), 'utf8'));
  const revision = await announcementRevision(value, webcrypto);
  return page.evaluateOnNewDocument((revision) => {
    if (window.top !== window) return; // plugin sandbox frames do not have access to the host's storage
    localStorage.setItem('sp.pref.announcements.dismissed', JSON.stringify(revision));
  }, revision);
}
