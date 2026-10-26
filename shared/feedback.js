// The lobby's anonymous feedback board — the parts the browser and the server must agree on (server/feedbackBoard.js
// enforces them; public/js/ui/feedbackBoard.js draws them). Kept in shared/ so a change to a limit cannot land on one
// side only.

/** The four columns the board shows, in the order it shows them. */
export const FEEDBACK_STATUSES = Object.freeze(['open', 'declined', 'planned', 'done']);

/** The heading of each column, in the game's own words (the client passes these through `t()`). */
export const FEEDBACK_STATUS_LABEL = Object.freeze({
  open: '未读或讨论中',
  declined: '无计划',
  planned: '已计划',
  done: '已完成',
});

/** Everything the board enforces about what may be posted. */
export const FEEDBACK_LIMITS = Object.freeze({
  title: 80,
  body: 2000,
  reply: 1000,
  posts: 500,
  bodyBytes: 32 * 1024,
  writesPerMinute: 12,
  writeWindowMs: 60 * 1000,
  sessionMs: 12 * 60 * 60 * 1000,
});

/** The board's one HTTP path. */
export const FEEDBACK_PATH = '/api/feedback';
