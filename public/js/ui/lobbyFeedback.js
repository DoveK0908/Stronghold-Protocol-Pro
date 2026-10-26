import { html, Icon } from './components.js';
import { t } from '../../../shared/i18n.js';

export const FEEDBACK_GROUP = '243859707';

/**
 * The lobby's 反馈 chip (hub-contact row). It opens the in-game anonymous feedback board (ui/feedbackBoard.js) — no group
 * number, no external site, so it works on this deployment.
 * @param {{ onOpen?: () => void }} props
 */
export function LobbyFeedback({ onOpen }) {
  if (!onOpen) return null;
  return html`<button type="button" class="lobby-feedback" onClick=${onOpen} aria-haspopup="dialog"
      title=${t('反馈板：不需要登录，发帖不记录任何身份')}>
    <${Icon} name="edit" /><span class="lobby-feedback__label">${t('反馈板')}</span>FEEDBACK
  </button>`;
}
