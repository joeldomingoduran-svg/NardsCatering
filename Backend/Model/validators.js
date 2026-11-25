// Heuristic check that a value looks like a real person's name, not random typing.
const LETTERS = 'A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u00FF';
const NAME_PATTERN = new RegExp(`^[${LETTERS}][${LETTERS}.'\\- ]*$`);
const KEYBOARD_RUNS = ['qwert', 'werty', 'asdf', 'sdfg', 'dfgh', 'fghj', 'ghjk', 'hjkl', 'zxcv', 'xcvb', 'cvbn', 'vbnm', 'abcd', 'bcde', 'cdef', 'defg', 'efgh', 'fghi', 'ghij', 'hijk', 'ijkl', 'jklm', 'klmn', 'lmno', 'mnop', 'nopq', 'opqr', 'pqrs', 'qrst', 'rstu', 'stuv', 'tuvw', 'uvwx', 'vwxy', 'wxyz'];

function isRealName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 4 || name.length > 80 || !NAME_PATTERN.test(name)) return false;

  const words = name.split(' ').map((w) => w.replace(/[^A-Za-z\u00C0-\u00FF]/g, '').toLowerCase()).filter(Boolean);
  const realWords = words.filter((w) => w.length >= 2);
  if (realWords.length < 2) return false;

  return realWords.every((w) =>
    /[aeiouyàáâãäåèéêëìíîïòóôõöùúûüñ]/.test(w) &&
    !/(.)\1\1/.test(w) &&
    !/[^aeiouyàáâãäåèéêëìíîïòóôõöùúûüñ]{5,}/.test(w) &&
    !KEYBOARD_RUNS.some((run) => w.includes(run))
  );
}

const isElevenDigitPhone = (value) => /^09\d{9}$/.test(String(value || '').trim());

const isValidEmail = (value) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(String(value || '').trim());

// Events may start from opening time until closing time (8:00 AM - 6:00 PM).
const OPENING_MINUTES = 8 * 60;
const CLOSING_MINUTES = 18 * 60;

function parseBusinessTime(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  const m24 = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(raw);
  if (m24 && !/(am|pm)$/.test(raw)) {
    const h = Number(m24[1]);
    const mm = Number(m24[2]);
    const mins = h * 60 + mm;
    if (mins < OPENING_MINUTES || mins > CLOSING_MINUTES) return null;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  const m12 = /^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?$/.exec(raw);
  if (!m12) return null;
  let h = Number(m12[1]);
  const mm = Number(m12[2] || 0);
  const mer = m12[3];
  if (mer === 'am') {
    if (h === 12) h = 0;
  } else if (mer === 'pm') {
    if (h < 12) h += 12;
  } else if (h >= 1 && h <= 6) {
    h += 12;
  }
  if (h > 23 || mm > 59) return null;
  const mins = h * 60 + mm;
  if (mins < OPENING_MINUTES || mins > CLOSING_MINUTES) return null;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function isWithinBusinessHours(time) {
  return parseBusinessTime(time) !== null;
}

module.exports = { isRealName, isElevenDigitPhone, isValidEmail, isWithinBusinessHours, parseBusinessTime };
