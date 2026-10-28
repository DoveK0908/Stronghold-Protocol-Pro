import { COMPUTATION_OWNER } from './aiCompute/identity.js';

const views = new WeakMap();

/** Frozen community policies see only their own shared-pool group in expanded rooms. */
export function eliteScope(match, player) {
  if (!match.capacityExperiment || !player || match.poolGroups?.length < 2) return match;
  const group = match.poolGroups?.find(g => g.playerIds.includes(player.playerId));
  if (!group) return match;
  let players = views.get(match);
  if (!players) { players = new WeakMap(); views.set(match, players); }
  if (!players.has(player)) {
    const ids = new Set(group.playerIds);
    const opts = { ...match.opts, seats: match.opts.seats.filter(s => ids.has(s.playerId)) };
    const members = new Map([...match.players].filter(([id]) => ids.has(id)));
    players.set(player, new Proxy(match, {
      get(target, key) {
        if (key === COMPUTATION_OWNER) return match;
        if (key === 'opts') return opts;
        if (key === 'pool') return group.pool;
        if (key === 'players') return members;
        if (key === 'order') return target.order.filter(p => ids.has(p.playerId));
        if (key === 'alivePlayers') return () => target.alivePlayers().filter(p => ids.has(p.playerId));
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set: (target, key, value) => Reflect.set(target, key, value, target),
    }));
  }
  return players.get(player);
}
