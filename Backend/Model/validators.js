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

module.exports = { isRealName, isElevenDigitPhone };
