// Opt-in 防治倒转区: actual shared-pool damage only; rejected damage is never banked.
// Pure ESM shared by the authoritative simulation and deterministic display replicas.
export class BossQuota {
  constructor(maxHp, { players = [], unlockAt = 0 } = {}) {
    this.players = Object.freeze([...new Set(players.filter(id => typeof id === 'string' && id))]);
    this.unlockAt = Number.isFinite(unlockAt) && unlockAt >= 0 ? unlockAt : 0;
    this.share = maxHp / Math.max(1, this.players.length);
    this.perPlayer = new Map(this.players.map(id => [id, 0]));
    this.completed = new Map(this.players.map(id => [id, null]));
    // Only floating-point dust, not the old <1 HP cleanup (which could exceed a player's quota).
    this.epsilon = Number.EPSILON * Math.max(1, maxHp) * 16;
  }

  damage(playerId, amount, time, hp) {
    if (!Number.isFinite(amount) || amount <= 0 || !(hp > 0)) return 0;
    const known = this.perPlayer.has(playerId);
    const active = !Number.isFinite(time) || time < this.unlockAt;
    if (active && !known) return 0;
    const before = known ? this.perPlayer.get(playerId) : 0;
    const remaining = active ? Math.max(0, this.share - before) : hp;
    let dealt = Math.min(hp, amount, remaining);
    // Three (or more) equal shares must empty the pool despite double rounding.
    if (dealt > 0 && hp - dealt <= this.epsilon && amount + this.epsilon >= hp && remaining + this.epsilon >= hp) dealt = hp;
    if (known && dealt > 0) {
      const total = before + dealt;
      this.perPlayer.set(playerId, total);
      if (this.completed.get(playerId) === null && total + this.epsilon >= this.share && Number.isFinite(time)) {
        this.completed.set(playerId, time);
      }
    }
    return dealt;
  }

  snapshot() {
    return {
      players: [...this.players], unlockAt: this.unlockAt, share: this.share,
      completed: this.players.map(playerId => ({ playerId, time: this.completed.get(playerId) })),
      perPlayer: this.players.map(playerId => ({ playerId, damage: this.perPlayer.get(playerId) })),
    };
  }
}
