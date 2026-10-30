// Native opt-in test tools, separate from the host-only local test console. One draggable entry button and a set of
// floating windows: every window edits the current match only, and every control shows the player's own names and art
// instead of internal ids. No clock tool: the countdown freeze is gone.
import { useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { useStore } from '../store.js';
import { net } from '../net.js';
import { toast } from './toasts.js';
import { t } from '../../../shared/i18n.js';
import { testRefusalText } from './testAudit.js';
import { testPluginAvailable, TEST_WINDOWS } from './testPluginModel.js';
import { TestPluginWindow } from './testPluginWindows.js';

export function TestPlugin() {
  const pub = useStore((s) => s.match.public);
  const mine = useStore((s) => s.match.private);
  const myId = useStore((s) => s.me.playerId);
  // No child hooks, content loads, listeners or requests in disabled rooms / other seats' views.
  if (!testPluginAvailable(pub, mine, myId)) return null;
  return html`<${TestPluginDock} key=${pub.id || myId} pub=${pub} mine=${mine} />`;
}

const DOCK_POS_KEY = 'sp.testplugin.dock';
const WIN_POS_KEY = 'sp.testplugin.win';

export function readPos(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return Number.isFinite(p?.x) && Number.isFinite(p?.y) ? { x: Math.round(p.x), y: Math.round(p.y) } : null;
  } catch {
    return null;
  }
}

export function writePos(key, pos) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) }));
  } catch {
    // a private-mode window without storage still drags, it just forgets
  }
}

const clampX = (x, w, vw) => Math.round(Math.min(Math.max(4, x), Math.max(4, (vw || 1024) - w - 4)));
const clampY = (y, h, vh) => Math.round(Math.min(Math.max(4, y), Math.max(4, (vh || 768) - 36)));

function TestPluginDock({ pub, mine }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(() => readPos(DOCK_POS_KEY));
  const posRef = useRef(pos);
  posRef.current = pos;
  const drag = useRef(null);
  const moved = useRef(false);
  const [wins, setWins] = useState([]);
  const zRef = useRef(20);
  const [busy, setBusy] = useState(false);

  const send = async (cmd, args) => {
    if (busy) return false;
    setBusy(true);
    try {
      await net.request('g.testPlugin', { cmd, args });
      toast(t('已执行'));
      return true;
    } catch (err) {
      toast(testRefusalText(err), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const focusWin = (id) => {
    zRef.current += 1;
    const z = zRef.current;
    setWins((ws) => ws.map((w) => (w.id === id ? { ...w, z } : w)));
  };
  const openWin = (id) => {
    zRef.current += 1;
    const z = zRef.current;
    setWins((ws) => (ws.some((w) => w.id === id) ? ws.map((w) => (w.id === id ? { ...w, z } : w)) : [...ws, { id, z }]));
  };
  const closeWin = (id) => setWins((ws) => ws.filter((w) => w.id !== id));

  const onDown = (e) => {
    if (e.button !== 0 || !e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = { px: e.clientX, py: e.clientY, left: r.left, top: r.top, w: r.width, h: r.height };
    moved.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (!moved.current && Math.abs(e.clientX - d.px) + Math.abs(e.clientY - d.py) <= 3) return;
    moved.current = true;
    setPos({
      x: clampX(d.left + e.clientX - d.px, d.w, window.innerWidth),
      y: clampY(d.top + e.clientY - d.py, d.h, window.innerHeight),
    });
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (moved.current && posRef.current) writePos(DOCK_POS_KEY, posRef.current);
  };
  const onClick = () => {
    if (moved.current) {
      moved.current = false;
      return;
    }
    setOpen(!open);
  };

  // a dragged entry low on the screen opens its menu upwards, so the list cannot fall off the viewport
  const up = !!pos && pos.y > (window.innerHeight || 0) / 2;
  return html`<aside class=${`testplugin${pos ? ' is-placed' : ''}`} aria-label=${t('测试插件')}
    style=${pos ? `left:${pos.x}px;top:${pos.y}px` : null}>
    <button type="button" class="btn testplugin__dock" aria-expanded=${open}
      onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onUp}
      onClick=${onClick} title=${t('拖动移动')}>${open ? t('收起') : t('测试插件')}</button>
    ${open ? html`<nav class=${up ? 'testplugin__menu testplugin__menu--up' : 'testplugin__menu'} aria-label=${t('测试插件')}>
      ${TEST_WINDOWS.map((w) => html`<button type="button" class="testplugin__tab" key=${w.id}
          aria-pressed=${wins.some((x) => x.id === w.id)} onClick=${() => openWin(w.id)}>${w.key}</button>`)}
    </nav>` : null}
    ${wins.map((w, i) => html`<${TestPluginWindow} key=${w.id} id=${w.id} z=${w.z} index=${i}
      pub=${pub} mine=${mine} send=${send} busy=${busy}
      onClose=${() => closeWin(w.id)} onFocus=${() => focusWin(w.id)} />`)}
  </aside>`;
}

export { WIN_POS_KEY };
