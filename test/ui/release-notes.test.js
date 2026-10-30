import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAnnouncements, announcementRevision } from '../../public/js/ui/announcements.js';
import { seedReleaseRead } from '../helpers/releaseNotes.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const entries = () => parseAnnouncements(JSON.parse(source('../../data/announcements.json')));

test('announcements stay cleared until the maintainer supplies new copy', () => {
  assert.deepEqual(entries(), []);
});

test('release notes share the existing lobby board rather than a second global dialog', () => {
  const main = source('../../public/js/main.js');
  const title = source('../../public/js/screens/title.js');
  const lobby = source('../../public/js/screens/lobby.js');
  assert.doesNotMatch(main, /ReleaseNotesHost|ui\/releaseNotes\.js/);
  assert.doesNotMatch(title, /ReleaseNotesButton|ui\/releaseNotes\.js/);
  assert.match(lobby, /<\$\{NoticeCard\}/);
  assert.match(lobby, /overlay === 'announcements' \? html`<\$\{LobbyAnnouncements\}/);
});

test('unrelated browser flows seed the same announcement revision as the lobby', async () => {
  const calls = [];
  await seedReleaseRead({ evaluateOnNewDocument: (callback, revision) => { calls.push({ callback, revision }); } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].revision, await announcementRevision(entries()));
  const previous = globalThis.localStorage;
  const previousWindow = globalThis.window;
  const saved = new Map();
  try {
    globalThis.localStorage = { setItem: (key, value) => saved.set(key, value) };
    globalThis.window = {}; globalThis.window.top = globalThis.window;
    calls[0].callback(calls[0].revision);
    assert.equal(saved.get('sp.pref.announcements.dismissed'), JSON.stringify(calls[0].revision));
  } finally {
    if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});
