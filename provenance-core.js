// ── Writing provenance: shared core ──────────────────────────────────────────
// Used by provenance.js (capture, on the write page) and evidence.js (report).
//
// A "batch" is a short run of edit events for one chapter (≤30s or ≤400 events).
// Each batch records timing and character counts for every edit, never the
// typed characters themselves. The chapter's text is fingerprinted (SHA-256)
// at the end of every batch, and a full plain-text snapshot is kept every
// ~10 minutes of writing so changes can be shown over time.
//
// When uploaded, batches for a chapter are chained: each carries the hash of
// the one before it, and Firestore stamps the server time on arrival.
//
// Event format inside a batch: [dt, kind, added, removed]
//   dt      ms since the previous event (first event: since batch start)
//   kind    t typed · n new line · c keyboard composition (mobile/IME)
//           r autocorrect/spellcheck replacement · p paste · x drag-drop
//           b burst (≥20 chars in one non-paste insert: dictation, text
//             expansion, autofill) · d delete · k cut · u undo/redo
//           f formatting · i imported file · z chapter deleted
//           o other/unexplained change
(function (global) {
    const DPProv = {};

    DPProv.VERSION   = 1;
    DPProv.BURST_MIN = 20;

    DPProv.KIND_LABELS = {
        t: 'Typed', n: 'New line', c: 'Keyboard composition', r: 'Autocorrect',
        p: 'Pasted', x: 'Dropped', b: 'Burst insert', d: 'Deleted', k: 'Cut',
        u: 'Undo/redo', f: 'Formatting', i: 'Imported', z: 'Chapter deleted', o: 'Other'
    };
    // Kinds whose added characters count as entered at the keyboard
    DPProv.TYPED_KINDS = new Set(['t', 'n', 'c', 'r']);
    // Kinds that insert text arriving from elsewhere
    DPProv.EXTERNAL_KINDS = new Set(['p', 'x', 'b', 'i', 'o']);

    DPProv.sha256 = async function (str) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    };

    // Fixed field order so the same batch always hashes the same way.
    DPProv.canonical = function (r) {
        return JSON.stringify([
            r.v, r.chapterId, r.projectId, r.seq, r.prevHash, r.deviceId, r.sessionId,
            r.start, r.end, r.startLen, r.len, r.textHash, r.snap == null ? null : r.snap,
            r.ev, r.recovered ? 1 : 0
        ]);
    };

    DPProv.hashBatch = function (r) { return DPProv.sha256(DPProv.canonical(r)); };

    // Chapter HTML → plain text with paragraph breaks
    DPProv.plainText = function (html) {
        if (!html) return '';
        const div = document.createElement('div');
        div.innerHTML = html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|h2|h3)>/gi, '\n');
        return div.textContent.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    };

    DPProv.countWords = function (text) {
        const t = (text || '').trim();
        return t ? t.split(/\s+/).length : 0;
    };

    DPProv.parseEvents = function (r) {
        try { return JSON.parse(r.ev || '[]'); } catch (e) { return []; }
    };

    // ── Verification ──────────────────────────────────────────────────────────
    // Cloud batches: hash, seq continuity, prev-hash links, snapshot fingerprints,
    // server-time lag. Local (unuploaded) batches can only be checked internally.
    const LATE_MS = 10 * 60 * 1000;

    DPProv.verifyChapter = async function (batches) {
        const cloud = batches.filter(b => typeof b.seq === 'number').sort((a, b) => a.seq - b.seq);
        const local = batches.filter(b => typeof b.seq !== 'number');
        const out = {
            cloudCount: cloud.length, localCount: local.length,
            hashFailures: [], linkFailures: [], gaps: [], snapFailures: [],
            lateUploads: 0, recovered: 0, unexplained: [], ok: true
        };

        let prev = null;
        for (const b of cloud) {
            const h = await DPProv.hashBatch(b);
            if (h !== b.hash) out.hashFailures.push(b.seq);
            if (prev === null) {
                if (b.seq !== 0) out.gaps.push([0, b.seq - 1]);
                if (b.seq === 0 && b.prevHash !== 'genesis') out.linkFailures.push(b.seq);
            } else {
                if (b.seq !== prev.seq + 1) out.gaps.push([prev.seq + 1, b.seq - 1]);
                else if (b.prevHash !== prev.hash) out.linkFailures.push(b.seq);
            }
            const st = DPProv.serverMs(b);
            if (st && st - b.end > LATE_MS) out.lateUploads++;
            prev = b;
        }

        for (const b of batches) {
            if (b.recovered) out.recovered++;
            if (b.snap != null && b.textHash && (await DPProv.sha256(b.snap)) !== b.textHash) {
                out.snapFailures.push(b.seq ?? 'local');
            }
            // Every change inside a batch should be accounted for by its events
            if (typeof b.startLen === 'number' && typeof b.len === 'number') {
                const net = DPProv.parseEvents(b).reduce((s, e) => s + (e[2] || 0) - (e[3] || 0), 0);
                if (net !== b.len - b.startLen) {
                    out.unexplained.push({ seq: b.seq ?? 'local', start: b.start, diff: (b.len - b.startLen) - net });
                }
            }
        }

        out.ok = !out.hashFailures.length && !out.linkFailures.length && !out.gaps.length && !out.snapFailures.length;
        return out;
    };

    DPProv.serverMs = function (b) {
        const s = b.serverTime;
        if (!s) return null;
        if (typeof s === 'number') return s;
        if (typeof s.toMillis === 'function') return s.toMillis();
        if (typeof s.seconds === 'number') return s.seconds * 1000 + Math.floor((s.nanoseconds || 0) / 1e6);
        return null;
    };

    // ── Analysis ──────────────────────────────────────────────────────────────
    const ACTIVE_GAP_MS  = 2 * 60 * 1000;   // gaps longer than this aren't "active"
    const SESSION_GAP_MS = 30 * 60 * 1000;  // gaps longer than this start a new session

    DPProv.analyse = function (batches) {
        const s = {
            added: {}, removed: 0, events: 0, activeMs: 0, sessions: 0,
            first: null, last: null, external: [], byDay: {},
            typedIntervals: [], pauses: 0, typedChars: 0, externalChars: 0, totalAdded: 0
        };
        const sorted = batches.slice().sort((a, b) => a.start - b.start);
        let lastEnd = null;

        for (const b of sorted) {
            if (s.first === null || b.start < s.first) s.first = b.start;
            if (s.last === null || b.end > s.last) s.last = b.end;
            if (lastEnd === null || b.start - lastEnd > SESSION_GAP_MS) s.sessions++;
            lastEnd = Math.max(lastEnd || 0, b.end);

            let t = b.start;
            let prevKind = null;
            for (const e of DPProv.parseEvents(b)) {
                const [dt, k, a, d] = e;
                t += dt;
                s.events++;
                if (dt < ACTIVE_GAP_MS) s.activeMs += dt;
                if (a) {
                    s.added[k] = (s.added[k] || 0) + a;
                    s.totalAdded += a;
                    const day = new Date(t).toISOString().slice(0, 10);
                    const row = s.byDay[day] || (s.byDay[day] = { typed: 0, external: 0, other: 0 });
                    if (DPProv.TYPED_KINDS.has(k)) { s.typedChars += a; row.typed += a; }
                    else if (DPProv.EXTERNAL_KINDS.has(k)) { s.externalChars += a; row.external += a; }
                    else row.other += a;
                    if (DPProv.EXTERNAL_KINDS.has(k)) {
                        s.external.push({ time: t, kind: k, chars: a, chapterId: b.chapterId });
                    }
                }
                if (d) s.removed += d;
                if (k === 't' && prevKind === 't') {
                    if (dt < 2000) s.typedIntervals.push(dt);
                    else if (dt < ACTIVE_GAP_MS) s.pauses++;
                }
                prevKind = k;
            }
        }

        const iv = s.typedIntervals.slice().sort((a, b) => a - b);
        const q = p => iv.length ? iv[Math.min(iv.length - 1, Math.floor(p * iv.length))] : null;
        s.intervalMedian = q(0.5);
        s.intervalP25    = q(0.25);
        s.intervalP75    = q(0.75);
        s.typedShare     = s.totalAdded ? s.typedChars / s.totalAdded : null;
        s.revisionRatio  = s.totalAdded ? s.removed / s.totalAdded : null;
        delete s.typedIntervals;
        return s;
    };

    // ── Paragraph diff between two snapshots ──────────────────────────────────
    DPProv.diffParagraphs = function (oldText, newText) {
        const a = (oldText || '').split('\n').filter(l => l.trim());
        const b = (newText || '').split('\n').filter(l => l.trim());
        const n = a.length, m = b.length;
        if (n * m > 4e6) return null; // too big to diff in the browser
        const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        const out = [];
        let i = 0, j = 0;
        while (i < n && j < m) {
            if (a[i] === b[j]) { out.push(['=', a[i]]); i++; j++; }
            else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(['-', a[i]]); i++; }
            else { out.push(['+', b[j]]); j++; }
        }
        while (i < n) out.push(['-', a[i++]]);
        while (j < m) out.push(['+', b[j++]]);
        return out;
    };

    global.DPProv = DPProv;
})(window);
