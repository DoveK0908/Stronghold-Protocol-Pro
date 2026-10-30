import { N_ } from './i18n.js';

/** Community AI identities. Art is display-only and never changes the host's rules or operator roster. */
export const ELITE_RECRUITS = Object.freeze([
  Object.freeze({ id: 'arturia', name: N_('阿尔图罗'), char: 'char_245_cello', band: 'band_paganini', version: '0.3.0' }),
  Object.freeze({ id: 'lavinia', name: N_('拉维妮娅'), char: 'char_4065_judge', band: 'band_chiave', version: '0.3.0' }),
  Object.freeze({ id: 'zumama', name: N_('祖玛玛'), char: 'char_416_zumama', band: 'band_pepe', version: '0.2.0' }),
]);

export const eliteRecruit = id => ELITE_RECRUITS.find(r => r.id === id) || null;

/** Force the corresponding E2 default art, regardless of another player's card or outfit preferences. */
export function eliteCard(seat) {
  const rec = seat?.isBot && eliteRecruit(seat.botPersona);
  return rec ? { charId: rec.char, avatar: rec.char, look: '', avatarLook: '' } : null;
}
