// Frozen upstream drivers; Pro supplies the player's own shared-pool scope.
import * as runtime from './runtime.js';
import { eliteScope } from '../../eliteScope.js';
export { BAND, CORE } from './runtime.js';
export const isZumama = (m, ps) => ps?.isBot === true && m.opts?.seats?.some(s => s.playerId === ps.playerId && s.isBot && s.botPersona === 'zumama') === true;
export const policyView = (m, ps) => runtime.policyView(eliteScope(m, ps), ps);
export const pickCard = (m, ps, cards, available) => runtime.pickCard(eliteScope(m, ps), ps, cards, available);
export const prepBegin = (m, ps) => runtime.prepBegin(eliteScope(m, ps), ps);
export const prepEnd = (m, ps, job) => runtime.prepEnd(eliteScope(m, ps), ps, job);
