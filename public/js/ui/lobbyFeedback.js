import { html, Button } from './components.js';
import { copyText } from './clipboard.js';
import { toast } from './toasts.js';
import { t } from '../../../shared/i18n.js';

export const FEEDBACK_GROUP = '243859707';

export async function copyFeedbackGroup(copy = copyText, notify = toast) {
  let copied = false;
  try { copied = await copy(FEEDBACK_GROUP); } catch { /* manual copy remains available */ }
  notify(copied ? t('已复制反馈群号 {group}', { group: FEEDBACK_GROUP }) : t('复制失败，请手动复制'), copied ? 'success' : 'warn');
  return copied;
}

/**
 * Hidden on this deployment (the maintainer's request of 2026-10-16): 243859707 is the upstream site's group, not ours.
 * The copy helper, the constant and `lobby.js`'s mount stay untouched, so bringing the chip back is one line here.
 */
export function LobbyFeedback() {
  return null;
}
