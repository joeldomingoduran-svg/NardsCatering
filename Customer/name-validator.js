// Mirrors Backend/Model/validators.js so the form can reject fake names before sending.
(function () {
  var LETTERS = 'A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u00FF';
  var NAME_PATTERN = new RegExp('^[' + LETTERS + '][' + LETTERS + ".'\\- ]*$");
  var VOWELS = /[aeiouy\u00e0-\u00e5\u00e8-\u00eb\u00ec-\u00ef\u00f2-\u00f6\u00f9-\u00fc\u00f1]/;
  var NO_VOWEL_RUN = /[^aeiouy\u00e0-\u00e5\u00e8-\u00eb\u00ec-\u00ef\u00f2-\u00f6\u00f9-\u00fc\u00f1]{5,}/;
  var KEYBOARD_RUNS = ['qwert', 'werty', 'asdf', 'sdfg', 'dfgh', 'fghj', 'ghjk', 'hjkl', 'zxcv', 'xcvb', 'cvbn', 'vbnm', 'abcd', 'bcde', 'cdef', 'defg', 'efgh', 'fghi', 'ghij', 'hijk', 'ijkl', 'jklm', 'klmn', 'lmno', 'mnop', 'nopq', 'opqr', 'pqrs', 'qrst', 'rstu', 'stuv', 'tuvw', 'uvwx', 'vwxy', 'wxyz'];

  window.isRealName = function (value) {
    var name = String(value || '').trim().replace(/\s+/g, ' ');
    if (name.length < 4 || name.length > 80 || !NAME_PATTERN.test(name)) return false;

    var words = name.split(' ')
      .map(function (w) { return w.replace(/[^A-Za-z\u00C0-\u00FF]/g, '').toLowerCase(); })
      .filter(function (w) { return w.length >= 2; });
    if (words.length < 2) return false;

    return words.every(function (w) {
      return VOWELS.test(w) &&
        !/(.)\1\1/.test(w) &&
        !NO_VOWEL_RUN.test(w) &&
        !KEYBOARD_RUNS.some(function (run) { return w.indexOf(run) !== -1; });
    });
  };
})();
