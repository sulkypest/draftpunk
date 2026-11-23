// ── Writing Record core (Nov 2026) ───────────────────────────────────────────
// Pure functions shared by the server (Cloud Function issueWritingRecord) and,
// later, the browser (the Verify page). No Firebase, no network, no storage.
//
//   buildSnapshot()  turns a writer's cloud chapters + Writing Record documents
//                    into the report shown on a share link (same shape the
//                    record page has always rendered).
//   fingerprint()    a fingerprint of the text: salted hashes of every run of
//                    five words. It can't be turned back into the text, but a
//                    copy of the text can be checked against it (compare()).
//
// Loaded with require() in Node, or as a plain script / module in a browser
// (window.DPRecordCore).
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DPRecordCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const SHINGLE = 5;            // words per run
    const FP_CAP  = 20000;        // most hashes kept (long novels are sampled)
    const PASTE_CAP = 500;        // most paste-log entries listed individually

    // ── Text ────────────────────────────────────────────────────────────────
    function decodeEntities(s) {
        return s.replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
            .replace(/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return ' '; } })
            .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return ' '; } })
            .replace(/&amp;/gi, '&');
    }
    // Chapter HTML (as the editor saves it) to plain text
    function htmlToText(html) {
        return decodeEntities(String(html || '')
            .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li|h[1-6])>/gi, '\n')
            .replace(/<[^>]+>/g, ''));
    }
    // Word count: the same rules as wordcount.js in the app (Nov 2026), so a
    // record shows the same figure as the Write page. tests/wordcount.test.js
    // checks the two agree.
    const WC_NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '\u2026', mdash: '\u2014', ndash: '\u2013',
                       lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D' };
    const WC_BLOCK = /<\s*\/?\s*(br|p|div|h[1-6]|li|ul|ol|blockquote|tr|td|th|table|hr|section|article)\b[^>]*>/gi;
    function countWordsHtml(html) {
        if (!html) return 0;
        const t = String(html).replace(WC_BLOCK, ' ').replace(/<[^>]*>/g, '')
            .replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
                if (e[0] === '#') {
                    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
                    try { return String.fromCodePoint(n); } catch (err) { return ' '; }
                }
                const k = e.toLowerCase();
                return Object.prototype.hasOwnProperty.call(WC_NAMED, k) ? WC_NAMED[k] : '\u00A4';
            });
        if (!t.trim()) return 0;
        let n = 0;
        t.split(/[\s\u2013\u2014\u2026\u2015]+/u).forEach(w => { if (w && /[\p{L}\p{N}]/u.test(w)) n++; });
        return n;
    }
    // Words for fingerprinting: forgiving of formatting, curly quotes, dashes,
    // capitals and apostrophes, so a story copied out of Word or a PDF still
    // matches the text typed in Draft Punk.
    function tokens(text) {
        const t = String(text || '').normalize('NFKC').toLowerCase().replace(/['’‘ʼ]/g, '');
        return t.match(/[\p{L}\p{N}]+/gu) || [];
    }

    // 32-bit hash (cyrb53, low half). Not secret; the salt makes each record's
    // hashes different from every other record's.
    function hash32(str) {
        let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
        for (let i = 0; i < str.length; i++) {
            const ch = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        return h1 >>> 0;
    }
    function shingleHashes(toks, salt) {
        const out = [];
        if (!toks.length) return out;
        const runs = Math.max(1, toks.length - SHINGLE + 1);
        for (let i = 0; i < runs; i++) out.push(hash32(salt + '|' + toks.slice(i, i + SHINGLE).join(' ')));
        return out;
    }
    function hex8(n) { return n.toString(16).padStart(8, '0'); }

    function fingerprint(text, salt) {
        const toks = tokens(text);
        const all = shingleHashes(toks, salt);
        const rate = Math.max(1, Math.ceil(all.length / FP_CAP));
        const kept = Array.from(new Set(all.filter(h => h % rate === 0))).sort((a, b) => a - b);
        return { v: 1, salt, size: SHINGLE, rate, words: toks.length, hashes: kept.map(hex8).join('') };
    }

    // How much of `text` appears in the fingerprinted text: the share of the
    // text's (sampled) five-word runs found in the record.
    function compare(fp, text) {
        if (!fp || !fp.hashes || !fp.salt) return null;
        const set = new Set();
        for (let i = 0; i + 8 <= fp.hashes.length; i += 8) set.add(parseInt(fp.hashes.slice(i, i + 8), 16));
        const toks = tokens(text);
        const rate = fp.rate || 1;
        const checked = shingleHashes(toks, fp.salt).filter(h => h % rate === 0);
        const found = checked.filter(h => set.has(h)).length;
        return { words: toks.length, checked: checked.length, found,
                 share: checked.length ? found / checked.length : 0,
                 exact: checked.length > 0 && found === checked.length && toks.length === fp.words };
    }

    // ── Report ──────────────────────────────────────────────────────────────
    const n = v => { const x = Number(v); return isFinite(x) && x > 0 ? x : 0; };
    const z = v => { const x = Number(v); return isFinite(x) ? x : 0; };
    const COUNTERS = ['typed', 'pasted', 'dropped', 'imported', 'deleted', 'earlierPastes', 'earlierPastedChars'];

    // All devices' figures for one chapter (as DPEvidence.summarise does)
    function summarise(doc) {
        const devs = Object.values((doc && doc.devices) || {}).filter(d => d && typeof d === 'object');
        const sum = { typed: 0, pasted: 0, dropped: 0, imported: 0, deleted: 0, earlierPastes: 0, earlierPastedChars: 0, pastes: [], days: {} };
        devs.forEach(c => {
            COUNTERS.forEach(k => sum[k] += n(c[k]));
            (Array.isArray(c.pastes) ? c.pastes : []).forEach(p => { if (p && typeof p === 'object') sum.pastes.push(p); });
            Object.entries(c.days && typeof c.days === 'object' ? c.days : {}).forEach(([k, v]) => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v) return;
                const t = sum.days[k] || (sum.days[k] = { typed: 0, pasted: 0, deleted: 0, min: 0, words: 0 });
                t.typed += n(v.typed); t.pasted += n(v.pasted); t.deleted += n(v.deleted); t.min += n(v.min); t.words += z(v.words);
            });
        });
        return { startedAt: n(doc && doc.startedAt), baselineWords: n(doc && doc.baselineWords), ...sum };
    }

    // chapters: cloud chapter documents ({ id, title, order, content })
    // evidence: cloud Writing Record documents ({ id, devices, startedAt, ... })
    function buildSnapshot({ title, author, chapters, evidence, now }) {
        const byId = {};
        (evidence || []).forEach(e => { if (e && e.id) byId[e.id] = e; });
        const list = (chapters || []).slice().sort((a, b) => z(a.order) - z(b.order));
        const snap = {
            v: 2, title: String(title || 'UNTITLED PROJECT').slice(0, 200), author: String(author || '').slice(0, 100),
            generatedAt: now, chapters: [], days: {}, pastes: [],
            totals: { typed: 0, pasted: 0, dropped: 0, imported: 0, deleted: 0, untrackedWords: 0, words: 0, earlierPastes: 0, earlierPastedChars: 0 },
            startedAt: 0
        };
        const texts = [];
        list.forEach(ch => {
            const words = countWordsHtml(ch.content);
            texts.push(htmlToText(ch.content));
            const ev = byId[ch.id];
            const s = ev ? summarise(ev) : null;
            const chTitle = String(ch.title || 'Untitled').slice(0, 200);
            const row = {
                title: chTitle, words,
                startedAt: s ? s.startedAt : 0,
                untrackedWords: s ? Math.min(s.baselineWords, words) : words,
                typed: s ? s.typed : 0, pasted: s ? s.pasted : 0, dropped: s ? s.dropped : 0,
                imported: s ? s.imported : 0, deleted: s ? s.deleted : 0,
                pasteCount: s ? s.pastes.length + s.earlierPastes : 0,
                sprint: !!(ev && ev.sprint), tracked: !!s
            };
            snap.chapters.push(row);
            const T = snap.totals;
            T.words += words; T.untrackedWords += row.untrackedWords;
            ['typed', 'pasted', 'dropped', 'imported', 'deleted'].forEach(k => T[k] += row[k]);
            if (s) {
                T.earlierPastes += s.earlierPastes; T.earlierPastedChars += s.earlierPastedChars;
                if (s.startedAt && (!snap.startedAt || s.startedAt < snap.startedAt)) snap.startedAt = s.startedAt;
                s.pastes.forEach(p => snap.pastes.push({ t: n(p.t), c: n(p.c), w: n(p.w), k: ['pasted', 'dropped', 'imported'].includes(p.k) ? p.k : 'pasted',
                                                         ch: chTitle, note: p.note === 'Word Runner sprint' ? p.note : '' }));
                Object.entries(s.days).forEach(([k, v]) => {
                    const d = snap.days[k] || (snap.days[k] = { typed: 0, pasted: 0, deleted: 0, min: 0, words: 0 });
                    d.typed += v.typed; d.pasted += v.pasted; d.deleted += v.deleted; d.min += v.min; d.words += v.words;
                });
            }
        });
        snap.pastes.sort((a, b) => a.t - b.t);
        if (snap.pastes.length > PASTE_CAP) {
            const old = snap.pastes.splice(0, snap.pastes.length - PASTE_CAP);
            snap.totals.earlierPastes += old.length;
            snap.totals.earlierPastedChars += old.reduce((s, p) => s + p.c, 0);
        }
        return { snapshot: snap, text: texts.join('\n\n') };
    }

    // ── Record codes, e.g. DP-7K3F-9QXM ───────────────────────────────────
    // Short enough to type into an entry form or read off a printout. Letters
    // that look alike (I, L, O, U) are never used; typed ones are read as the
    // digits they look like.
    const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    function makeCode(bytes) {          // bytes: 8 random bytes
        let out = '';
        for (let i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i] & 31];
        return 'DP-' + out.slice(0, 4) + '-' + out.slice(4);
    }
    function normaliseCode(s) {
        const t = String(s || '').toUpperCase().replace(/^\s*DP[\s-]*/, '').replace(/[\s-]/g, '')
            .replace(/[O]/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
        if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(t)) return null;
        return 'DP-' + t.slice(0, 4) + '-' + t.slice(4);
    }

    return { buildSnapshot, fingerprint, compare, tokens, htmlToText, countWordsHtml, hash32, summarise, makeCode, normaliseCode };
});
