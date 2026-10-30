import { html, Button, Modal } from './components.js';
import { useLayoutEffect, useState } from '../../vendor/hooks.module.js';
import { t, tc } from '../../../shared/i18n.js';
import { MAX_SEATS } from '../../../shared/constants.js';
import { EXPERIMENTAL_NUMERIC, EXPERIMENTAL_OPTIONAL, EXPERIMENTAL_OPTIONAL_DEFAULTS, bannedStages, numericValue, optionalValue } from '../../../shared/experimental.js';
import { PLAYER_CAPACITIES, isPlayerCapacity, roomCapacity } from '../../../shared/playerCapacity.js';

export function experimentalOptions(input) {
  const capacity = roomCapacity('coop', input);
  const banned = bannedStages(input);
  return { revivalEnabled: input?.revivalEnabled === true, disableSharedPool: input?.disableSharedPool === true,
    ...(capacity > MAX_SEATS && input?.disableDuckLord === true ? { disableDuckLord: true } : {}),
    ...(capacity === MAX_SEATS ? {} : { playerCapacity: capacity }),
    // 首领血量 (experimental `bossHpPercent`): a room only carries it when it differs from the official 100%
    ...Object.keys(EXPERIMENTAL_NUMERIC).reduce((out, key) => {
      const next = numericValue(input ?? {}, key);
      if (next !== EXPERIMENTAL_NUMERIC[key].def) out[key] = next;
      return out;
    }, {}),
    // Only the switches that differ from their own default
    ...EXPERIMENTAL_OPTIONAL.reduce((out, key) => {
      const next = optionalValue(input ?? {}, key);
      if (next !== EXPERIMENTAL_OPTIONAL_DEFAULTS[key]) out[key] = next;
      return out;
    }, {}),
    // 地图禁用 (玩法#03): only a non-empty list rides the wire, so an ordinary room keeps its two-flag shape
    ...(banned.length ? { bannedStages: banned } : {}) };
}

/** Whether any option differs from a standard room's (the room's 实验性选项 button is then marked). */
/**
 * The copy of every rule switch: [name, one-line explanation] (owner 2026-10-28: one sentence unless the rule needs two).
 * 设置 → 开房默认 (ui/roomDefaultsSection.js) renders this same table, so the two surfaces can never drift apart.
 */
export function experimentalCopy(key) {
  if (key === 'revivalEnabled') return [t('队友复活'), t('花 10 生命抵消队友的一次死亡，每人每局只能获救一次。')];
  if (key === 'disableSharedPool') return [t('禁用共享卡池'), t('每位博士使用独立卡池，不再争抢同一批干员。')];
  if (key === 'playerCapacity') return [t('扩展同盟人数'), t('开启后可开 8／12／16／20 人局；全员需刷新页面，人数越多等待与演算越久。')];
  if (key === 'disableDuckLord') return [t('禁用鸭爵策略'), t('本局不能选择鸭爵策略，其他策略不受影响。')];
  if (key === 'luckConsole') return [t('测试插件'), t('局内调整自己的资金、生命、商店与盟约；跳回合影响全局，仅限非战斗阶段。')];
  if (key === 'bossHitSoftCap') return [t('限伤改为封顶'), t('本会被限伤吃掉的那一下改为按 299999 结算，不再掉 0。')];
  if (key === 'bossQuota') return [t('防治倒转区'), t('每人配额为初始共享血池 ÷ 入场存活人数；超出配额不扣血，但伤害与 DPS 照常统计。只记录完成配额的用时与排名，两轮独立、同秒并列；不影响胜负与奖励，超时扣血阶段解除限伤。')];
  if (key === 'stateCarry') return [t('联防状态继承'), t('敌人保留生命值与阶段，退场干员保留剩余再部署时间；等待时暂停计时，仅本回合联防生效')];
  if (key === 'bossHpPercent') return [t('首领血量'), t('首领共享血池的百分比，100% 为官方血量。')];
  if (key === 'prepUnlimited') return [t('无限休整期'), t('休整期正常倒计时，归零后不强制结束，全员点「准备就绪」后才开打。')];
  if (key === 'benchExpand') return [t('整备区扩容'), t('整备区从 10 格扩到 13 格，多带三个单位。')];
  if (key === 'goldPreview') return [t('查看下回合资金'), t('休整期显示下回合开局到账的资金；只是预估，实际可能变化。')];
  if (key === 'shopLeft') return [t('牌库剩余张数'), t('商店卡片上显示该干员在牌库的剩余张数。')];
  if (key === 'speedVote') return [t('二倍速'), t('局内顶栏的二倍速投票按钮；关闭后整局保持一倍速。')];
  if (key === 'bannedStages') return [t('禁用战场'), t('勾选的战场本局不会出现，至少保留一张。')];
  return null;
}

export function experimentalChanged(input) {
  const options = experimentalOptions(input);
  return options.revivalEnabled || options.disableSharedPool || !!options.disableDuckLord || !!options.playerCapacity
    || Array.isArray(options.bannedStages) && options.bannedStages.length > 0
    || Object.keys(EXPERIMENTAL_NUMERIC).some(key => options[key] !== undefined)
    || EXPERIMENTAL_OPTIONAL.some(key => options[key] !== undefined);
}

export function experimentalSummary(input) {
  const options = experimentalOptions(input);
  const summary = t('复活 {0} · 共享卡池 {1}', { 0: options.revivalEnabled ? t('开启') : tc('toggle', '关闭'), 1: options.disableSharedPool ? tc('toggle', '关闭') : t('开启') });
  let rules = options.disableDuckLord ? `${summary} · ${t('禁用鸭爵策略')}` : summary;
  if (options.luckConsole) rules = `${rules} · ${t('测试插件')}`;
  if (options.bossHitSoftCap === true) rules = `${rules} · ${t('限伤改为封顶')}`;
  if (options.bossQuota === true) rules = `${rules} · ${t('防治倒转区')}`;
  if (options.stateCarry === true) rules = `${rules} · ${t('联防状态继承')}`;
  if (typeof options.bossHpPercent === 'number') rules = `${rules} · ${t('首领血量 {n}%', { n: options.bossHpPercent })}`;
  if (options.prepUnlimited === true) rules = `${rules} · ${t('无限休整期')}`;
  if (options.benchExpand === true) rules = `${rules} · ${t('整备区扩容')}`;
  if (options.goldPreview === true) rules = `${rules} · ${t('显示下回合资金')}`;
  if (options.shopLeft === false) rules = `${rules} · ${t('不显示牌库剩余张数')}`;
  if (options.speedVote === false) rules = `${rules} · ${t('关闭二倍速')}`;
  if (Array.isArray(options.bannedStages) && options.bannedStages.length) rules = `${rules} · ${t('禁用战场 {n} 张', { n: options.bannedStages.length })}`;
  return options.playerCapacity ? t('{rules} · {n} 人模式', { rules, n: options.playerCapacity }) : rules;
}

export function ExperimentalSummary({ value }) {
  return html`<span class="experimental-summary">${experimentalSummary(value)}</span>`;
}

// Keep the text draft independent of room.state. RoomScreen re-renders every second (clock/ping),
// including while this field is focused and before its blur request has received an authoritative echo.
function BossHpInput({ value, busy, open, onBlur, ...props }) {
  const [draft, setDraft] = useState(String(value));
  useLayoutEffect(() => {
    // A settled request (including a refusal) or reopening adopts the authoritative value.
    if (!busy) setDraft(String(value));
  }, [value, busy, open]);
  return html`<input ...${props} value=${draft} onInput=${e => setDraft(e.currentTarget.value)}
    onBlur=${e => { onBlur(e); setDraft(e.currentTarget.value); }} />`;
}

export function ExperimentalOptions({ open, value, mode = 'coop', source = 'private', editable = false, busy = false, stages = [], onChange, onClose }) {
  const options = experimentalOptions(value);
  const capacity = roomCapacity(mode, options);
  const banned = new Set(Array.isArray(options.bannedStages) ? options.bannedStages : []);
  const choices = (Array.isArray(stages) ? stages : []).filter(s => s && typeof s.id === 'string');
  const change = (field, checked) => {
    if (editable && !busy) onChange?.({ ...options, [field]: checked });
  };
  // 地图禁用 (玩法#03): the checkbox means "ban this stage", matching the heading. Never ban every stage — the
  // click that would empty the pool is ignored, so the server always has something to draw.
  const toggleStage = (id, disable) => {
    if (!editable || busy) return;
    const next = new Set(banned);
    if (disable) next.add(id); else next.delete(id);
    if (choices.length > 1 && choices.every(s => next.has(s.id))) next.delete(id);
    const list = [...next].filter(x => choices.some(s => s.id === x)).sort();
    const { bannedStages: _ignored, ...rest } = options;
    onChange?.(list.length ? { ...rest, bannedStages: list } : rest);
  };
  // 首领血量 (experimental `bossHpPercent`): the field is plain text while it is being typed and the room is only asked
  // on blur or Enter — snapping to the rule's step and clamping to its range there, so typing "150" never passes through
  // 25 on the way (the rule's floor). BossHpInput owns the draft until that commit settles; 100 is the official HP.
  const BOSS_HP = EXPERIMENTAL_NUMERIC.bossHpPercent;
  const bossHp = numericValue(options, 'bossHpPercent');
  const commitBossHp = (e) => {
    const input = e.currentTarget;
    const raw = String(input.value ?? '').trim();
    const typed = raw ? Number(raw) : NaN;
    const snapped = Number.isFinite(typed)
      ? Math.max(BOSS_HP.min, Math.min(Math.floor(Number.MAX_SAFE_INTEGER / BOSS_HP.step) * BOSS_HP.step,
        Math.round(typed / BOSS_HP.step) * BOSS_HP.step))
      : bossHp;
    input.value = String(snapped);
    if (editable && !busy && snapped !== bossHp) onChange?.({ ...options, bossHpPercent: snapped });
  };
  const setCapacity = next => {
    if (!editable || busy || mode !== 'coop' || source === 'matchmaking' || !isPlayerCapacity(next)) return;
    const { playerCapacity, ...rules } = options;
    if (next === MAX_SEATS) {
      const { disableDuckLord, ...ordinary } = rules;
      onChange?.(ordinary);
    } else onChange?.({ ...rules, playerCapacity: next });
  };
  // Name + explanation of a switch: experimentalCopy is the one place that wording lives (设置 → 开房默认 reads it too).
  const ruleLabel = (key, helpId = null) => {
    const [name, note] = experimentalCopy(key);
    return html`<span><strong>${name}</strong><small id=${helpId ?? undefined}>${note}</small></span>`;
  };
  return html`<${Modal} open=${open} title=${t('实验性选项')} micro="EXPERIMENTAL" ariaLabel=${t('实验性选项')} trapFocus=${true}
      class="experimental-modal" onClose=${onClose}
      actions=${html`<${Button} icon="check" onClick=${onClose}>${t('完成')}<//>`}>
    <div class="experimental-options">
      <label class="experimental-option" for="experimental-revival">
        ${ruleLabel('revivalEnabled')}
        <input id="experimental-revival" type="checkbox" role="switch" checked=${options.revivalEnabled}
          disabled=${!editable || busy} onChange=${e => change('revivalEnabled', e.currentTarget.checked)} />
      </label>
      <label class="experimental-option" for="experimental-pool">
        ${ruleLabel('disableSharedPool')}
        <input id="experimental-pool" type="checkbox" role="switch" checked=${options.disableSharedPool}
          disabled=${!editable || busy} onChange=${e => change('disableSharedPool', e.currentTarget.checked)} />
      </label>
      ${mode === 'coop' && source !== 'matchmaking' ? html`<label class="experimental-option" for="experimental-multiplayer">
        ${ruleLabel('playerCapacity')}
        <input id="experimental-multiplayer" type="checkbox" role="switch" checked=${capacity > MAX_SEATS}
          disabled=${!editable || busy} onChange=${e => setCapacity(e.currentTarget.checked ? 8 : MAX_SEATS)} />
      </label>` : null}
      ${mode === 'coop' && source !== 'matchmaking' && capacity > MAX_SEATS ? html`<label class="experimental-capacity" for="experimental-capacity">
        <span>${t('人数模式')}</span>
        <select id="experimental-capacity" value=${capacity} disabled=${!editable || busy} onChange=${e => setCapacity(Number(e.currentTarget.value))}>
          ${PLAYER_CAPACITIES.map(n => html`<option key=${n} value=${n}>${t('{n} 人', { n })}</option>`)}
        </select>
      </label>` : null}
      ${mode === 'coop' && capacity > MAX_SEATS ? html`<label class="experimental-option" for="experimental-ducklord">
        ${ruleLabel('disableDuckLord')}
        <input id="experimental-ducklord" type="checkbox" checked=${options.disableDuckLord === true}
          disabled=${!editable || busy} onChange=${e => change('disableDuckLord', e.currentTarget.checked)} />
      </label>` : null}
      ${source !== 'matchmaking' ? html`<label class="experimental-option" for="experimental-luck-console">
        ${ruleLabel('luckConsole')}
        <input id="experimental-luck-console" type="checkbox" role="switch" checked=${options.luckConsole === true}
          disabled=${!editable || busy} onChange=${e => change('luckConsole', e.currentTarget.checked)} />
      </label>` : null}
      ${source !== 'matchmaking' ? html`<label class="experimental-option" for="experimental-hit-softcap">
        ${ruleLabel('bossHitSoftCap')}
        <input id="experimental-hit-softcap" type="checkbox" role="switch" checked=${options.bossHitSoftCap === true}
          disabled=${!editable || busy} onChange=${e => change('bossHitSoftCap', e.currentTarget.checked)} />
      </label>` : null}
      ${source !== 'matchmaking' ? html`<label class="experimental-option" for="experimental-boss-quota">
        ${ruleLabel('bossQuota', 'experimental-boss-quota-help')}
        <input id="experimental-boss-quota" type="checkbox" role="switch" checked=${options.bossQuota === true}
          aria-describedby="experimental-boss-quota-help" disabled=${!editable || busy}
          onChange=${e => change('bossQuota', e.currentTarget.checked)} />
      </label>` : null}
      ${source !== 'matchmaking' ? html`<label class="experimental-option" for="experimental-state-carry">
        ${ruleLabel('stateCarry', 'experimental-state-carry-help')}
        <input id="experimental-state-carry" type="checkbox" role="switch" checked=${options.stateCarry === true}
          aria-describedby="experimental-state-carry-help" disabled=${!editable || busy}
          onChange=${e => change('stateCarry', e.currentTarget.checked)} />
      </label>` : null}
      ${source !== 'matchmaking' ? html`<label class="experimental-option" for="experimental-boss-hp">
        <span><strong>${t('首领血量 {n}%', { n: bossHp })}</strong><small>${experimentalCopy('bossHpPercent')[1]}</small></span>
        <span class="experimental-number">
          <${BossHpInput} id="experimental-boss-hp" type="number" inputmode="numeric" min=${BOSS_HP.min} step=${BOSS_HP.step}
            value=${bossHp} busy=${busy} open=${open} disabled=${!editable || busy} onBlur=${commitBossHp}
            onKeyDown=${e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          <span aria-hidden="true">%</span>
        </span>
      </label>` : null}
      ${source !== 'matchmaking' ? html`<label class="experimental-option" for="experimental-prep-unlimited">
        ${ruleLabel('prepUnlimited')}
        <input id="experimental-prep-unlimited" type="checkbox" role="switch" checked=${options.prepUnlimited === true}
          disabled=${!editable || busy} onChange=${e => change('prepUnlimited', e.currentTarget.checked)} />
      </label>` : null}
      ${source !== 'matchmaking' ? html`<label class="experimental-option" for="experimental-bench-expand">
        ${ruleLabel('benchExpand')}
        <input id="experimental-bench-expand" type="checkbox" role="switch" checked=${options.benchExpand === true}
          disabled=${!editable || busy} onChange=${e => change('benchExpand', e.currentTarget.checked)} />
      </label>` : null}
      ${source !== 'matchmaking' ? html`<label class="experimental-option" for="experimental-gold-preview">
        ${ruleLabel('goldPreview')}
        <input id="experimental-gold-preview" type="checkbox" role="switch" checked=${options.goldPreview === true}
          disabled=${!editable || busy} onChange=${e => change('goldPreview', e.currentTarget.checked)} />
      </label>` : null}
      ${source !== 'matchmaking' ? html`<label class="experimental-option" for="experimental-shop-left">
        ${ruleLabel('shopLeft')}
        <input id="experimental-shop-left" type="checkbox" role="switch" checked=${options.shopLeft !== false}
          disabled=${!editable || busy} onChange=${e => change('shopLeft', e.currentTarget.checked)} />
      </label>` : null}
      ${source !== 'matchmaking' ? html`<label class="experimental-option" for="experimental-speed-vote">
        ${ruleLabel('speedVote')}
        <input id="experimental-speed-vote" type="checkbox" role="switch" checked=${options.speedVote !== false}
          disabled=${!editable || busy} onChange=${e => change('speedVote', e.currentTarget.checked)} />
      </label>` : null}
      ${source !== 'matchmaking' && choices.length > 1 ? html`<div class="experimental-stages">
        <div class="experimental-stages__head">
          <strong>${experimentalCopy('bannedStages')[0]}</strong>
          <small>${experimentalCopy('bannedStages')[1]}</small>
        </div>
        <div class="experimental-stages__list" role="group" aria-label=${t('禁用战场')}>
          ${choices.map(s => html`<label key=${s.id} class=${`experimental-stage${banned.has(s.id) ? ' is-banned' : ''}`}>
            <input type="checkbox" checked=${banned.has(s.id)} disabled=${!editable || busy}
              onChange=${e => toggleStage(s.id, e.currentTarget.checked)} />
            <span>${s.label || s.id}${s.note ? html`<small>${s.note}</small>` : ''}</span>
          </label>`)}
        </div>
      </div>` : null}
    </div>
    <p class="experimental-options__note">${editable ? t('开局后不可更改') : t('由房间创建者设置')}</p>
  <//>`;
}
