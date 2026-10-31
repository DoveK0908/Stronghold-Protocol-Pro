// Native, opt-in room test tools. Reuse match primitives, never enable test mode or install global hooks.
// Receipts and rate limits are match-local, private and transient; no payload/argument audit is kept.
import { ERR, PHASE } from '../../../shared/constants.js';
import { cultivationCharIds, loadoutOptions, MODULE_NONE } from '../../../shared/protocol.js';
import { CULTIVATE_DEFAULT, POTENTIAL_DEFAULT } from '../../../shared/potential.js';
import { isTestPluginCommand, parseTestPluginMessage, TEST_PLUGIN_RATE_COUNT, TEST_PLUGIN_RATE_WINDOW_MS } from '../../../shared/testPlugin.js';
import { stageWithBenchExpand } from '../../../shared/benchExpand.js';
import { buildNormalWave, customSpawns } from '../waves.js';
import { OK, fail } from './common.js';

export class MatchTestPlugin {
  applyTestPlugin(ps, msg) {
    if (this.experimental.luckConsole !== true) return fail(ERR.TEST_FORBIDDEN);
    if (!ps || this.players.get(ps.playerId) !== ps || ps.isBot || ps.left) return fail(ERR.NOT_IN_ROOM);
    if (ps.spectator) return fail(ERR.SPECTATOR);
    if (this.disposed || this.ended || this.phase === PHASE.RESULT) return fail(ERR.WRONG_PHASE);
    if (!ps.alive || !(ps.lp > 0) || ps.pendingDeath) return fail(ERR.ELIMINATED);
    // Allocate only on an eligible enabled request; the catalogue bounds the number of buckets.
    if (!this._testPlugin) this._testPlugin = new Map();
    let state = this._testPlugin.get(ps.playerId);
    if (!state) {
      state = { actions: 0, last: null, rate: new Map() };
      this._testPlugin.set(ps.playerId, state);
    }
    const cmd = isTestPluginCommand(msg?.cmd) ? msg.cmd : 'invalid';
    const reply = (res) => {
      state.last = { cmd, ok: !res.error, ...(res.error ? { code: res.error } : {}) };
      if (!res.error) state.actions++;
      this.markPrivate(ps);
      return res;
    };
    const now = this.sched.now();
    const stamps = (state.rate.get(cmd) || []).filter((at) => now >= at && now - at < TEST_PLUGIN_RATE_WINDOW_MS);
    state.rate.set(cmd, stamps);
    if (stamps.length >= TEST_PLUGIN_RATE_COUNT) return reply(fail(ERR.RATE));
    stamps.push(now);
    const parsed = parseTestPluginMessage(msg);
    if ('error' in parsed) return reply(fail(parsed.error));
    const blocked = this._testQuiet();
    if (blocked) return reply(blocked);
    return reply(this._applyTestPlugin(ps, cmd, parsed.args));
  }

  _applyTestPlugin(ps, cmd, args) {
    switch (cmd) {
      case 'funds': return this._testFunds(ps, args.amount);
      case 'chess': return this._testChess(ps, args.id);
      case 'item': return this._testItem(ps, args.id);
      case 'shop': return this._testShop(ps, args.slots);
      case 'shopSlots': return this._testPluginShopSlots(ps, args.slots);
      case 'pick': return this._testPluginPick(ps, args.slot, args.id);
      case 'shopLevel': return this._testPluginShopLevel(ps, args.level);
      case 'filter': return this._testPluginFilter(ps, args.bonds, args.mode);
      case 'map': return this._testPluginMap(ps, args.id);
      case 'deployCap': return this._testPluginDeployCap(ps, args.value);
      case 'refreshFree': return this._testPluginRefreshFree(ps, args.count);
      case 'bounty': return this._testPluginBounty(ps, args.id);
      case 'wave': return this._testPluginWave(ps, args.id);
      case 'enemies': return this._testPluginEnemies(ps, args.mode, args.list);
      case 'boss': return this._testPluginBoss(ps, args.id);
      case 'ops': return this._testPluginOps(ps, args);
      case 'op': return this._testPluginOp(ps, args);
      case 'diyRefresh': return this._testPluginDiyRefresh(ps);
      case 'bond': return this._testBond(ps, args.id, args.layers, args.count);
      case 'lp':
        if (this.teamLp != null) return fail(ERR.WRONG_PHASE);
        ps.lp = args.value;
        ps.dirty();
        this.markPrivate(ps);
        return OK;
      case 'strategy': {
        const lp = ps.lp;
        const res = this._testStrategy(ps, args.id, false);
        // pickBand initializes LP during the draft; this plugin never resets a seat's LP.
        if (!res.error && ps.lp !== lp) { ps.lp = lp; ps.dirty(); this.markPrivate(ps); }
        return res;
      }
      case 'level': return ps.levelUp();
      case 'round':
        // Native jumps settle broken LP; never finalize a teammate waiting for rescue by skipping a round.
        if (this.order.some((p) => p.pendingDeath)) return fail(ERR.WRONG_PHASE);
        return this._testRound(ps, args.round);
      default: return fail(ERR.BAD_MSG);
    }
  }

  /**
   * Put one chosen card into an unsold shop slot without buying it. The slot's side of the layout decides the kind,
   * so a caller cannot smuggle an item into a chess slot. No funds move and the roll queues are untouched.
   */
  _testPluginPick(ps, slot, id) {
    if (this.phase !== PHASE.PREP || ps.ready) return fail(ERR.WRONG_PHASE);
    const layout = ps.shop.layout || { chess: ps.shop.slots.length, item: 0 };
    const total = layout.chess + layout.item;
    if (slot >= total) return fail(ERR.BAD_TARGET);
    const kind = slot < layout.chess ? 'chess' : 'item';
    const rec = kind === 'chess' ? ps.gd.chess(id) : ps.gd.item(id);
    // a 自选 slot sells only as this player's own composed piece, as the native shop does
    if (!rec || (kind === 'chess' && rec.isDiy && !rec.diyFor)) return fail(ERR.BAD_TARGET);
    const cur = ps.shop.slots[slot];
    if (cur && cur.sold) return fail(ERR.SOLD_OUT);
    ps.shop.slots[slot] = {
      kind, id,
      basePrice: kind === 'chess' ? ps.gd.chessPrice(id) : ps.gd.itemPrice(id),
      frozen: !!ps.shop.frozen, sold: false,
    };
    ps.dirty();
    return OK;
  }

  /**
   * Replace the whole current shelf without charging: the caller sends one entry per slot of the current layout
   * (`null` empties that slot), so the front end can hand back the shelf it shows. Same gate as `pick` (PREP, not
   * ready); a queued next-roll shop is untouched — this command writes the shelf the players see now.
   */
  _testPluginShopSlots(ps, slots) {
    if (this.phase !== PHASE.PREP || ps.ready) return fail(ERR.WRONG_PHASE);
    const spec = ps.gd.shopSlots(ps.shop.level);
    const layout = ps.shop.layout || { chess: spec.chess, item: spec.item };
    const total = layout.chess + layout.item;
    if (slots.length !== total) return fail(ERR.BAD_TARGET, `shopSlots|${JSON.stringify({ chess: layout.chess, item: layout.item })}`);
    const next = [];
    for (let i = 0; i < total; i++) {
      const s = slots[i];
      if (s === null) { next.push(null); continue; }
      const kind = i < layout.chess ? 'chess' : 'item';
      if (s.kind !== kind) return fail(ERR.BAD_TARGET, 'shopSlots|kind');
      const rec = kind === 'chess' ? ps.gd.chess(s.id) : ps.gd.item(s.id);
      // a 自选 slot sells only as this player's own composed piece, as the native shop does
      if (!rec || (kind === 'chess' && rec.isDiy && !rec.diyFor)) return fail(ERR.BAD_TARGET, 'shopSlots|id');
      next.push({
        kind,
        id: s.id,
        basePrice: kind === 'chess' ? ps.gd.chessPrice(s.id) : ps.gd.itemPrice(s.id),
        frozen: !!ps.shop.frozen,
        sold: false,
      });
    }
    ps.shop.slots = next;
    ps.shop.layout = { chess: layout.chess, item: layout.item };
    ps.dirty();
    this.markPrivate(ps);
    return OK;
  }

  /**
   * Change one operator this seat owns on the board / hand / 临时整备区, by chessId: 潜能, 练度, 携带技能, 模组, 盟约
   * (multi), 特质 (multi) and the raw 攻击 / 防御 / 生命 / 法抗 / 攻速 / 费用. Stored per chessId in `ps._testOps` and
   * read by the battle input and the prep effect pass; 潜能/练度 also write the charId-level `ps.ops` the native
   * cultivation path reads, so the next battle and the star display agree.
   */
  _testPluginOp(ps, { id, potential, cultivate, skillIndex, moduleId, bonds, traits, stats }) {
    const pieces = [];
    for (const piece of [...ps.board.values(), ...ps.hand, ...ps.temp]) {
      if (!piece || piece.kind !== 'chess' || piece.id !== id) continue;
      const rec = ps.gd.chess(piece.id);
      // a 补位 stand-in or a prototype 自选 pick is not the operator itself
      if (!rec || rec.standInFor || rec.diyProto) continue;
      pieces.push(piece);
    }
    if (!pieces.length) return fail(ERR.BAD_TARGET, 'op|id');
    const rec = ps.gd.chess(id);
    const next = { ...(ps._testOps && ps._testOps[id] ? ps._testOps[id] : {}) };
    if (potential !== undefined) next.potential = potential;
    if (cultivate !== undefined) next.cultivate = cultivate;
    if (skillIndex !== undefined || moduleId !== undefined) {
      // The native 干员调配 choice set (shared/protocol.js loadoutOptions): the record's skills at both the normal and
      // the elite status, and the elite's modules + MODULE_NONE. `moduleId: null` restores the default module, 'none'
      // removes it, an id selects one; an operator without an elite record cannot be module-less on purpose.
      const golden = rec.goldenId ? ps.gd.chess(rec.goldenId) || null : null;
      const opt = loadoutOptions(rec, golden);
      if (skillIndex !== undefined) {
        if (!opt.skills.includes(skillIndex)) return fail(ERR.BAD_TARGET, 'op|skill');
        next.skillIndex = skillIndex;
      }
      if (moduleId !== undefined) {
        if (moduleId === MODULE_NONE) {
          if (!golden) return fail(ERR.BAD_TARGET, 'op|module');
        } else if (moduleId !== null && !opt.modules.includes(moduleId)) return fail(ERR.BAD_TARGET, 'op|module');
        next.moduleId = moduleId;
      }
    }
    if (bonds !== undefined) {
      for (const b of bonds) if (!ps.gd.bond(b)) return fail(ERR.BAD_TARGET, 'op|bond');
      next.bonds = [...bonds];
    }
    if (traits !== undefined) {
      const garrisons = ps.gd.raw.garrisons || {};
      for (const t of traits) if (!Object.hasOwn(garrisons, t) || !garrisons[t]) return fail(ERR.BAD_TARGET, 'op|trait');
      next.traits = [...traits];
    }
    if (stats !== undefined) next.stats = { ...(next.stats || {}), ...stats };
    ps._testOps = Object.freeze({ ...(ps._testOps || {}), [id]: Object.freeze(next) });
    // 潜能/练度 are charId-level in the native rules (shared/potential.js cultivationOf)
    if ((potential !== undefined || cultivate !== undefined) && rec.charId) {
      const prev = ps.ops && ps.ops[rec.charId] ? ps.ops[rec.charId] : null;
      const merged = Object.freeze({
        potential: potential !== undefined ? potential : (prev ? prev.potential : POTENTIAL_DEFAULT),
        cultivate: cultivate !== undefined ? cultivate : (prev ? prev.cultivate : CULTIVATE_DEFAULT),
      });
      ps.ops = Object.freeze({ ...ps.ops, [rec.charId]: merged });
    }
    // a summon-owning piece already on the field is reconciled like the native setLoadout path does
    for (const piece of pieces) ps._reconcileTokensFor(piece);
    ps.dirty();
    if (ps.alive) ps.recompute();
    this.markPrivate(ps);
    return OK;
  }

  /**
   * Jump the 调度中心 to a level without charging: a test tool, not a purchase. The new layout opens empty slots when
   * it grows and drops the tail of each side when it shrinks. A queued shop is refused because its layout was
   * validated against the old level.
   */
  _testPluginShopLevel(ps, level) {
    if (this.phase === PHASE.INFO_CHECK || this.phase === PHASE.BAND_DRAFT || !ps.bandId) return fail(ERR.WRONG_PHASE);
    if (ps._testShopNext) return fail(ERR.WRONG_PHASE);
    if (level > ps.gd.maxShopLevel) return fail(ERR.BAD_TARGET);
    if (level === ps.shop.level) return OK;
    const spec = ps.gd.shopSlots(level);
    const old = ps.shop.layout || { chess: ps.shop.slots.length, item: 0 };
    const oldChess = ps.shop.slots.slice(0, old.chess);
    const oldItems = ps.shop.slots.slice(old.chess);
    ps.shop.level = level;
    ps.shop.upgradePrice = ps.gd.upgradeBase(level) ?? 0;
    if (spec.chess >= old.chess && spec.item >= old.item) ps._openLevelSlots();
    else {
      const chess = oldChess.slice(0, spec.chess);
      // loop-cap: at most the level's (<= TEST_SHOP_SLOTS_MAX) chess slots
      while (chess.length < spec.chess) chess.push(null);
      const items = oldItems.slice(0, spec.item);
      // loop-cap: at most the level's (<= TEST_SHOP_SLOTS_MAX) item slots
      while (items.length < spec.item) items.push(null);
      ps.shop.slots = [...chess, ...items];
      ps.shop.layout = { chess: spec.chess, item: spec.item };
    }
    ps.dirty();
    return OK;
  }

  /**
   * Own-seat filter for future random shop rolls: 'any' keeps a chess with one of the bonds, 'all' one with every bond.
   * Cards already on the shelf stay; an empty list clears the filter. Item slots keep the native rules.
   */
  _testPluginFilter(ps, bonds, mode) {
    ps._testShopFilter = bonds.length ? { bonds: [...bonds], mode } : null;
    ps.dirty();
    return OK;
  }

  /**
   * Switch the room's stage (both halves of a boss field follow). Pieces that may no longer stand on the new terrain
   * are withdrawn to the hand by the normal legality pass. Refused in the boss rounds, whose field is not a normal map.
   */
  _testPluginMap(ps, id) {
    const base = this.gd.stage(id);
    if (!base) return fail(ERR.BAD_TARGET);
    if (this.gd.bossRound > 0 && this.round >= this.gd.bossRound) return fail(ERR.WRONG_PHASE);
    if (this.stageId === id) return OK;
    this.stageId = id;
    this.stage = this.benchExpand ? stageWithBenchExpand(base) : base;
    for (const p of this.order) {
      p.invalidateDeployMap();
      if (p.alive) p.recompute();
    }
    this.markPublic();
    return OK;
  }

  /**
   * Raise the own seat's deploy cap floor (the same field the native setDeployCapAtLeast effect writes). It only ever
   * raises — lowering would fight the bond / effect grants that read it — and no piece is placed or removed here.
   */
  _testPluginDeployCap(ps, value) {
    if (value > ps.deployCapMin) {
      ps.deployCapMin = value;
      ps.dirty();
    }
    return OK;
  }

  /**
   * Set the own seat's free-refresh counter. The native refresh spends it first (economy.js refresh), so the rest of
   * the shop's price rules are untouched.
   */
  _testPluginRefreshFree(ps, count) {
    ps.shop.freeRefreshes = count;
    ps.dirty();
    return OK;
  }

  /**
   * Add one own-seat bounty on a native enemy: the same shape the strategy-draft bounty card uses (addBounty), so the
   * payout runs through the ordinary battle accounting.
   */
  _testPluginBounty(ps, id) {
    const enemy = this.gd.enemy(id);
    if (!enemy || this.gd.inactiveEnemies.has(id)) return fail(ERR.BAD_TARGET);
    const added = this.addBounty(ps, {
      enemyKey: id,
      name: typeof enemy.name === 'string' && enemy.name ? enemy.name : id,
      coin: 0,
      payout: 'kill',
      count: 1,
    });
    return added ? OK : fail(ERR.BAD_TARGET);
  }

  /**
   * Swap the enemy template of the round in progress (the battle this round will field). The pick drawn for the round
   * is reused, so a test swap never moves the random stream; the wave is rebuilt in place and every living seat's
   * next-enemies preview is refreshed. Refused in the boss / hidden rounds, whose field is composed by buildBossWave.
   */
  _testPluginWave(ps, id) {
    if (!this.wave) return fail(ERR.WRONG_PHASE);
    const templateId = this._testPluginWaveTemplate(id);
    const tpl = templateId ? this.gd.wave(templateId) : null;
    if (!tpl || tpl.kind !== 'normal' || tpl.bossId) return fail(ERR.BAD_TARGET);
    this.wave = buildNormalWave(this.gd, this.rngWaves, this.factions, this.round, { templateId, pick: this.wave.pick });
    for (const p of this.alivePlayers()) this.markPrivate(p);
    return OK;
  }

  /** The template a request resolves to: the id itself, or its solo / co-op twin (the rule buildBossWave uses). */
  _testPluginWaveTemplate(id) {
    if (this.isSolo && !/_s$/.test(id) && this.gd.wave(`${id}_s`)) return `${id}_s`;
    if (!this.isSolo && /_s$/.test(id) && this.gd.wave(id.replace(/_s$/, ''))) return id.replace(/_s$/, '');
    return id;
  }

  /**
   * Set one operator's 潜能 (1–6) / 练度 (0–3) for this seat: the same `ps.ops` entry 干员调配 writes, which
   * cultivationFor → battleInput turns into the numbers the next battle fights at (shared/potential.js). Only an
   * operator this mode lets the player cultivate is accepted; a summon-owning piece already on the field is
   * reconciled like the native setLoadout path does, and nothing is bought or moved.
   */
  _testPluginOps(ps, { id, potential, cultivate }) {
    if (!cultivationCharIds(this.gd.raw.chess, this.gd.raw.backups).has(id)) return fail(ERR.BAD_TARGET);
    const prev = ps.ops && ps.ops[id] ? ps.ops[id] : null;
    const next = Object.freeze({
      potential: potential !== undefined ? potential : (prev ? prev.potential : POTENTIAL_DEFAULT),
      cultivate: cultivate !== undefined ? cultivate : (prev ? prev.cultivate : CULTIVATE_DEFAULT),
    });
    if (prev && prev.potential === next.potential && prev.cultivate === next.cultivate) return OK;
    ps.ops = Object.freeze({ ...ps.ops, [id]: next });
    for (const piece of [...ps.board.values(), ...ps.hand, ...ps.temp]) {
      const rec = piece && piece.kind === 'chess' ? ps.gd.chess(piece.id) : null;
      // a 补位 stand-in or a prototype 自选 pick has no potential / 练度 of its own (cultivationOf)
      if (rec && rec.charId === id && !rec.standInFor && !rec.diyProto) ps._reconcileTokensFor(piece);
    }
    ps.dirty();
    if (ps.alive) ps.recompute();
    this.markPrivate(ps);
    return OK;
  }

  /**
   * Rewrite (or append to) the current round's enemy list: the same spawn specs the round's own template produced,
   * with this round's multipliers. RNG-free. Only the prep of a normal round: a boss field's composition is planned by
   * buildBossWave, and a battle in progress owns its copies of the spawns.
   */
  _testPluginEnemies(ps, mode, list) {
    if (this.phase !== PHASE.PREP || !this.wave) return fail(ERR.WRONG_PHASE);
    if (this.gd.bossRound > 0 && this.round >= this.gd.bossRound) return fail(ERR.WRONG_PHASE);
    for (const it of list) {
      if (!this.gd.enemy(it.id) || this.gd.inactiveEnemies.has(it.id)) return fail(ERR.BAD_TARGET, 'enemies');
    }
    const added = customSpawns(this.gd, this.round, list, mode === 'append' ? this.wave.spawns : [], this.wave.routes);
    this.wave.spawns = mode === 'replace' ? added : [...this.wave.spawns, ...added];
    for (const p of this.alivePlayers()) this.markPrivate(p);
    return OK;
  }

  /**
   * Fight a chosen leader now (迎战首领): jump to its boss round with `this.bossId` / `this.hiddenBossId` set, and
   * remember the raid so its victory returns to the round before it instead of ending the match (bossRounds._finishFinal).
   */
  _testPluginBoss(ps, id) {
    if (this.ended) return fail(ERR.WRONG_PHASE);
    if (this.phase === PHASE.INFO_CHECK || this.phase === PHASE.BAND_DRAFT || !ps.bandId) return fail(ERR.WRONG_PHASE);
    const bosses = this.gd.raw.bosses;
    if (!bosses || !Object.hasOwn(bosses, id) || !bosses[id]) return fail(ERR.BAD_TARGET, 'boss');
    const bossRound = this.gd.bossRound;
    if (!(bossRound > 0)) return fail(ERR.WRONG_PHASE);
    const hiddenRound = this.gd.hiddenRound;
    const hidden = bosses[id].hidden === true;
    const target = hidden ? (hiddenRound || bossRound) : bossRound;
    // a win hands the match back to the round before the leader phase: the owner's answer to 迎战首领 is "回到第13回合",
    // so a hidden raid at 15 returns to 13 too, not to the boss round 14 it would replay.
    const returnRound = Math.max(1, Math.min(target - 1, bossRound - 1));
    this._testBossRaid = { bossId: id, hidden, round: target, returnRound };
    if (hidden) {
      this.hiddenBossId = id;
      // a mode without a separate hidden-core round fields its leader on the boss round, whose plan reads `bossId`
      if (!hiddenRound || hiddenRound === bossRound) this.bossId = id;
    } else {
      this.bossId = id;
    }
    this.eliminateBroken();
    if (!this.alivePlayers().length) { this.finish({ victory: false, reason: 'eliminated' }); return OK; }
    this.setDeadline(0);
    this.cancel(this._turnTimer);
    this._turnToken++;
    this.startRound(target, () => {
      if (hidden && hiddenRound && hiddenRound !== bossRound && this.round === hiddenRound && this.teamLp == null) this._openTeamLp();
    });
    return OK;
  }

  /**
   * Top up the seat's own 自选 copies: every slotted pick's stock returns to its cap (the draw rules, tiers and shop
   * levels are untouched). A seat without 自选 picks has no stock to restock.
   */
  _testPluginDiyRefresh(ps) {
    if (!ps.diyStock || !ps.diyStock.entries || !ps.diyStock.entries.size) return fail(ERR.BAD_TARGET);
    let changed = false;
    for (const e of ps.diyStock.entries.values()) {
      if (e.left !== e.cap) { e.left = e.cap; changed = true; }
    }
    if (changed) { ps.dirty(); this.markPrivate(ps); }
    return OK;
  }
}
