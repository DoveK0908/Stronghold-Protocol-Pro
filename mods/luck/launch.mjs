// Run the pinned Luck runtime against this checkout without writing into the reference clone.
import { fileURLToPath } from 'node:url';
const gameRoot = fileURLToPath(new URL('../../', import.meta.url));
process.argv = [process.argv[0], fileURLToPath(new URL('./runtime/src/launcher.mjs', import.meta.url)),
  '--game', gameRoot, ...process.argv.slice(2)];
await import('./runtime/src/launcher.mjs');
