// Pure client input adapter. The shared parser and match remain authoritative.
import { parseTestPluginArgs } from '../../../shared/testPlugin.js';

export function testPluginAvailable(pub, mine, myId) {
  return !!(pub?.experimental?.luckConsole === true && pub.phase !== 'RESULT' && !pub.ended
    && myId && mine?.playerId === myId && mine.alive === true && mine.lp > 0 && !mine.pendingDeath
    && mine.testPlugin && pub.players?.some((p) => p.playerId === myId && !p.isBot && !p.left));
}

const integer = (raw) => typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;

export function testPluginInput(cmd, fields) {
  let args;
  if (cmd === 'funds') args = { amount: integer(fields.amount) };
  else if (cmd === 'lp') args = { value: integer(fields.amount) };
  else if (cmd === 'round') args = { round: integer(fields.round) };
  else if (cmd === 'level') args = {};
  else if (cmd === 'shop') {
    const slots = String(fields.shop || '').split(',').map((s) => {
      const part = s.trim();
      const colon = part.indexOf(':');
      return { kind: part.slice(0, colon), id: colon < 0 ? '' : part.slice(colon + 1).trim() };
    });
    args = { slots };
  } else if (cmd === 'bond') {
    args = { id: String(fields.id || '').trim(), layers: integer(fields.layers) };
    if (String(fields.count || '').trim()) args.count = integer(fields.count);
  } else if (cmd === 'pick') {
    args = { slot: integer(fields.slot), id: String(fields.id || '').trim() };
  } else if (cmd === 'shopLevel') {
    args = { level: integer(fields.level) };
  } else if (cmd === 'filter') {
    // an empty box clears the filter; ids are the data table's bond ids
    const bonds = String(fields.bonds || '').split(',').map((s) => s.trim()).filter(Boolean);
    args = { bonds, mode: fields.mode === 'all' ? 'all' : 'any' };
  } else if (cmd === 'deployCap') {
    args = { value: integer(fields.cap) };
  } else if (cmd === 'refreshFree') {
    args = { count: integer(fields.count) };
  } else if (cmd === 'ops') {
    // both numbers are optional, but at least one must be filled (the shared parser refuses an empty body)
    args = { id: String(fields.id || '').trim() };
    if (String(fields.potential || '').trim()) args.potential = integer(fields.potential);
    if (String(fields.cultivation || '').trim()) args.cultivate = integer(fields.cultivation);
  } else if (cmd === 'timers') {
    args = { on: fields.timerMode !== 'hold' };
  } else if (cmd === 'diyRefresh') {
    args = {};
  } else if (cmd === 'map') {
    args = { id: String(fields.id || '').trim() };
  } else args = { id: String(fields.id || '').trim() };
  return parseTestPluginArgs(cmd, args);
}
