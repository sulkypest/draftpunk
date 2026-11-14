// ── Writing Record (evidence of how text was entered) ─────────────────────────
// Records, per chapter, how text arrived in Draft Punk: typed (keyboard,
// phone keyboard, dictation, Word Runner sprints), pasted, dropped in or
// imported from a file, plus what was deleted, active writing minutes per day
// and every paste (time and size only — never the pasted text).
//
// SAFETY: this is kept apart from the chapter text, in its own storage key
// ('writingEvidence'). Every write is wrapped so a failure here can never stop
// a chapter from saving, and the record is size-capped. If browser storage
// fills up, write.js drops this record locally (it is backed up to the cloud
// for signed-in writers) so the chapter text can still be saved.
(function () {
    const KEY          = 'writingEvidence';
    const MAX_PASTES   = 300;         // per chapter per device; older ones are summarised
    const MAX_BYTES    = 400 * 1024;  // hard cap for the local record
    const SAVE_DELAY   = 2000;
    const CLOUD_DELAY  = 10000;

    function pad(n) { return String(n).padStart(2, '0'); }
    function dayKey(t) { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
    function minuteKey(t) { return Math.floor(t / 60000); }

    function deviceId() {
        let id = null;
        try { id = localStorage.getItem('dpDeviceId'); } catch (e) {}
        if (!id) {
            id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
            try { localStorage.setItem('dpDeviceId', id); } catch (e) {}
        }
        return id;
    }

    function emptyCounters() {
        return { typed: 0, pasted: 0, dropped: 0, imported: 0, deleted: 0,
                 pastes: [], earlierPastes: 0, earlierPastedChars: 0, days: {}, lastMinute: 0 };
    }

    let data = null;
    function load() {
        if (data) return data;
        try { data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { data = null; }
        if (!data || typeof data !== 'object' || !data.chapters) data = { v: 1, chapters: {} };
        data.device = deviceId();
        return data;
    }

    let saveTimer = null;
    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, SAVE_DELAY);
    }
    function saveNow() {
        clearTimeout(saveTimer);
        if (!data) return;
        try {
            let json = JSON.stringify(data);
            if (json.length > MAX_BYTES) { compact(); json = JSON.stringify(data); }
            localStorage.setItem(KEY, json);
        } catch (e) {
            // Storage full or unavailable: keep the record in memory only.
            // Never let this affect the writing itself.
            console.warn('Writing Record not saved locally:', e);
        }
    }
    // Shrink paste lists if the record gets large
    function compact() {
        Object.values(data.chapters).forEach(rec => {
            const c = rec.mine;
            if (c && c.pastes.length > 50) {
                const old = c.pastes.splice(0, c.pastes.length - 50);
                c.earlierPastes += old.length;
                c.earlierPastedChars += old.reduce((s, p) => s + p.c, 0);
            }
        });
    }

    // Plain text of the editor, used to measure changes
    function textLen(editor) { return (editor.textContent || '').length; }
    function wordsIn(text) { const t = (text || '').trim(); return t ? t.split(/\s+/).length : 0; }

    // Make sure a chapter has a record. Text already in the chapter when its
    // record is first made is marked as "untracked" — neither typed nor pasted.
    function ensure(id, projectId, currentText) {
        const d = load();
        let rec = d.chapters[id];
        if (!rec) {
            rec = d.chapters[id] = {
                projectId: projectId,
                startedAt: Date.now(),
                baselineChars: (currentText || '').length,
                baselineWords: wordsIn(currentText),
                mine: emptyCounters(),
                others: {}
            };
            scheduleSave();
        }
        if (!rec.mine) rec.mine = emptyCounters();
        if (!rec.others) rec.others = {};
        return rec;
    }

    const lastLen   = {};   // chapter id -> text length after the last recorded change
    const lastWords = {};
    const pending   = {};   // chapter id -> { source, inserted } set just before a known insert

    function today(rec, t) {
        const k = dayKey(t);
        const c = rec.mine;
        if (!c.days[k]) c.days[k] = { typed: 0, pasted: 0, deleted: 0, min: 0, words: 0 };
        return c.days[k];
    }

    function touchMinute(rec, t) {
        const m = minuteKey(t);
        if (rec.mine.lastMinute !== m) {
            rec.mine.lastMinute = m;
            today(rec, t).min++;
        }
    }

    const cloudTimers = {};
    function scheduleCloud(id) {
        clearTimeout(cloudTimers[id]);
        cloudTimers[id] = setTimeout(() => pushChapter(id), CLOUD_DELAY);
    }
    function pushChapter(id) {
        const d = load();
        const rec = d.chapters[id];
        if (!rec || !window.pushEvidenceToCloud) return;
        window.pushEvidenceToCloud(id, {
            projectId: rec.projectId, startedAt: rec.startedAt,
            baselineChars: rec.baselineChars, baselineWords: rec.baselineWords
        }, d.device, rec.mine);
    }

    window.DPEvidence = {
        // Call when an editor is (re)rendered, so the next change is measured
        // from its current length. Creates the record if needed.
        attach(id, projectId, editor) {
            const text = editor.textContent || '';
            ensure(id, projectId, text);
            lastLen[id]   = text.length;
            lastWords[id] = wordsIn(text);
        },

        // Called by the paste handler just before inserting pasted text
        notePaste(id, text, source) {
            pending[id] = { source: source || 'pasted', inserted: (text || '').length, words: wordsIn(text) };
        },

        // Called on every input event in a chapter editor
        recordInput(id, projectId, editor, inputType) {
            const rec = ensure(id, projectId, '');
            const now = Date.now();
            const len = textLen(editor);
            const prev = (lastLen[id] != null) ? lastLen[id] : len;
            const delta = len - prev;
            lastLen[id] = len;

            const p = pending[id]; delete pending[id];
            let source = 'typed';
            let inserted = Math.max(delta, 0);
            if (p) { source = p.source; inserted = p.inserted; }
            else if (inputType === 'insertFromDrop')  source = 'dropped';
            else if (inputType === 'insertFromPaste' || inputType === 'insertFromYank') source = 'pasted';
            const removed = Math.max(0, inserted - delta);

            const c = rec.mine, day = today(rec, now);
            if (inserted > 0) {
                c[source] += inserted;
                if (source === 'typed') day.typed += inserted; else day.pasted += inserted;
                if (source !== 'typed') {
                    c.pastes.push({ t: now, c: inserted, w: p ? p.words : 0, k: source });
                    if (c.pastes.length > MAX_PASTES) {
                        const old = c.pastes.shift();
                        c.earlierPastes++; c.earlierPastedChars += old.c;
                    }
                }
            }
            if (removed > 0) { c.deleted += removed; day.deleted += removed; }

            const w = wordsIn(editor.textContent);
            day.words += w - (lastWords[id] != null ? lastWords[id] : w);
            lastWords[id] = w;

            touchMinute(rec, now);
            scheduleSave();
            scheduleCloud(id);
        },

        // Undo/redo restores earlier text: re-measure without counting it
        resync(id, editor) {
            lastLen[id]   = textLen(editor);
            lastWords[id] = wordsIn(editor.textContent);
        },

        // A chapter created from imported or sprint text
        recordNewChapter(id, projectId, text, source, pastedChars) {
            const d = load();
            const rec = d.chapters[id] = {
                projectId: projectId, startedAt: Date.now(),
                baselineChars: 0, baselineWords: 0,
                mine: emptyCounters(), others: {}
            };
            const now = Date.now(), len = (text || '').length, day = today(rec, now);
            if (source === 'sprint') {
                const pasted = Math.min(len, pastedChars || 0);
                rec.mine.typed += len - pasted; day.typed += len - pasted;
                if (pasted > 0) {
                    rec.mine.pasted += pasted; day.pasted += pasted;
                    rec.mine.pastes.push({ t: now, c: pasted, w: 0, k: 'pasted', note: 'Word Runner sprint' });
                }
                rec.sprint = true;
            } else {
                rec.mine.imported += len; day.pasted += len;
                rec.mine.pastes.push({ t: now, c: len, w: wordsIn(text), k: 'imported' });
            }
            day.words += wordsIn(text);
            saveNow();
            if (window.pushEvidenceToCloud) setTimeout(() => pushChapter(id), 3000);
        },

        removeChapter(id) {
            const d = load();
            if (d.chapters[id]) { delete d.chapters[id]; saveNow(); }
        },

        // Merge records pulled from the cloud: other devices' figures are
        // replaced by the cloud copy; this device's own figures stay local.
        mergeFromCloud(docs) {
            const d = load();
            (docs || []).forEach(doc => {
                const devices = doc.devices || {};
                let rec = d.chapters[doc.id];
                if (!rec) {
                    rec = d.chapters[doc.id] = {
                        projectId: doc.projectId, startedAt: doc.startedAt || Date.now(),
                        baselineChars: doc.baselineChars || 0, baselineWords: doc.baselineWords || 0,
                        mine: emptyCounters(), others: {}
                    };
                } else if (doc.startedAt && doc.startedAt < rec.startedAt) {
                    // Another device started tracking earlier — its baseline is the true one
                    rec.startedAt = doc.startedAt;
                    rec.baselineChars = doc.baselineChars || 0;
                    rec.baselineWords = doc.baselineWords || 0;
                }
                rec.others = {};
                Object.keys(devices).forEach(dev => { if (dev !== d.device) rec.others[dev] = devices[dev]; });
            });
            saveNow();
        },

        // Totals for one chapter across all devices
        summarise(id) {
            const d = load();
            const rec = d.chapters[id];
            if (!rec) return null;
            const all = [rec.mine, ...Object.values(rec.others || {})].filter(Boolean);
            const sum = { typed: 0, pasted: 0, dropped: 0, imported: 0, deleted: 0, pastes: [], earlierPastes: 0, earlierPastedChars: 0, days: {} };
            all.forEach(c => {
                ['typed', 'pasted', 'dropped', 'imported', 'deleted', 'earlierPastes', 'earlierPastedChars'].forEach(k => sum[k] += c[k] || 0);
                (c.pastes || []).forEach(p => sum.pastes.push(p));
                Object.entries(c.days || {}).forEach(([k, v]) => {
                    const t = sum.days[k] || (sum.days[k] = { typed: 0, pasted: 0, deleted: 0, min: 0, words: 0 });
                    t.typed += v.typed || 0; t.pasted += v.pasted || 0; t.deleted += v.deleted || 0;
                    t.min += v.min || 0; t.words += v.words || 0;
                });
            });
            sum.pastes.sort((a, b) => a.t - b.t);
            return { startedAt: rec.startedAt, baselineChars: rec.baselineChars, baselineWords: rec.baselineWords,
                     sprint: !!rec.sprint, devices: all.length, ...sum };
        },

        // Drop the local copy (used only to free space for chapter text)
        dropLocal() {
            try { localStorage.removeItem(KEY); } catch (e) {}
        },

        flush: saveNow,
        _load: load
    };

    window.addEventListener('pagehide', saveNow);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
})();
