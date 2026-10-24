// Voice language belongs to the listener, not the room, operator appearance or interface language.
import { VOICE_LANGS } from './voicePrefs.js';

/** The listener's global dubs (voicePrefs.js VOICE_LANGS: 中文, 日本語, English, 한국어). */
export const VOICE_LANGUAGES = VOICE_LANGS;
export const normalizeVoiceLanguage = value => VOICE_LANGUAGES.includes(value) ? value : 'cn';

/** One selected-language line, then the ordinary Chinese line of the same battle slot. */
export function voiceCandidates(manifest, charId, slot, language, random = Math.random) {
  if (typeof charId !== 'string' || typeof slot !== 'string') return [];
  const audio = manifest?.audio;
  if (!audio) return [];
  const line = voices => voices && Object.hasOwn(voices, charId) && Object.hasOwn(voices[charId] || {}, slot) ? voices[charId][slot] : null;
  const chosen = normalizeVoiceLanguage(language);
  const roll = Math.max(0, Math.min(0.999999999, Number(random()) || 0));
  const pick = value => {
    const urls = (Array.isArray(value) ? value : [value]).filter(url => typeof url === 'string' && url);
    return urls.length ? urls[Math.floor(roll * urls.length)] : null;
  };
  const chinese = pick(line(audio.voiceByLang?.cn)) || pick(line(audio.voice));
  const selected = audio.voiceByLang?.[chosen] ?? (chosen === 'jp' ? audio.voiceJp : null);
  const preferred = chosen === 'cn' ? chinese : pick(line(selected));
  // 只有日配的干员（结城理）：中文档没有中文候选时才用他的日配，有中文候选就保持原样
  const jpOnly = chosen === 'cn' && !preferred ? pick(line(audio.voiceByLang?.jp ?? audio.voiceJp)) : null;
  return [...new Set([preferred, chosen === 'cn' ? jpOnly : chinese].filter(Boolean))];
}
