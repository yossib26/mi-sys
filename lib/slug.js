// English-only URL slugs, including for Hebrew brand/campaign names.
// Hebrew letters are transliterated to Latin first (a simple
// consonant+vowel-ish mapping — Hebrew script normally omits vowels,
// so this is necessarily approximate, not a precise phonetic system),
// then everything non-alphanumeric is collapsed to '-'.
const HEBREW_TO_LATIN = {
  'א': 'a', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'o', 'ז': 'z',
  'ח': 'ch', 'ט': 't', 'י': 'i', 'כ': 'k', 'ך': 'k', 'ל': 'l', 'מ': 'm',
  'ם': 'm', 'נ': 'n', 'ן': 'n', 'ס': 's', 'ע': 'a', 'פ': 'p', 'ף': 'f',
  'צ': 'tz', 'ץ': 'tz', 'ק': 'k', 'ר': 'r', 'ש': 'sh', 'ת': 't',
};

function transliterate(text) {
  return String(text).split('').map((ch) => HEBREW_TO_LATIN[ch] ?? ch).join('');
}

function slugify(text) {
  return transliterate(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip Latin accents from normalize()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

module.exports = { slugify, transliterate };
