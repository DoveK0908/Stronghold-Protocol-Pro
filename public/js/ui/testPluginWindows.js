// Native test plugin — the floating windows (TESTPLUGIN-V2-CONTRACT §5). Presentation only: every control reads the
// private view or the game data and calls send(cmd, args) with a payload from testPluginModel.js, which the shared
// parser and the match then re-validate. One window is one component; the frame (drag, position, close) is shared.
// No timers, no effects: positions live in localStorage, drags are pointer events on the header.
import { useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { useData } from '../data.js';
import { t } from '../../../shared/i18n.js';
import {
  chessPortraitUrl, itemIconUrl, enemyIconUrl, bondIconUrl, bandIconUrl, skillRecordIconUrl,
} from './assetUrls.js';
import {
  TEST_WINDOWS, chessOf, assetsOf, bondRecords, bandRecords, stageRecords, skillList, moduleList, traitRecords,
  chessRecords, itemRecords, enemyGroups, bossGroups, bossJump, roundMax, ownedOperators, STAT_FIELDS,
  operatorState, enemiesArgs, opArgs, clampShopLevel, slotEntries, withSlot, queueArgs, queuedSlots, MODULE_NONE,
} from './testPluginModel.js';

export const WIN_POS_KEY = 'sp.testplugin.win';

const WIDTH = Object.freeze({
  shop: 440, op: 700, strategy: 400, filter: 420, round: 340, map: 480, enemies: 580, boss: 580, res: 380,
});

function readPos(key) {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) || 'null');
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null;
  } catch {
    return null;
  }
}

function writePos(key, pos) {
  try {
    window.localStorage.setItem(key, JSON.stringify(pos));
  } catch {
    /* storage can be full or disabled — a position is not worth failing over */
  }
}

const clampX = (x, w, vw) => Math.max(8, Math.min(Math.max(8, vw - w - 8), x));
const clampY = (y, h, vh) => Math.max(8, Math.min(Math.max(8, vh - h - 8), y));

function defaultPos(index, vw, vh) {
  const w = 460;
  return {
    x: clampX(vw / 2 - w / 2 + index * 22, w, vw),
    y: clampY(72 + index * 24, 260, vh),
  };
}

// ---------------------------------------------------------------------------------------------------
// frame: draggable, closes, remembers its position
// ---------------------------------------------------------------------------------------------------

function Frame({ id, title, z, index, onClose, onFocus, children }) {
  const width = WIDTH[id] || 420;
  const key = `${WIN_POS_KEY}.${id}`;
  const [pos, setPos] = useState(() => readPos(key) || defaultPos(index, window.innerWidth, window.innerHeight));
  const posRef = useRef(pos);
  posRef.current = pos;
  const drag = useRef(null);
  const down = (e) => {
    onFocus();
    if (e.button !== undefined && e.button !== 0) return;
    const tgt = e.target;
    if (tgt && tgt.closest && tgt.closest('button,input,select,textarea,a')) return;
    drag.current = { x: e.clientX, y: e.clientY, ox: posRef.current.x, oy: posRef.current.y, moved: false, last: null };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* a capture the browser refuses only costs smoothness */
    }
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) <= 3) return;
    d.moved = true;
    const next = { x: clampX(d.ox + dx, width, window.innerWidth), y: clampY(d.oy + dy, 120, window.innerHeight) };
    d.last = next;
    setPos(next);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.moved && d.last) writePos(key, d.last);
  };
  return html`<section class="tpw" style=${`left:${pos.x}px;top:${pos.y}px;width:${width}px;z-index:${z}`}
      onPointerDown=${() => onFocus()}>
    <header class="tpw__head" onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}>
      <span class="tpw__title">${title}</span>
      <button class="tpw__close" type="button" aria-label=${t('关闭')} title=${t('关闭')} onClick=${onClose}>×</button>
    </header>
    <div class="tpw__body">${children}</div>
  </section>`;
}

// ---------------------------------------------------------------------------------------------------
// small controls
// ---------------------------------------------------------------------------------------------------

function Stepper({ value, min, max, onChange, busy }) {
  const set = (v) => onChange(Math.max(min, Math.min(max, Math.round(v))));
  return html`<span class="tpw__stepper">
    <button type="button" class="tpw__step" disabled=${busy || value <= min} onClick=${() => set(value - 1)}>−</button>
    <b class="tpw__val">${value}</b>
    <button type="button" class="tpw__step" disabled=${busy || value >= max} onClick=${() => set(value + 1)}>+</button>
  </span>`;
}

function Chip({ active, onClick, title, children }) {
  return html`<button type="button" class=${`tpw__chip${active ? ' is-on' : ''}`} title=${title || ''} onClick=${onClick}>${children}</button>`;
}

function Search({ value, onChange, placeholder }) {
  return html`<input class="tpw__search" type="search" value=${value} placeholder=${placeholder}
    onInput=${(e) => onChange(e.target.value)} />`;
}

function SkillChip({ m, skill, active, onClick }) {
  return html`<button type="button" class=${`tpw__skill${active ? ' is-on' : ''}`} title=${skill.desc || ''} onClick=${onClick}>
    <img class="tpw__skill-img" src=${skillRecordIconUrl(m, skill)} alt="" loading="lazy" />
    <span class="tpw__skill-name">${skill.name || ''}</span>
  </button>`;
}

function Portrait({ m, chess, size = 44 }) {
  return html`<img class="tpw__portrait" src=${chessPortraitUrl(m, chess)} alt=${chess?.name || ''} loading="lazy"
    style=${`width:${size}px;height:${size * 2}px`} />`;
}

const stripTags = (text) => String(text || '').replace(/<[^>]*>/g, '').trim();

// ---------------------------------------------------------------------------------------------------
// 自选商店 + 调度中心等级 + 下一轮商店
// ---------------------------------------------------------------------------------------------------

function ShopSlotCard({ m, kind, rec, price, sold, onClick, onClear, label }) {
  if (!rec) {
    return html`<button type="button" class="tpw__slot is-empty" onClick=${onClick}>${t('空槽位')}</button>`;
  }
  return html`<div class=${`tpw__slot${sold ? ' is-sold' : ''}`}>
    <button type="button" class="tpw__slot-main" onClick=${onClick}>
      ${kind === 'chess'
        ? html`<${Portrait} m=${m} chess=${rec} size=${34} />`
        : html`<img class="tpw__item" src=${itemIconUrl(m, rec)} alt="" loading="lazy" />`}
      <span class="tpw__slot-name">${rec.name || ''}</span>
      ${label ? html`<span class="tpw__slot-price">${label}</span>` : price != null ? html`<span class="tpw__slot-price">${price}</span>` : null}
      ${sold ? html`<span class="tpw__slot-sold">${t('已售出')}</span>` : null}
    </button>
    ${onClear ? html`<button type="button" class="tpw__slot-x" title=${t('清空该槽')} onClick=${onClear}>×</button>` : null}
  </div>`;
}

function ShopWindow({ mine, send, busy }) {
  const m = assetsOf();
  const layout = mine.shop?.layout || { chess: 0, item: 0 };
  const cur = slotEntries(mine);
  const total = Math.max(cur.length, (layout.chess || 0) + (layout.item || 0));
  const queued = queuedSlots(mine);
  const [next, setNext] = useState(() => (queued ? queued.slice() : cur.slice()));
  const [picker, setPicker] = useState(null);
  const [q, setQ] = useState('');
  const [level, setLevel] = useState(clampShopLevel(mine.shop?.level ?? 1));
  const [free, setFree] = useState(String(mine.shop?.freeRefreshes ?? 0));
  const receipt = mine.testPlugin || {};
  const diy = Array.isArray(receipt.diy) ? receipt.diy : [];

  const kindAt = (i) => (i < (layout.chess || 0) ? 'chess' : 'item');
  const recAt = (entry) => (entry ? (entry.kind === 'chess' ? chessOf(entry.id) : null) : null);
  const pickOptions = picker
    ? (picker.kind === 'chess' ? chessRecords() : itemRecords()).filter((r) => !q || String(r.name || '').toLowerCase().includes(q.toLowerCase()))
    : [];

  const putCurrent = (index, entry) => send('shopSlots', withSlot(mine, index, entry));
  const putNext = (index, entry) => {
    const arr = next.slice();
    while (arr.length <= index) arr.push(null);
    arr[index] = entry;
    setNext(arr);
  };
  const put = (rec) => {
    const entry = { kind: picker.kind, id: rec.id || rec.chessId || rec.trapId };
    if (picker.where === 'next') putNext(picker.index, entry);
    else putCurrent(picker.index, entry);
    setPicker(null);
    setQ('');
  };

  const nextReady = next.length > 0 && next.every((s) => s && s.id);

  return html`<div class="tpw__pane">
    <section class="tpw__box">
      <div class="tpw__row">
        <span class="tpw__label">${t('调度中心等级')}</span>
        <${Stepper} value=${level} min=${1} max=${clampShopLevel(mine.shop?.maxLevel ?? 6)} busy=${busy}
          onChange=${(v) => setLevel(v)} />
        <button type="button" class="tpw__btn" disabled=${busy || level === (mine.shop?.level ?? 1)}
          onClick=${() => send('shopLevel', { level: clampShopLevel(level) })}>${t('设为该等级')}</button>
        <button type="button" class="tpw__btn" disabled=${busy || (mine.shop?.level ?? 1) >= 6}
          onClick=${() => { setLevel(6); send('shopLevel', { level: 6 }); }}>${t('升到6级')}</button>
      </div>
      <div class="tpw__row">
        <span class="tpw__label">${t('免费刷新次数')}</span>
        <input class="tpw__input" type="number" min="0" max="99" value=${free} onInput=${(e) => setFree(e.target.value)} />
        <button type="button" class="tpw__btn" disabled=${busy} onClick=${() => send('refreshFree', { count: Math.max(0, Number(free) || 0) })}>${t('应用')}</button>
        <span class="tpw__label">${t('自选库存')}</span>
        <button type="button" class="tpw__btn" disabled=${busy} onClick=${() => send('diyRefresh', {})}>${t('补充自选库存')}</button>
      </div>
      ${diy.length ? html`<div class="tpw__diy">${diy.map((d) => html`<span class="tpw__diychip">${d.id} · ${t('剩余 {n}', { n: d.left })}</span>`)}</div>` : null}
    </section>

    <section class="tpw__box">
      <div class="tpw__boxhead"><span class="tpw__label">${t('当前货架')}</span>
        <span class="tpw__hint">${t('点击槽位挑选干员或装备')}</span></div>
      <div class="tpw__slots">
        ${Array.from({ length: total }, (_, i) => {
          const entry = cur[i] || null;
          const kind = entry ? entry.kind : kindAt(i);
          return html`<${ShopSlotCard} m=${m} kind=${kind} rec=${recAt(entry)} price=${mine.shop?.slots?.[i]?.price}
            sold=${!!mine.shop?.slots?.[i]?.sold} label=${entry && entry.kind === 'item' ? (mine.shop?.slots?.[i]?.price ?? null) : null}
            onClick=${() => setPicker({ kind, index: i, where: 'cur' })}
            onClear=${entry ? () => putCurrent(i, null) : null} />`;
        })}
      </div>
    </section>

    <section class="tpw__box">
      <div class="tpw__boxhead"><span class="tpw__label">${t('下一轮商店')}</span>
        <button type="button" class="tpw__btn" disabled=${busy || !nextReady}
          onClick=${() => send('shop', queueArgs(next))}>${t('设为下一轮货架')}</button>
        <button type="button" class="tpw__btn" disabled=${busy}
          onClick=${() => setNext(cur.slice())}>${t('复制当前货架')}</button></div>
      <div class="tpw__slots">
        ${Array.from({ length: total }, (_, i) => {
          const entry = next[i] || null;
          const kind = entry ? entry.kind : kindAt(i);
          const rec = entry ? (entry.kind === 'chess' ? chessOf(entry.id) : null) : null;
          return html`<div class="tpw__slotwrap">
            <${ShopSlotCard} m=${m} kind=${kind} rec=${rec} onClick=${() => setPicker({ kind, index: i, where: 'next' })} />
            ${rec && entry.kind === 'item'
              ? html`<span class="tpw__slot-name">${itemOfName(entry.id)}</span>`
              : null}
          </div>`;
        })}
      </div>
      ${nextReady ? null : html`<div class="tpw__warn">${t('下一轮货架不能有空槽位')}</div>`}
    </section>

    ${picker ? html`<section class="tpw__box tpw__picker">
      <div class="tpw__boxhead">
        <span class="tpw__label">${picker.kind === 'chess' ? t('选择干员') : t('选择装备')}</span>
        <${Search} value=${q} onChange=${setQ} placeholder=${t('搜索')} />
        <button type="button" class="tpw__btn" onClick=${() => { setPicker(null); setQ(''); }}>${t('取消')}</button>
      </div>
      <div class="tpw__grid">
        ${pickOptions.slice(0, 80).map((rec) => html`<button type="button" class=${`tpw__card${(rec.isGolden ? ' is-golden' : '')}`}
            key=${rec.chessId || rec.id || rec.trapId} onClick=${() => put(rec)}>
          ${picker.kind === 'chess'
            ? html`<${Portrait} m=${m} chess=${rec} size=${30} />`
            : html`<img class="tpw__item" src=${itemIconUrl(m, rec)} alt="" loading="lazy" />`}
          <span class="tpw__card-name">${rec.name || ''}</span>
        </button>`)}
      </div>
      ${pickOptions.length > 80 ? html`<div class="tpw__hint">${t('仅显示前 80 条，请用搜索缩小范围')}</div>` : null}
    </section>` : null}
  </div>`;
}

function itemOfName(id) {
  const rec = itemRecords().find((r) => (r.id || r.trapId) === id);
  return rec ? rec.name || '' : '';
}

// ---------------------------------------------------------------------------------------------------
// 干员修改 (潜能 / 练度 / 技能 / 模组 / 属性 / 盟约 / 特质)
// ---------------------------------------------------------------------------------------------------

function OpWindow({ mine, send, busy }) {
  const m = assetsOf();
  const rows = ownedOperators(mine);
  const [sel, setSel] = useState(rows[0]?.id || null);
  const [draft, setDraft] = useState(null);
  const [q, setQ] = useState('');
  const cur = sel ? chessOf(sel) : null;
  const base = cur ? operatorState(mine, cur) : null;
  const view = base ? (draft && draft.id === sel ? draft : { id: sel, ...base }) : null;
  const update = (patch) => setDraft({ ...(view || { id: sel }), ...patch });

  if (!rows.length) return html`<div class="tpw__pane"><div class="tpw__hint">${t('本局还没有干员')}</div></div>`;
  if (!view) return html`<div class="tpw__pane"><div class="tpw__hint">${t('加载中')}</div></div>`;

  const skills = skillList(cur);
  const mods = moduleList(cur);
  const allBonds = bondRecords().map((b) => ({ id: b.bondId, name: b.name, kind: b.isCore ? 'core' : '' }));
  const traits = traitRecords().filter((g) => !q || String(g._testLabel).includes(q) || String(g.desc || '').includes(q));
  const toggleBond = (id) => {
    const list = view.bonds.includes(id) ? view.bonds.filter((b) => b !== id) : [...view.bonds, id];
    update({ bonds: list });
  };
  const toggleTrait = (id) => {
    const list = view.traits.includes(id) ? view.traits.filter((b) => b !== id) : [...view.traits, id];
    update({ traits: list });
  };
  const { args } = opArgs(cur, view);
  const dirty = Object.keys(args).length > 0;

  return html`<div class="tpw__pane tpw__pane--split">
    <aside class="tpw__list">
      ${rows.map((row) => html`<button type="button" class=${`tpw__oprow${row.id === sel ? ' is-on' : ''}`}
          key=${row.id} onClick=${() => { setSel(row.id); setDraft(null); }}>
        <${Portrait} m=${m} chess=${row.chess} size=${26} />
        <span class="tpw__oprow-name">${row.name}</span>
        <span class="tpw__oprow-area">${row.area === 'board' ? t('场上') : t('待命')}</span>
      </button>`)}
    </aside>
    <div class="tpw__editor">
      <div class="tpw__row">
        <span class="tpw__label">${t('潜能')}</span>
        <${Stepper} value=${view.potential} min=${1} max=${6} busy=${busy} onChange=${(v) => update({ potential: v })} />
        <span class="tpw__label">${t('练度')}</span>
        <${Stepper} value=${view.cultivate} min=${0} max=${3} busy=${busy} onChange=${(v) => update({ cultivate: v })} />
      </div>

      <div class="tpw__box">
        <div class="tpw__boxhead"><span class="tpw__label">${t('携带技能')}</span></div>
        <div class="tpw__grid">
          ${skills.map((s) => html`<${SkillChip} m=${m} skill=${s} active=${s.index === view.skillIndex}
            key=${String(s.index)} onClick=${() => update({ skillIndex: s.index })} />`)}
        </div>
      </div>

      <div class="tpw__box">
        <div class="tpw__boxhead"><span class="tpw__label">${t('携带模组')}</span></div>
        <div class="tpw__grid">
          <${Chip} active=${view.moduleId == null} onClick=${() => update({ moduleId: null })}>${t('默认模组')}</${Chip}>
          <${Chip} active=${view.moduleId === MODULE_NONE} onClick=${() => update({ moduleId: MODULE_NONE })}>${t('不带模组')}</${Chip}>
          ${mods.map((md) => html`<${Chip} active=${md.uniEquipId === view.moduleId} title=${md.name || ''}
            onClick=${() => update({ moduleId: md.uniEquipId })}>${md.typeName || md.name || md.uniEquipId}</${Chip}>`)}
        </div>
      </div>

      <div class="tpw__box">
        <div class="tpw__boxhead"><span class="tpw__label">${t('属性')}</span>
          <span class="tpw__hint">${t('留空或等于原值表示不修改')}</span></div>
        <div class="tpw__stats">
          ${STAT_FIELDS.map((f) => html`<label class="tpw__stat" key=${f.key}>
            <span class="tpw__stat-k">${f.label}</span>
            <input class="tpw__input" type="number" min="0" value=${view.stats[f.key]}
              onInput=${(e) => update({ stats: { ...view.stats, [f.key]: Number(e.target.value) || 0 } })} />
          </label>`)}
        </div>
      </div>

      <div class="tpw__box">
        <div class="tpw__boxhead"><span class="tpw__label">${t('盟约')}</span>
          <span class="tpw__hint">${t('已选 {n}', { n: view.bonds.length })}</span></div>
        <div class="tpw__chips">
          ${allBonds.map((b) => html`<${Chip} key=${b.id} active=${view.bonds.includes(b.id)} title=${b.name}
            onClick=${() => toggleBond(b.id)}>
            <img class="tpw__bond" src=${bondIconUrl(m, b.id)} alt="" loading="lazy" />${b.name}
          </${Chip}>`)}
        </div>
      </div>

      <div class="tpw__box">
        <div class="tpw__boxhead"><span class="tpw__label">${t('特质')}</span>
          <span class="tpw__hint">${t('已选 {n}', { n: view.traits.length })}</span>
          <${Search} value=${q} onChange=${setQ} placeholder=${t('搜索特质')} /></div>
        <div class="tpw__chips tpw__chips--tall">
          ${traits.slice(0, 120).map((g) => html`<${Chip} key=${g.garrisonId} active=${view.traits.includes(g.garrisonId)}
            title=${stripTags(g.desc)} onClick=${() => toggleTrait(g.garrisonId)}>${g._testLabel}</${Chip}>`)}
        </div>
      </div>

      <div class="tpw__row tpw__row--end">
        <button type="button" class="tpw__btn" disabled=${busy}
          onClick=${() => setDraft({ id: sel, ...operatorState(mine, cur) })}>${t('还原')}</button>
        <button type="button" class="tpw__btn tpw__btn--primary" disabled=${busy || !dirty}
          onClick=${() => send('op', args)}>${t('应用修改')}</button>
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------------------------------
// 策略替换
// ---------------------------------------------------------------------------------------------------

function StrategyWindow({ mine, send, busy }) {
  const m = assetsOf();
  const bands = bandRecords().sort((a, b) => (a.sortId ?? 0) - (b.sortId ?? 0));
  const [sel, setSel] = useState(mine.bandId || null);
  const cur = mine.bandId || null;
  return html`<div class="tpw__pane">
    <div class="tpw__list tpw__list--wide">
      ${bands.map((b) => html`<button type="button" class=${`tpw__band${b.bandId === sel ? ' is-on' : ''}`}
          key=${b.bandId} onClick=${() => setSel(b.bandId)}>
        <img class="tpw__band-img" src=${bandIconUrl(m, b.bandId)} alt="" loading="lazy" />
        <span class="tpw__band-name">${b.name || ''}</span>
        <span class="tpw__band-desc">${stripTags(b.desc)}</span>
      </button>`)}
    </div>
    <div class="tpw__row tpw__row--end">
      <span class="tpw__hint">${t('当前：{name}', { name: bands.find((b) => b.bandId === cur)?.name || t('无') })}</span>
      <button type="button" class="tpw__btn tpw__btn--primary" disabled=${busy || !sel || sel === cur}
        onClick=${() => send('strategy', { id: sel })}>${t('替换为所选策略')}</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------------------------------
// 商店盟约过滤 (multi-select)
// ---------------------------------------------------------------------------------------------------

function FilterWindow({ mine, send, busy }) {
  const m = assetsOf();
  const saved = mine.testPlugin?.filter;
  const [bonds, setBonds] = useState(() => (Array.isArray(saved?.bonds) ? saved.bonds.slice() : []));
  const [mode, setMode] = useState(saved?.mode === 'all' ? 'all' : 'any');
  const all = bondRecords();
  const toggle = (id) => setBonds(bonds.includes(id) ? bonds.filter((b) => b !== id) : [...bonds, id]);
  return html`<div class="tpw__pane">
    <div class="tpw__row">
      <span class="tpw__label">${t('过滤方式')}</span>
      <label class="tpw__radio"><input type="radio" checked=${mode === 'any'} onChange=${() => setMode('any')} />${t('任一盟约')}</label>
      <label class="tpw__radio"><input type="radio" checked=${mode === 'all'} onChange=${() => setMode('all')} />${t('全部盟约')}</label>
    </div>
    <div class="tpw__chips">
      ${all.map((b) => html`<${Chip} key=${b.bondId} active=${bonds.includes(b.bondId)} onClick=${() => toggle(b.bondId)}>
        <img class="tpw__bond" src=${bondIconUrl(m, b.bondId)} alt="" loading="lazy" />${b.name}
      </${Chip}>`)}
    </div>
    <div class="tpw__row tpw__row--end">
      <button type="button" class="tpw__btn" disabled=${busy} onClick=${() => { setBonds([]); send('filter', { bonds: [], mode: 'any' }); }}>${t('清除过滤')}</button>
      <button type="button" class="tpw__btn tpw__btn--primary" disabled=${busy}
        onClick=${() => send('filter', { bonds: bonds.slice(), mode })}>${t('应用过滤')}</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------------------------------
// 回合控制
// ---------------------------------------------------------------------------------------------------

function RoundWindow({ pub, send, busy }) {
  const cur = pub.round || 1;
  const max = roundMax(pub);
  const boss = pub.bossRound || 0;
  const hidden = pub.hiddenRound || 0;
  const [value, setValue] = useState(String(cur));
  const jump = (r) => {
    const n = Math.max(1, Math.min(max, Math.round(Number(r) || cur)));
    send('round', { round: n });
  };
  return html`<div class="tpw__pane">
    <div class="tpw__row"><span class="tpw__label">${t('当前回合')}</span><b>${cur}</b>
      <span class="tpw__hint">${t('可跳到第 1 – {max} 回合', { max })}</span></div>
    <div class="tpw__row"><span class="tpw__label">${t('首领回合')}</span><b>${boss || '—'}</b>
      <span class="tpw__label">${t('隐匿回合')}</span><b>${hidden || '—'}</b></div>
    <div class="tpw__row">
      <input class="tpw__input" type="number" min="1" max=${max} value=${value} onInput=${(e) => setValue(e.target.value)} />
      <button type="button" class="tpw__btn tpw__btn--primary" disabled=${busy} onClick=${() => jump(value)}>${t('跳到该回合')}</button>
    </div>
    <div class="tpw__row">
      <button type="button" class="tpw__btn" disabled=${busy || cur >= max} onClick=${() => jump(cur + 1)}>${t('下一回合')}</button>
      <button type="button" class="tpw__btn" disabled=${busy || cur <= 1} onClick=${() => jump(1)}>${t('第一回合')}</button>
      ${boss ? html`<button type="button" class="tpw__btn" disabled=${busy || cur === boss} onClick=${() => jump(boss)}>${t('跳到首领回合')}</button>` : null}
      ${hidden ? html`<button type="button" class="tpw__btn" disabled=${busy || cur === hidden} onClick=${() => jump(hidden)}>${t('跳到隐匿回合')}</button>` : null}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------------------------------
// 地图更改
// ---------------------------------------------------------------------------------------------------

const tileKind = (tile) => {
  if (!tile) return 'void';
  if (tile.buildable) return 'build';
  if (tile.passable) return 'pass';
  return 'wall';
};

function MiniMap({ stage }) {
  const rows = Array.isArray(stage.rows) ? stage.rows : [];
  const tiles = stage.tiles && typeof stage.tiles === 'object' ? stage.tiles : {};
  const w = rows[0]?.length || 1;
  const cells = [];
  for (let r = 0; r < rows.length; r += 1) {
    const line = rows[r];
    for (let c = 0; c < line.length; c += 1) {
      cells.push(html`<span class=${`tpw__tile tpw__tile--${tileKind(tiles[line[c]])}`} key=${`${r}:${c}`}></span>`);
    }
  }
  return html`<div class="tpw__map" style=${`grid-template-columns:repeat(${w},4px)`}>${cells}</div>`;
}

function MapWindow({ pub, send, busy }) {
  const stages = stageRecords();
  const [sel, setSel] = useState(pub.stageId || null);
  return html`<div class="tpw__pane">
    <div class="tpw__grid tpw__grid--stages">
      ${stages.map((s) => html`<button type="button" class=${`tpw__stage${s.id === sel ? ' is-on' : ''}`} key=${s.id}
          onClick=${() => setSel(s.id)}>
        <${MiniMap} stage=${s} />
        <span class="tpw__stage-name">${s.name || s.id}</span>
        <span class="tpw__hint">${Array.isArray(s.size) ? `${s.size[0]}×${s.size[1]}` : ''}</span>
      </button>`)}
    </div>
    <div class="tpw__row tpw__row--end">
      <span class="tpw__hint">${t('当前地图：{name}', { name: stages.find((s) => s.id === pub.stageId)?.name || '—' })}</span>
      <button type="button" class="tpw__btn tpw__btn--primary" disabled=${busy || !sel || sel === pub.stageId}
        onClick=${() => send('map', { id: sel })}>${t('更换为所选地图')}</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------------------------------
// 敌人配置 (普通 / 赏金 / 特训)
// ---------------------------------------------------------------------------------------------------

function EnemyRow({ m, rec, onAdd, disabled }) {
  return html`<button type="button" class="tpw__enemy" disabled=${disabled} onClick=${onAdd}>
    <img class="tpw__enemy-img" src=${enemyIconUrl(m, rec.id)} alt="" loading="lazy" />
    <span class="tpw__enemy-name">${rec.name}</span>
    <span class="tpw__hint">${rec.level ? `Lv.${rec.level}` : ''}</span>
  </button>`;
}

function EnemiesWindow({ pub, send, busy }) {
  const m = assetsOf();
  const groups = enemyGroups();
  const [group, setGroup] = useState(groups[0]?.id || 'normal');
  const [sub, setSub] = useState(null);
  const [mode, setMode] = useState('replace');
  const [picks, setPicks] = useState([]);
  const [q, setQ] = useState('');
  const active = groups.find((g) => g.id === group) || groups[0];
  let list = [];
  if (active?.id === 'special') {
    const buckets = Array.isArray(active.list) ? active.list : [];
    const bucket = sub ? buckets.find((b) => b.id === sub) : null;
    list = bucket ? bucket.list : buckets.reduce((acc, b) => acc.concat(b.list), []);
  } else if (active) {
    list = active.list || [];
  }
  if (q) list = list.filter((r) => String(r.name).toLowerCase().includes(q.toLowerCase()));
  const add = (rec) => {
    const found = picks.find((p) => p.id === rec.id);
    if (found) setPicks(picks.map((p) => (p.id === rec.id ? { ...p, count: Math.min(20, p.count + 1) } : p)));
    else setPicks([...picks, { id: rec.id, name: rec.name, count: 1 }]);
  };
  const remove = (id) => setPicks(picks.filter((p) => p.id !== id));
  return html`<div class="tpw__pane">
    <div class="tpw__row">
      <span class="tpw__label">${t('替换或追加')}</span>
      <label class="tpw__radio"><input type="radio" checked=${mode === 'replace'} onChange=${() => setMode('replace')} />${t('替换当前波次')}</label>
      <label class="tpw__radio"><input type="radio" checked=${mode === 'append'} onChange=${() => setMode('append')} />${t('追加到当前波次')}</label>
      <span class="tpw__hint">${t('第 {r} 回合', { r: pub.round || 1 })}</span>
    </div>
    <div class="tpw__row">
      ${groups.map((g) => html`<button type="button" class=${`tpw__btn${g.id === group ? ' is-on' : ''}`} key=${g.id}
          onClick=${() => { setGroup(g.id); setSub(null); }}>${g.name}</button>`)}
    </div>
    ${active?.id === 'special' ? html`<div class="tpw__row">
      <button type="button" class=${`tpw__btn${sub === null ? ' is-on' : ''}`} onClick=${() => setSub(null)}>${t('全部')}</button>
      ${(Array.isArray(active.list) ? active.list : []).map((b) => html`<button type="button" key=${b.id}
          class=${`tpw__btn${sub === b.id ? ' is-on' : ''}`} onClick=${() => setSub(b.id)}>${b.name}</button>`)}
    </div>` : null}
    <div class="tpw__row"><${Search} value=${q} onChange=${setQ} placeholder=${t('搜索敌人')} /></div>
    <div class="tpw__list tpw__list--enemies">
      ${list.slice(0, 150).map((rec) => html`<${EnemyRow} m=${m} key=${rec.id} rec=${rec} disabled=${busy}
        onAdd=${() => add(rec)} />`)}
    </div>
    <div class="tpw__box">
      <div class="tpw__boxhead"><span class="tpw__label">${t('已选敌人')}</span>
        <button type="button" class="tpw__btn" disabled=${busy || !picks.length} onClick=${() => setPicks([])}>${t('清空')}</button></div>
      ${picks.length ? html`<div class="tpw__chips">
        ${picks.map((p) => html`<span class="tpw__pick" key=${p.id}>
          <span class="tpw__pick-name">${p.name}</span>
          <${Stepper} value=${p.count} min=${1} max=${20} busy=${busy} onChange=${(v) => setPicks(picks.map((x) => (x.id === p.id ? { ...x, count: v } : x)))} />
          <button type="button" class="tpw__slot-x" onClick=${() => remove(p.id)}>×</button>
        </span>`)}
      </div>` : html`<div class="tpw__hint">${t('还没有选择敌人')}</div>`}
    </div>
    <div class="tpw__row tpw__row--end">
      <button type="button" class="tpw__btn tpw__btn--primary" disabled=${busy || !picks.length}
        onClick=${() => send('enemies', enemiesArgs(mode, picks))}>${t('应用敌人配置')}</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------------------------------
// 迎战首领
// ---------------------------------------------------------------------------------------------------

function BossWindow({ pub, send, busy }) {
  const m = assetsOf();
  const groups = bossGroups();
  const card = (b) => {
    const jump = bossJump(pub, b);
    return html`<div class="tpw__boss" key=${b.id}>
      <img class="tpw__boss-img" src=${enemyIconUrl(m, b.enemyKey)} alt="" loading="lazy" />
      <div class="tpw__boss-main">
        <span class="tpw__boss-name">${b.name}</span>
        <span class="tpw__hint">${t('第 {r} 回合', { r: jump.round })} · ${t('击败后回到第 {r} 回合', { r: jump.returnRound })}</span>
      </div>
      <button type="button" class="tpw__btn tpw__btn--primary" disabled=${busy} onClick=${() => send('boss', { id: b.id })}>${t('迎战')}</button>
    </div>`;
  };
  return html`<div class="tpw__pane">
    <div class="tpw__warn">${t('击败首领后回到首领回合的前一回合继续游戏，不会结束本局')}</div>
    <div class="tpw__boxhead"><span class="tpw__label">${t('普通首领')}</span></div>
    <div class="tpw__box">${groups.normal.map(card)}</div>
    <div class="tpw__boxhead"><span class="tpw__label">${t('隐匿首领')}</span></div>
    <div class="tpw__box">${groups.hidden.length ? groups.hidden.map(card) : html`<div class="tpw__hint">${t('该模式没有隐匿首领')}</div>`}</div>
  </div>`;
}

// ---------------------------------------------------------------------------------------------------
// 资源与商店等级
// ---------------------------------------------------------------------------------------------------

function ResWindow({ pub, mine, send, busy }) {
  const [funds, setFunds] = useState(String(mine.funds ?? 0));
  const [lp, setLp] = useState(String(mine.lp ?? 0));
  const [cap, setCap] = useState(String(mine.deployCap ?? 0));
  const [bounty, setBounty] = useState('');
  const bountyList = (enemyGroups().find((g) => g.id === 'bounty')?.list) || [];
  return html`<div class="tpw__pane">
    <div class="tpw__row"><span class="tpw__label">${t('资金')}</span>
      <input class="tpw__input" type="number" min="0" value=${funds} onInput=${(e) => setFunds(e.target.value)} />
      <button type="button" class="tpw__btn" disabled=${busy} onClick=${() => send('funds', { amount: Math.max(0, Number(funds) || 0) })}>${t('应用')}</button></div>
    <div class="tpw__row"><span class="tpw__label">${t('目标生命')}</span>
      <input class="tpw__input" type="number" min="0" value=${lp} onInput=${(e) => setLp(e.target.value)} />
      <button type="button" class="tpw__btn" disabled=${busy} onClick=${() => send('lp', { value: Math.max(1, Number(lp) || 1) })}>${t('应用')}</button></div>
    <div class="tpw__row"><span class="tpw__label">${t('调度中心')}</span>
      <b>${mine.shop?.level ?? 1}</b>
      <button type="button" class="tpw__btn" disabled=${busy} onClick=${() => send('level', {})}>${t('升级调度中心')}</button>
      <button type="button" class="tpw__btn" disabled=${busy || (mine.shop?.level ?? 1) >= 6}
        onClick=${() => send('shopLevel', { level: 6 })}>${t('升到6级')}</button></div>
    <div class="tpw__row"><span class="tpw__label">${t('部署上限')}</span>
      <input class="tpw__input" type="number" min="1" max="12" value=${cap} onInput=${(e) => setCap(e.target.value)} />
      <button type="button" class="tpw__btn" disabled=${busy} onClick=${() => send('deployCap', { value: Math.max(1, Number(cap) || 1) })}>${t('应用')}</button></div>
    <div class="tpw__row"><span class="tpw__label">${t('悬赏敌人')}</span>
      <select class="tpw__input" value=${bounty} onChange=${(e) => setBounty(e.target.value)}>
        <option value="">${t('选择敌人')}</option>
        ${bountyList.map((b) => html`<option value=${b.id} key=${b.id}>${b.name}</option>`)}
      </select>
      <button type="button" class="tpw__btn" disabled=${busy || !bounty} onClick=${() => send('bounty', { id: bounty })}>${t('添加悬赏')}</button></div>
    <div class="tpw__hint">${t('第 {r} 回合 · 模式 {mode}', { r: pub.round || 1, mode: pub.modeId || '' })}</div>
  </div>`;
}

// ---------------------------------------------------------------------------------------------------
// window switch
// ---------------------------------------------------------------------------------------------------

const WINDOWS = Object.freeze({
  shop: ShopWindow, op: OpWindow, strategy: StrategyWindow, filter: FilterWindow,
  round: RoundWindow, map: MapWindow, enemies: EnemiesWindow, boss: BossWindow, res: ResWindow,
});

export function TestPluginWindow({ id, z, index, pub, mine, send, busy, onClose, onFocus }) {
  const ready = useData('chess', 'items', 'bonds', 'bands', 'stages', 'enemies', 'bosses', 'garrisons', 'choices', 'factions', 'assets');
  const spec = TEST_WINDOWS.find((w) => w.id === id);
  const Body = WINDOWS[id];
  return html`<${Frame} id=${id} title=${spec ? spec.key : id} z=${z} index=${index} onClose=${onClose} onFocus=${onFocus}>
    ${!Body ? html`<div class="tpw__hint">${t('未知窗口')}</div>`
      : !ready ? html`<div class="tpw__hint">${t('加载中')}</div>`
        : html`<${Body} pub=${pub} mine=${mine} send=${send} busy=${busy} />`}
  </${Frame}>`;
}
