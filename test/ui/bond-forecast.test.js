// 预计叠层 UI (feedback #25): the server puts the own prep-end forecast in m.private.layerForecast during PREP
// (server/match/player/views.js); the match screen has to hand it to the bond strip and the own bond popup, or the +N
// chips and the popup section never render. A 0.3.1 UI re-basing once dropped that wiring and no test noticed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const game = fs.readFileSync(new URL('../../public/js/screens/game.js', import.meta.url), 'utf8');
const strip = fs.readFileSync(new URL('../../public/js/ui/bondStrip.js', import.meta.url), 'utf8');
const views = fs.readFileSync(new URL('../../server/match/player/views.js', import.meta.url), 'utf8');

test('预计叠层: the server sends it only to the own player, only in PREP', () => {
  assert.match(views, /const forecast = layerForecast\(this\.m, this\);/);
  assert.match(views, /\.\.\.\(forecast \? \{ layerForecast: forecast \} : \{\}\)/);
});

test('预计叠层: the match screen derives the own forecast from priv.layerForecast in PREP only', () => {
  assert.match(
    game,
    /const ownForecast = pub\?\.phase === PHASE\.PREP && priv\?\.layerForecast && !strip\.name \? priv\.layerForecast : null;/,
  );
});

test('预计叠层: the bond strip gets it, so each disc can show its +N', () => {
  const call = game.match(/<\$\{BondStrip\}[\s\S]*?\/>/);
  assert.ok(call, 'BondStrip call site');
  assert.match(call[0], /forecast=\$\{ownForecast\}/);
  assert.match(strip, /data-forecast=\$\{fc\}/);
  assert.match(strip, /休整期结束时预计 \+ \{n\} 层|休整期结束时预计 \+\{n\} 层/);
});

test('预计叠层: the bond popup gets it for the own bonds only', () => {
  const call = game.match(/<\$\{BondPopup\}[\s\S]*?\/>/);
  assert.ok(call, 'BondPopup call site');
  assert.match(call[0], /forecast=\$\{bondPop\.ownerId === myId \? ownForecast : null\}/);
  assert.match(strip, /data-forecast=\$\{forecastOf\(forecast, bondId\)\}/);
  assert.match(strip, /含随机来源，未计入/);
});
