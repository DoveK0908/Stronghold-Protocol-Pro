// The edge host's own pages (deploy/stardust/feedback, deploy/stardust/monitoring), beside the feedback group: the
// public feedback board and the server status dashboard. Same origin and the same password gate as the game; they open
// in a new tab so the lobby and its connection stay where they are (the owner's request of 2026-10-16).
//
// Hidden on this deployment (the maintainer's request of 2026-10-17): our server does not serve either page, so the two
// entries would lead nowhere. The constants and `lobby.js`'s mount stay untouched — bringing the board back means
// restoring the markup here and deleting the early `return null`.
export const FEEDBACK_BOARD = '/feedback/';
export const STATUS_BOARD = '/monitor/';

export function SiteBoards() {
  return null;
}
