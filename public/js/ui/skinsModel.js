// Display-only operator choices: the JSON envelope of the 干员预设 toolbar (a preset carries its own skins section).
// The storage and the wire format are official (ui/skins.js SKINS_KEY / parseStoredSkins, docs/SKINS.md): this module
// only wraps a choice map in the preset's file format.
import { N_ } from '../../../shared/i18n.js';
import { SKINS_KEY, parseStoredSkins } from './skins.js';

export const SKINS_PREF = SKINS_KEY;
export const SKINS_VERSION = 1;
export const SKINS_IMPORT_MAX_BYTES = 256 * 1024;
export const SKINS_EXPORT_KIND = 'stronghold.skins';
export const toStoredSkins = (choices) => ({ v: SKINS_VERSION, choices: parseStoredSkins(choices) });
export function serializeSkins(choices) {
  return JSON.stringify({ kind: SKINS_EXPORT_KIND, ...toStoredSkins(choices) }, null, 2);
}
export function parseSkinImport(input) {
  let raw = input;
  if (typeof raw === 'string') {
    if (raw.length > SKINS_IMPORT_MAX_BYTES) return { ok: false, error: N_('内容过长，无法导入') };
    try { raw = JSON.parse(raw); } catch { return { ok: false, error: N_('无法识别的内容') }; }
  }
  if (!raw || raw.kind !== SKINS_EXPORT_KIND || raw.v !== SKINS_VERSION || !raw.choices || typeof raw.choices !== 'object' || Array.isArray(raw.choices)) {
    return { ok: false, error: N_('这不是当前版本的干员外观配置') };
  }
  const choices = parseStoredSkins(raw.choices);
  const asked = Object.keys(raw.choices).length, kept = Object.keys(choices).length;
  if (asked && !kept) return { ok: false, error: N_('这份配置没有当前版本可用的时装，未做任何改动') };
  return { ok: true, choices, dropped: asked - kept };
}
