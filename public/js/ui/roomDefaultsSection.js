// 设置 → 开房默认: the personal default for every 实验性选项 switch (the owner, 2026-10-25). A room this player creates
// starts with these rules; inside a room the host still edits them in 实验性选项 as usual, and these defaults never touch
// a room someone else opened. Off everywhere by default (a standard room), so the section's head stays quiet until the
// player turns something on.
import { html, Button, MicroLabel } from './components.js';
import { useStore } from '../store.js';
import { t } from '../../../shared/i18n.js';
import {
  ROOM_DEFAULT_KEYS, roomDefaultsStore, setRoomDefault, resetRoomDefaults, roomDefaultsAreDefault,
} from './roomDefaults.js';
import { MAX_SEATS } from '../../../shared/constants.js';

/** One row's copy: the switch's name and what a room it opens starts with (each literal inside t(), so i18n extracts it). */
export function roomDefaultCopy(key) {
  if (key === 'revivalEnabled') return [t('队友复活'), t('符合救援条件的队友可支付 10 生命抵消死亡，每人每局一次。')];
  if (key === 'disableSharedPool') return [t('禁用共享卡池'), t('每位博士使用独立卡池，不再争用同一干员库存。')];
  if (key === 'luckConsole') return [t('Luck 测试插件'), t('开局后允许打开 Luck 测试面板（改资金、回合、地图、盟约层数等）。')];
  if (key === 'bossHitSoftCap') return [t('限伤改为封顶'), t('本会被限伤取消的那一下按 29 万 9999 结算，打首领的大伤害不再白打。')];
  if (key === 'prepUnlimited') return [t('无限休整期'), t('休整期不再倒计时；所有还活着的博士都点「准备就绪」之后才进入战斗。')];
  if (key === 'benchExpand') return [t('整备区扩容'), t('待销毁区左边那三格空位变成整备区：整备区从 10 格变 13 格，多拿三个单位。')];
  return null;
}

export const ROOM_DEFAULT_TESTID = 'room-defaults-section';

/** 设置 → 开房默认: one switch per experimental option, plus 重置. */
export function RoomDefaultsSection() {
  const defaults = useStore((s) => s, Object.is, roomDefaultsStore);
  const any = !roomDefaultsAreDefault(defaults);
  return html`<section class="set-room-defaults" aria-labelledby="set-room-defaults-title" data-testid=${ROOM_DEFAULT_TESTID}>
    <div class="set-keys__head">
      <span class="set-row__label" id="set-room-defaults-title">${t('开房默认')}<${MicroLabel}>ROOM DEFAULTS<//></span>
      <span class="set-storage__actions">
        ${any ? html`<${Button} variant="ghost" size="sm" icon="refresh" data-testid="room-defaults-reset"
          onClick=${resetRoomDefaults}>${t('重置')}<//>` : null}
      </span>
    </div>
    <p class="set-hint">${any
      ? t('你开的房间会带着这些规则开局；房间里的「实验性选项」仍然可以随时改，别人开的房间不受影响。')
      : t('这些开关只影响你自己开的房间；都是关闭时按标准房间开局。')}</p>
    ${ROOM_DEFAULT_KEYS.filter((k) => roomDefaultCopy(k)).map((key) => {
      const [name, note] = roomDefaultCopy(key);
      return html`<label class="experimental-option" for=${`room-default-${key}`} key=${key}>
        <span><strong>${name}</strong><small>${note}</small></span>
        <input id=${`room-default-${key}`} type="checkbox" role="switch" data-testid=${`room-default-${key}`}
          checked=${defaults[key] === true} onChange=${(e) => setRoomDefault(key, e.currentTarget.checked)} />
      </label>`;
    })}
    <p class="set-hint">${t('扩展同盟人数与地图禁用属于每一局的单独决定，不在这里预设（可容纳 {n} 人）。', { n: MAX_SEATS })}</p>
  </section>`;
}
