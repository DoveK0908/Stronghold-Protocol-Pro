// Named elite AI (community addon port, arturia v0.1.3 / lavinia v0.1.2): a room seat carrying `botPersona`
// takes its reserved opening strategy (laterano band_paganini / siracusa band_chiave), picks before every other
// seat even with 「AI 队友最后选择」, and its strategy is held for it until it picks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch } from './harness.js';

const seatsOf = (personae) => {
  const seats = [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true }];
  personae.forEach((persona, i) => seats.push({ seat: i + 1, playerId: `ai_${i}`, name: `AI·${persona}`, isBot: true, connected: true, botPersona: persona }));
  return seats;
};

/** drive the humans' briefing confirmations, then run the draft with every human taking the first free strategy */
function draft({ personae, aiPicksLast = false, difficulty = 'HARD', pick }) {
  const h = makeMatch({ mode: 'coop', difficulty, humans: 1, seed: 5, fake: true, aiPicksLast, seats: seatsOf(personae) }).start();
  const m = h.m;
  for (const ps of m.players.values()) if (!ps.isBot && !ps.left) m.handle(ps.playerId, { t: 'g.infoReady' });
  h.run(() => m.phase !== PHASE.INFO_CHECK);
  assert.equal(m.phase, PHASE.BAND_DRAFT);
  const order = [];
  for (let i = 0; i < 64 && m.phase === PHASE.BAND_DRAFT; i++) {
    const pid = m.draftTurn();
    if (pid) {
      order.push(pid);
      if (!m.players.get(pid).botControlled) {
        const id = pick ? pick(m, pid) : m.gd.bandIds().find((b) => !m.bandTaken(b, pid));
        assert.deepEqual(m.handle(pid, { t: 'g.band', bandId: id }), { ok: true }, `${pid} picks ${id}`);
      }
    }
    h.run(() => m.phase !== PHASE.BAND_DRAFT || (m.draftTurn() != null && !m.players.get(m.draftTurn()).botControlled));
  }
  const picks = { ...m.draft.picks };
  m.dispose();
  return { picks, order };
}

test('arturia takes the Laterano band and drafts before the human even with AI 队友最后选择', () => {
  const { picks, order } = draft({ personae: ['arturia'], aiPicksLast: true });
  assert.equal(order[0], 'ai_0', 'the named elite drafts first');
  assert.equal(picks.ai_0, 'band_paganini');
});

test('lavinia takes the Siracusa band', () => {
  const { picks, order } = draft({ personae: ['lavinia'], aiPicksLast: true });
  assert.equal(order[0], 'ai_0');
  assert.equal(picks.ai_0, 'band_chiave');
});

test('both elites keep their own bands when they are in the same room', () => {
  const { picks } = draft({ personae: ['arturia', 'lavinia'] });
  assert.equal(picks.ai_0, 'band_paganini');
  assert.equal(picks.ai_1, 'band_chiave');
});

test('an elite band is held for it: a human cannot take it first', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, seed: 5, fake: true, seats: seatsOf(['arturia']) }).start();
  const m = h.m;
  for (const ps of m.players.values()) if (!ps.isBot && !ps.left) m.handle(ps.playerId, { t: 'g.infoReady' });
  h.run(() => m.phase !== PHASE.INFO_CHECK);
  assert.equal(m.phase, PHASE.BAND_DRAFT);
  // the reservation only exists inside the draft (it reads the draft order), so hold the elite's turn and let the
  // human try the reserved strategy first
  const turn = m.draftTurn();
  assert.equal(turn, 'ai_0', 'the named elite drafts first');
  assert.equal(m.bandTaken('band_paganini', 'p_0'), true, 'reserved for the elite seat');
  m.handle('p_0', { t: 'g.band', bandId: 'band_paganini' });
  assert.ok(!m.draft.picks.p_0, 'the human cannot take the reserved band, even out of turn');
  // and it is not reserved for the elite itself
  assert.ok(!m.bandTaken('band_paganini', 'ai_0'));
  m.dispose();
});

test('without a persona an AI seat behaves exactly as before (no reserved band)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, bots: 1, seed: 5, fake: true }).start();
  const m = h.m;
  for (const ps of m.players.values()) if (!ps.isBot && !ps.left) m.handle(ps.playerId, { t: 'g.infoReady' });
  h.run(() => m.phase !== PHASE.INFO_CHECK);
  assert.equal(m.bandTaken('band_paganini', 'p_0'), false, 'nothing is held without a named elite');
  m.dispose();
});

test('the elite prepares with its own policy on this host (units bought, invariants hold)', () => {
  for (const persona of ['arturia', 'lavinia']) {
    const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, seed: 11, fake: true, seats: seatsOf([persona]) }).start();
    h.autoHumans();
    h.drive(() => h.m.phase === 'PREP' || h.ended);
    const ps = h.ps('ai_0');
    const band = persona === 'arturia' ? 'band_paganini' : 'band_chiave';
    assert.equal(ps.bandId, band);
    h.run(() => ps.deployCount > 0 || h.ended, { maxSteps: 2e6 });
    assert.ok(ps.deployCount > 0, `${persona} deployed during the first prep`);
    assert.deepEqual(h.logs.error, []);
    h.invariants();
    h.m.dispose();
  }
});
