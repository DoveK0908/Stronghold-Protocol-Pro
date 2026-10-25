import { html, Button, Modal } from './components.js';
import { t, tc } from '../../../shared/i18n.js';
import { MAX_SEATS } from '../../../shared/constants.js';
import { EXPERIMENTAL_OPTIONAL, EXPERIMENTAL_OPTIONAL_DEFAULTS, bannedStages, optionalValue } from '../../../shared/experimental.js';
import { PLAYER_CAPACITIES, isPlayerCapacity, roomCapacity } from '../../../shared/playerCapacity.js';

export function experimentalOptions(input) {
  const capacity = roomCapacity('coop', input);
  const banned = bannedStages(input);
  return { revivalEnabled: input?.revivalEnabled === true, disableSharedPool: input?.disableSharedPool === true,
    ...(capacity > MAX_SEATS && input?.disableDuckLord === true ? { disableDuckLord: true } : {}),
    ...(capacity === MAX_SEATS ? {} : { playerCapacity: capacity }),
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
export function experimentalChanged(input) {
  const options = experimentalOptions(input);
  return options.revivalEnabled || options.disableSharedPool || !!options.disableDuckLord || !!options.playerCapacity
    || Array.isArray(options.bannedStages) && options.bannedStages.length > 0
    || EXPERIMENTAL_OPTIONAL.some(key => options[key] !== undefined);
}

export function experimentalSummary(input) {
  const options = experimentalOptions(input);
  const summary = t('复活 {0} · 共享卡池 {1}', { 0: options.revivalEnabled ? t('开启') : tc('toggle', '关闭'), 1: options.disableSharedPool ? tc('toggle', '关闭') : t('开启') });
  let rules = options.disableDuckLord ? `${summary} · ${t('禁用鸭爵策略')}` : summary;
  if (options.luckConsole) rules = `${rules} · ${t('测试插件')}`;
  if (options.bossHitSoftCap === true) rules = `${rules} · ${t('限伤改为封顶')}`;
  if (options.prepUnlimited === true) rules = `${rules} · ${t('无限休整期')}`;
  if (options.benchExpand === true) rules = `${rules} · ${t('整备区扩容')}`;
  if (Array.isArray(options.bannedStages) && options.bannedStages.length) rules = `${rules} · ${t('禁用战场 {n} 张', { n: options.bannedStages.length })}`;
  return options.playerCapacity ? t('{rules} · {n} 人模式', { rules, n: options.playerCapacity }) : rules;
}

export function ExperimentalSummary({ value }) {
  return html`<span class="experimental-summary">${experimentalSummary(value)}</span>`;
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
  const setCapacity = next => {
    if (!editable || busy || mode !== 'coop' || source === 'matchmaking' || !isPlayerCapacity(next)) return;
    const { playerCapacity, ...rules } = options;
    if (next === MAX_SEATS) {
      const { disableDuckLord, ...ordinary } = rules;
      onChange?.(ordinary);
    } else onChange?.({ ...rules, playerCapacity: next });
  };
  return html`<${Modal} open=${open} title=${t('实验性选项')} micro="EXPERIMENTAL" ariaLabel=${t('实验性选项')} trapFocus=${true}
      class="experimental-modal" onClose=${onClose}
      actions=${html`<${Button} icon="check" onClick=${onClose}>${t('完成')}<//>`}>
    <div class="experimental-options">
      <label class="experimental-option" for="experimental-revival">
        <span><strong>${t('队友复活')}</strong><small>${t('符合救援条件的队友可支付 10 生命抵消死亡，每人每局一次。')}</small></span>
        <input id="experimental-revival" type="checkbox" role="switch" checked=${options.revivalEnabled}
          disabled=${!editable || busy} onChange=${e => change('revivalEnabled', e.currentTarget.checked)} />
      </label>
      <label class="experimental-option" for="experimental-pool">
        <span><strong>${t('禁用共享卡池')}</strong><small>${t('每位博士使用独立卡池，不再争用同一干员库存。')}</small></span>
        <input id="experimental-pool" type="checkbox" role="switch" checked=${options.disableSharedPool}
          disabled=${!editable || busy} onChange=${e => change('disableSharedPool', e.currentTarget.checked)} />
      </label>
      ${mode === 'coop' && source !== 'matchmaking' ? html`<label class="experimental-option" for="experimental-multiplayer">
        <span><strong>${t('扩展同盟人数')}</strong><small>${t('可直接开局，或整队匹配相同人数模式的房间。所有成员需更新页面，人数较多时等待与演算时间可能增加。')}</small></span>
        <input id="experimental-multiplayer" type="checkbox" role="switch" checked=${capacity > MAX_SEATS}
          disabled=${!editable || busy} onChange=${e => setCapacity(e.currentTarget.checked ? 8 : MAX_SEATS)} />
      </label>` : null}
      ${mode === 'coop' && source !== 'matchmaking' && capacity > MAX_SEATS ? html`<label class="experimental-capacity" for="experimental-capacity">
        <span>${t('同盟人数模式')}</span>
        <select id="experimental-capacity" value=${capacity} disabled=${!editable || busy} onChange=${e => setCapacity(Number(e.currentTarget.value))}>
          ${PLAYER_CAPACITIES.map(n => html`<option key=${n} value=${n}>${t('{n} 人', { n })}</option>`)}
        </select>
      </label>` : null}
      ${mode === 'coop' && capacity > MAX_SEATS ? html`<label class="experimental-option" for="experimental-ducklord">
        <span><strong>${t('禁用鸭爵策略')}</strong><small>${t('勾选后，本局无法选择鸭爵策略；不影响其他策略。')}</small></span>
        <input id="experimental-ducklord" type="checkbox" checked=${options.disableDuckLord === true}
          disabled=${!editable || busy} onChange=${e => change('disableDuckLord', e.currentTarget.checked)} />
      </label>` : null}
      ${source !== 'matchmaking' ? html`<label class="experimental-option" for="experimental-luck-console">
        <span><strong>${t('Luck 测试插件')}</strong><small>${t('开局后允许打开 Luck 测试面板（改资金、回合、地图、盟约层数等）；不勾选则完全不加载。')}</small></span>
        <input id="experimental-luck-console" type="checkbox" role="switch" checked=${options.luckConsole === true}
          disabled=${!editable || busy} onChange=${e => change('luckConsole', e.currentTarget.checked)} />
      </label>` : null}
      ${source !== 'matchmaking' ? html`<label class="experimental-option" for="experimental-hit-softcap">
        <span><strong>${t('限伤改为封顶')}</strong><small>${t('默认关闭：开着时，本会被限伤取消的那一下不再掉 0，而是按 29 万 9999 结算（打首领的大伤害不再白打）。')}</small></span>
        <input id="experimental-hit-softcap" type="checkbox" role="switch" checked=${options.bossHitSoftCap === true}
          disabled=${!editable || busy} onChange=${e => change('bossHitSoftCap', e.currentTarget.checked)} />
      </label>` : null}
      ${source !== 'matchmaking' ? html`<label class="experimental-option" for="experimental-prep-unlimited">
        <span><strong>${t('无限休整期')}</strong><small>${t('休整期不再倒计时；所有还活着的博士都点「准备就绪」之后才进入战斗。')}</small></span>
        <input id="experimental-prep-unlimited" type="checkbox" role="switch" checked=${options.prepUnlimited === true}
          disabled=${!editable || busy} onChange=${e => change('prepUnlimited', e.currentTarget.checked)} />
      </label>` : null}
      ${source !== 'matchmaking' ? html`<label class="experimental-option" for="experimental-bench-expand">
        <span><strong>${t('整备区扩容')}</strong><small>${t('待销毁区左边那三格空位变成整备区：整备区从 10 格变 13 格，多拿三个单位。')}</small></span>
        <input id="experimental-bench-expand" type="checkbox" role="switch" checked=${options.benchExpand === true}
          disabled=${!editable || busy} onChange=${e => change('benchExpand', e.currentTarget.checked)} />
      </label>` : null}
      ${source !== 'matchmaking' && choices.length > 1 ? html`<div class="experimental-stages">
        <div class="experimental-stages__head">
          <strong>${t('禁用战场')}</strong>
          <small>${t('勾选的战场不会出现在本局；至少要保留一张。')}</small>
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
