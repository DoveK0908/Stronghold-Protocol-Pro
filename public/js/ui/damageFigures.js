// 项目 4 对局记录（结算台账）用的两个数字格式化函数。
//
// 局内的「作战统计」面板已经删掉了（维护者 2026-10-20：官方自带 combatMetrics，完全按官方来），这里只剩结算页
// 画 boss 轮伤害/治疗与 DPS 用的两个纯函数；服务端的伤害台账（server/match/damageBoard.js）不变。

import { t } from '../../../shared/i18n.js';

export function damageNumber(value) {
  const n = Number.isFinite(value) && value > 0 ? value : 0;
  if (n >= 1e8) return t('{0}亿', { 0: (n / 1e8).toFixed(2) });
  if (n >= 1e4) return t('{0}万', { 0: (n / 1e4).toFixed(2) });
  return String(Math.round(n));
}

export const damageRate = (total, seconds) => (seconds > 0 && Number.isFinite(total) ? total / seconds : null);
