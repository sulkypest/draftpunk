// ── Word counting (Nov 2026) ─────────────────────────────────────────────────
// One word counter for the whole app (Write page, import, version history,
// Writing Record, Word Runner). The server copy in
// firebase/functions/record-core.js uses the same rules; tests/wordcount.test.js
// checks the two agree.
//
// Rules:
//   • Formatting never splits a word: <i>Titanic</i>'s is one word.
//   • Paragraphs, headings and line breaks always separate words.
//   • Entities are decoded first, so AT&amp;T is one word.
//   • A word must contain at least one letter or number, so a dash with
//     spaces round it, a spaced ellipsis or a speech mark on its own is not
//     a word.
//   • Em and en dashes and the ellipsis character separate words, so
//     "paused—then" is two words. Hyphens do not: "well-known" is one.
//
//   countWordsHtml(html)  chapter HTML as the editor saves it
//   countWordsText(text)  plain text (Word Runner, Writing Record)
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.DPWordCount = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
                    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };

    function decodeEntities(s) {
        return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
            if (e[0] === '#') {
                const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
                try { return String.fromCodePoint(n); } catch (err) { return ' '; }
            }
            const k = e.toLowerCase();
            // Any other named entity is a symbol: keep it joined to its word
            return Object.prototype.hasOwnProperty.call(NAMED, k) ? NAMED[k] : '¤';
        });
    }

    // Block tags and line breaks separate words; inline tags (b, i, u, em,
    // strong, span…) are removed without adding a space.
    const BLOCK = /<\s*\/?\s*(br|p|div|h[1-6]|li|ul|ol|blockquote|tr|td|th|table|hr|section|article)\b[^>]*>/gi;

    function htmlToText(html) {
        return decodeEntities(String(html || '').replace(BLOCK, ' ').replace(/<[^>]*>/g, ''));
    }

    const SEPARATORS = /[\s–—…―]+/u;
    const HAS_WORD   = /[\p{L}\p{N}]/u;

    function countWordsText(text) {
        const t = String(text || '');
        if (!t.trim()) return 0;
        let n = 0;
        t.split(SEPARATORS).forEach(w => { if (w && HAS_WORD.test(w)) n++; });
        return n;
    }

    function countWordsHtml(html) {
        if (!html) return 0;
        return countWordsText(htmlToText(html));
    }

    return { countWordsHtml, countWordsText, htmlToText };
});
