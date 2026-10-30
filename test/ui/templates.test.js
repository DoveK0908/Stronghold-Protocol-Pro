import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const uiRoot = fileURLToPath(new URL('../../public/js/', import.meta.url));

/** Every source line of the client, as `{ rel, line, text }` — enough to look for a template opening. */
function sourceLines() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        const rel = path.relative(uiRoot, full).split(path.sep).join('/');
        fs.readFileSync(full, 'utf8').split('\n').forEach((text, i) => out.push({ rel, line: i + 1, text }));
      }
    }
  };
  walk(uiRoot);
  return out;
}

test('htm templates never open a fragment: <> becomes an element with an empty tag name', () => {
  // htm 3.1.1 parses `<>…</>` into an element whose tag name is '', so Preact calls createElementNS(ns, '') and the
  // browser rejects it ("The qualified name provided is empty"). The error boundary takes the whole screen down and the
  // player only sees 界面发生错误 — which is how the lobby's feedback board broke (feedbackBoard.js returns an array of
  // its two dialogs for exactly this reason).
  assert.deepEqual(sourceLines().filter((l) => /html`<>/.test(l.text)).map((l) => `${l.rel}:${l.line}`), []);
});
