// ── Writing provenance: capture (write page) ─────────────────────────────────
// Logs every edit in the chapter editors as timing + character counts, groups
// them into batches, fingerprints the chapter text, and uploads batches to
// Firestore as a per-chapter hash chain. Works offline / signed out: batches
// queue in IndexedDB and upload once the user is signed in.
// See provenance-core.js for the batch and event format.
(function () {
    const P = window.DPProv;
    if (!P || !window.crypto || !crypto.subtle) return;

    const BATCH_MS     = 30 * 1000;
    const IDLE_MS      = 10 * 1000;
    const BATCH_MAX    = 400;
    const SNAP_MS      = 10 * 60 * 1000;
    const SNAP_MAX     = 700 * 1024;   // keep docs well under Firestore's 1MB limit
    const STALE_MS     = 60 * 1000;    // another tab's state untouched this long is abandoned
    const DEVICE_KEY   = 'dpProvDevice';

    const rand = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    let deviceId = localStorage.getItem(DEVICE_KEY);
    if (!deviceId) { deviceId = 'dev_' + rand(); localStorage.setItem(DEVICE_KEY, deviceId); }
    const sessionId = 'ses_' + rand();
    // Per-tab keys so two open tabs never overwrite each other's batches
    const OPEN_KEY   = 'dpProvOpen_' + sessionId;
    const FROZEN_KEY = 'dpProvFrozen_' + sessionId;

    const open     = {};   // chapterId → open batch
    const pre      = {};   // chapterId → state captured in beforeinput
    const curLen   = {};   // chapterId → last known text length
    const lastSnap = {};   // chapterId → time of last snapshot this session
    let pasting    = null; // { chapterId, len, del } between notePaste and its input event

    function projectId() {
        try { return JSON.parse(localStorage.getItem('draftPunkData') || '{}').activeProjectId || null; }
        catch (e) { return null; }
    }
    function editorFor(id) { return document.getElementById('cheditor_' + id); }
    function chapterIdOf(el) {
        const ed = el && el.closest && el.closest('.write-area');
        return ed && ed.id.startsWith('cheditor_') ? ed.id.slice(9) : null;
    }
    function textLen(id) {
        const ed = editorFor(id);
        return ed ? ed.textContent.length : null;
    }
    function selectionLen() {
        const sel = window.getSelection();
        return sel && sel.rangeCount ? sel.toString().length : 0;
    }
    function rangesLen(e) {
        if (!e.getTargetRanges) return null;
        const ranges = e.getTargetRanges();
        if (!ranges.length) return null;
        let n = 0;
        for (const sr of ranges) {
            try {
                const r = document.createRange();
                r.setStart(sr.startContainer, sr.startOffset);
                r.setEnd(sr.endContainer, sr.endOffset);
                n += r.toString().length;
            } catch (err) { return null; }
        }
        return n;
    }

    function classify(type) {
        if (!type) return 'o';
        if (type === 'insertText') return 't';
        if (type === 'insertParagraph' || type === 'insertLineBreak') return 'n';
        if (type.startsWith('insertComposition') || type === 'insertFromComposition') return 'c';
        if (type === 'insertReplacementText') return 'r';
        if (type.startsWith('insertFromPaste')) return 'p';
        if (type === 'insertFromDrop') return 'x';
        if (type === 'deleteByCut') return 'k';
        if (type.startsWith('delete')) return 'd';
        if (type.startsWith('history')) return 'u';
        if (type.startsWith('format')) return 'f';
        return 'o';
    }

    // ── Open-batch persistence (sync, survives a tab being killed) ────────────
    let persistTimer = null;
    function persistOpen() {
        clearTimeout(persistTimer);
        persistTimer = setTimeout(persistOpenNow, 1000);
    }
    function persistOpenNow() {
        clearTimeout(persistTimer);
        try { localStorage.setItem(OPEN_KEY, JSON.stringify({ ts: Date.now(), open })); } catch (e) { /* quota */ }
    }

    function getBatch(id, now, before) {
        let b = open[id];
        if (!b) {
            // Start from the last length this tab saw, so changes made outside the
            // editor's input events (which bypass the log) show up as unexplained.
            const len = curLen[id] ?? before ?? textLen(id) ?? 0;
            b = open[id] = {
                v: P.VERSION, chapterId: id, projectId: projectId(), deviceId, sessionId,
                start: now, last: now, startLen: len, len, events: []
            };
        }
        return b;
    }

    function record(id, kind, add, del, now, newLen, before) {
        const b = getBatch(id, now, before);
        b.events.push([now - b.last, kind, add, del]);
        b.last = now;
        b.len  = newLen;
        curLen[id] = newLen;
        persistOpen();
        if (b.events.length >= BATCH_MAX) closeBatch(id, 'full');
    }

    // ── Input capture ─────────────────────────────────────────────────────────
    document.addEventListener('beforeinput', function (e) {
        const id = chapterIdOf(e.target);
        if (!id || (pasting && pasting.chapterId === id)) return;
        let del = rangesLen(e);
        if (del === null) del = selectionLen();
        pre[id] = { len: textLen(id), kind: classify(e.inputType), del };
        if (pre[id].kind === 'x' && e.dataTransfer) pre[id].dropLen = (e.dataTransfer.getData('text/plain') || '').length;
    }, true);

    document.addEventListener('input', function (e) {
        const id = chapterIdOf(e.target);
        if (!id) return;
        const now    = Date.now();
        const newLen = textLen(id);
        let kind, before, del = null;

        if (pasting && pasting.chapterId === id) {
            kind = 'p'; before = pasting.len; del = pasting.del;
            pasting = null;
        } else if (pre[id] && pre[id].len !== null) {
            kind = pre[id].kind; before = pre[id].len; del = pre[id].del;
        } else {
            before = curLen[id];
            kind = classify(e.inputType);
            if (before === undefined) { curLen[id] = newLen; return; } // no baseline yet
        }
        delete pre[id];

        const dl = newLen - before;
        let add, rem;
        // Formatting and undo don't remove the selected text, so only the net change counts
        if (kind === 'f' || kind === 'u') del = null;
        if (del !== null && del >= 0 && dl + del >= 0) { add = dl + del; rem = del; }
        else if (dl >= 0) { add = dl; rem = 0; }
        else { add = 0; rem = -dl; }

        // Large non-paste inserts in one go: dictation, text expanders, autofill
        if ((kind === 't' || kind === 'c' || kind === 'r') && add >= P.BURST_MIN) kind = 'b';
        if (kind === 'f' && (add || rem)) kind = 'o';
        record(id, kind, add, rem, now, newLen, before);
    }, true);

    // Keep the baseline right when content changes without an input event
    // (a chapter pulled from the cloud and re-rendered).
    function resetBaselines() {
        document.querySelectorAll('.write-area').forEach(ed => {
            const id = chapterIdOf(ed);
            if (id && !open[id]) curLen[id] = ed.textContent.length;
        });
    }

    // ── Freezing and finalising batches ──────────────────────────────────────
    function readFrozen() {
        try { return (JSON.parse(localStorage.getItem(FROZEN_KEY) || 'null') || { items: [] }).items; }
        catch (e) { return []; }
    }
    function writeFrozen(list) {
        try {
            if (list.length) localStorage.setItem(FROZEN_KEY, JSON.stringify({ ts: Date.now(), items: list }));
            else localStorage.removeItem(FROZEN_KEY);
        } catch (e) { /* quota */ }
    }

    // Synchronous: safe to call from pagehide.
    function closeBatch(id, reason) {
        const b = open[id];
        if (!b) return;
        delete open[id];
        persistOpenNow();
        if (!b.events.length) return;

        const ed   = editorFor(id);
        const text = ed ? P.plainText(ed.innerHTML) : null;
        const now  = Date.now();
        const wantSnap = text !== null && (!lastSnap[id] || now - lastSnap[id] >= SNAP_MS || reason === 'hide' || reason === 'snap');
        if (wantSnap) lastSnap[id] = now;

        const frozen = {
            v: b.v, chapterId: b.chapterId, projectId: b.projectId, deviceId: b.deviceId,
            sessionId: b.sessionId, start: b.start, end: b.last, startLen: b.startLen, len: b.len,
            ev: JSON.stringify(b.events), text, keepSnap: wantSnap && text !== null && text.length <= SNAP_MAX,
            recovered: false, fid: rand()
        };
        const list = readFrozen();
        list.push(frozen);
        writeFrozen(list);
        finaliseFrozen();
    }

    function closeAll(reason) { Object.keys(open).forEach(id => closeBatch(id, reason)); }

    let finalising = null;
    function finaliseFrozen() {
        if (finalising) { finalising.then(() => finaliseFrozen()); return finalising; }
        finalising = (async () => {
            let list = readFrozen();
            while (list.length) {
                const f = list[0];
                const rec = {
                    v: f.v, chapterId: f.chapterId, projectId: f.projectId, deviceId: f.deviceId,
                    sessionId: f.sessionId, start: f.start, end: f.end, startLen: f.startLen, len: f.len,
                    textHash: f.text === null ? null : await P.sha256(f.text),
                    snap: f.keepSnap ? f.text : null,
                    ev: f.ev, recovered: !!f.recovered
                };
                await queueAdd(rec);
                list = readFrozen().filter(x => x.fid !== f.fid);
                writeFrozen(list);
            }
        })().catch(err => console.warn('Provenance finalise failed:', err)).finally(() => { finalising = null; });
        finalising.then(() => uploadQueue());
        return finalising;
    }

    // Adopt state left by closed or crashed tabs. Finished-but-unsaved batches
    // are taken as they are. Batches still open when the tab died have no text
    // fingerprint (the text at that moment is unknown) and are marked recovered.
    function recoverAbandoned() {
        const now  = Date.now();
        const list = readFrozen();
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (!key || key === OPEN_KEY || key === FROZEN_KEY) continue;
            const isOpen = key.startsWith('dpProvOpen_'), isFrozen = key.startsWith('dpProvFrozen_');
            if (!isOpen && !isFrozen) continue;
            let data;
            try { data = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { data = null; }
            if (data && now - (data.ts || 0) < STALE_MS) continue; // that tab is still alive
            localStorage.removeItem(key);
            if (!data) continue;
            if (isFrozen) { (data.items || []).forEach(f => list.push(f)); continue; }
            Object.values(data.open || {}).forEach(b => {
                if (!b || !b.events || !b.events.length) return;
                list.push({
                    v: b.v, chapterId: b.chapterId, projectId: b.projectId, deviceId: b.deviceId,
                    sessionId: b.sessionId, start: b.start, end: b.last, startLen: b.startLen, len: b.len,
                    ev: JSON.stringify(b.events), text: null, keepSnap: false, recovered: true, fid: rand()
                });
            });
        }
        writeFrozen(list);
    }

    // ── IndexedDB upload queue ────────────────────────────────────────────────
    let dbPromise = null;
    function idb() {
        if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open('draftpunk-provenance', 1);
            req.onupgradeneeded = () => req.result.createObjectStore('queue', { keyPath: 'qid', autoIncrement: true });
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => reject(req.error);
        });
        return dbPromise;
    }
    function tx(mode, fn) {
        return idb().then(db => new Promise((resolve, reject) => {
            const t = db.transaction('queue', mode);
            const result = fn(t.objectStore('queue'));
            t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
            t.onerror = t.onabort = () => reject(t.error);
        }));
    }
    function queueAdd(rec)  { return tx('readwrite', s => s.add(rec)); }
    function queueAll()     { return tx('readonly',  s => s.getAll()); }
    function queueDelete(k) { return tx('readwrite', s => s.delete(k)); }

    // ── Upload as a per-chapter hash chain ────────────────────────────────────
    const heads = {}; // chapterId → { seq, hash } | null
    let uploading = false;

    async function uploadQueue() {
        if (uploading || !window.provCommit || !window.getCurrentUser || !window.getCurrentUser()) return;
        uploading = true;
        try {
            const items = (await queueAll()).sort((a, b) => a.qid - b.qid);
            for (const item of items) {
                let ok = false;
                for (let attempt = 0; attempt < 2 && !ok; attempt++) {
                    if (!(item.chapterId in heads)) heads[item.chapterId] = await window.provGetHead(item.chapterId);
                    const head = heads[item.chapterId];
                    const { qid, ...rec } = item;
                    rec.seq      = head ? head.seq + 1 : 0;
                    rec.prevHash = head ? head.hash : 'genesis';
                    rec.hash     = await P.hashBatch(rec);
                    try {
                        await window.provCommit(rec);
                        heads[item.chapterId] = { seq: rec.seq, hash: rec.hash };
                        await queueDelete(qid);
                        ok = true;
                    } catch (err) {
                        // Another device may have extended the chain: refresh head and retry once
                        delete heads[item.chapterId];
                        if (err && err.code !== 'permission-denied') throw err;
                    }
                }
                if (!ok) break;
            }
        } catch (err) {
            console.warn('Provenance upload paused:', err && err.message || err);
        } finally {
            uploading = false;
        }
    }

    // ── Hooks for write.js ────────────────────────────────────────────────────
    window.dpProv = {
        // Called by write.js just before it inserts pasted text itself
        notePaste(id) {
            if (!id) return;
            pasting = { chapterId: id, len: textLen(id), del: selectionLen() };
            setTimeout(() => { if (pasting && pasting.chapterId === id) pasting = null; }, 0);
        },
        // Called after an imported file has been rendered into a chapter
        noteImport(id) {
            const len = textLen(id) || 0;
            curLen[id] = 0;
            open[id] = open[id] || {
                v: P.VERSION, chapterId: id, projectId: projectId(), deviceId, sessionId,
                start: Date.now(), last: Date.now(), startLen: 0, len: 0, events: []
            };
            record(id, 'i', len, 0, Date.now(), len);
            closeBatch(id, 'snap'); // forces a snapshot of what was imported
        },
        // Called before a chapter is deleted
        noteDelete(id) {
            const len = textLen(id);
            if (len === null) return;
            closeBatch(id, 'idle');
            curLen[id] = len;
            getBatch(id, Date.now());
            open[id].events.push([0, 'z', 0, len]);
            open[id].len = 0;
            const b = open[id];
            delete open[id];
            const list = readFrozen();
            list.push({
                v: b.v, chapterId: b.chapterId, projectId: b.projectId, deviceId: b.deviceId,
                sessionId: b.sessionId, start: b.start, end: b.last, startLen: b.startLen, len: 0,
                ev: JSON.stringify(b.events), text: '', keepSnap: true, recovered: false, fid: rand()
            });
            writeFrozen(list);
            finaliseFrozen();
        },
        resetBaselines,
        flush() { closeAll('flush'); return finaliseFrozen(); },
        pendingCount() { return queueAll().then(q => q.length).catch(() => 0); },
        localBatches() { return queueAll().catch(() => []); },
        sessionId, deviceId
    };

    // ── Timers and lifecycle ──────────────────────────────────────────────────
    setInterval(() => {
        const now = Date.now();
        Object.keys(open).forEach(id => {
            const b = open[id];
            if (now - b.start >= BATCH_MS || now - b.last >= IDLE_MS) closeBatch(id, 'time');
        });
    }, 2000);
    setInterval(uploadQueue, 30 * 1000);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') closeAll('hide');
    });
    window.addEventListener('pagehide', () => closeAll('hide'));
    document.addEventListener('dpAuthChanged', e => {
        setTimeout(resetBaselines, 0);
        if (e.detail && e.detail.user) setTimeout(uploadQueue, 3000);
    });

    recoverAbandoned();
    finaliseFrozen();
    // Heartbeat so other tabs don't mistake this one's state for abandoned
    setInterval(() => {
        if (Object.keys(open).length) persistOpenNow();
        const f = readFrozen(); if (f.length) writeFrozen(f);
    }, 20 * 1000);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(resetBaselines, 0));
    else setTimeout(resetBaselines, 0);
})();
