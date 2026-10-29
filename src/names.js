// First-name rules: tidy up spacing, match names ignoring capitalization and
// extra spaces, and block inappropriate names.
import { SUBSTRINGS, WHOLE_WORDS } from './blocklist.js';

export const MAX_NAME_LENGTH = 20;

export function cleanName(raw) {
  return String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

// "  maya   R " and "Maya r" are the same student.
export function nameKey(raw) {
  return cleanName(raw).toLowerCase();
}

function displayName(name) {
  // Capitalize names typed in all lowercase ("maya" -> "Maya"); keep anything else as typed.
  if (name !== name.toLowerCase()) return name;
  return name.replace(/(^|[\s\-'’])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}

const plain = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function isBlocked(name) {
  const base = plain(name);
  const letters = base.replace(/[^a-z]/g, '');
  const squeezed = letters.replace(/(.)\1+/g, '$1');
  const words = base.split(/[^a-z]+/).filter(Boolean);
  if (SUBSTRINGS.some((w) => letters.includes(w) || squeezed.includes(w))) return true;
  const whole = new Set([...words, ...words.map((w) => w.replace(/(.)\1+/g, '$1')), letters, squeezed]);
  return WHOLE_WORDS.some((w) => whole.has(w));
}

export function checkName(raw) {
  const name = cleanName(raw);
  if (!name) return { ok: false, error: 'Please type your first name.' };
  if ([...name].length > MAX_NAME_LENGTH) return { ok: false, error: `Please use just your first name (${MAX_NAME_LENGTH} letters or fewer).` };
  if (!/^\p{L}[\p{L}\p{M}' .\-’]*$/u.test(name)) return { ok: false, error: 'Names can only use letters, spaces, hyphens, and apostrophes.' };
  if (isBlocked(name)) return { ok: false, error: 'Please use your real first name.' };
  return { ok: true, name: displayName(name), key: nameKey(name) };
}
