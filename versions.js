// ── Version history ───────────────────────────────────────────────────────────
// Saves earlier versions of each chapter so writers can read, compare, restore
// or copy from them.
//
// When versions are saved (only if the text differs from the last version):
//   • when a writing session on a chapter starts (the text before any change)
//   • when it ends (leaving the chapter, hiding or closing the page)
//   • every 15 minutes during a long session
//   • before any single change that removes 100 or more words
//   • on request, with a name ("Save version")
//   • before a restore, so a restore can itself be undone
//
// Where: this device's IndexedDB (separate from where chapters are saved, and
// with far more room), plus an owner-only cloud copy for signed-in writers.
// Nothing here changes how chapters themselves are saved.
//
// Retention: everything from the last 24 hours, then the newest per hour for a
// week, then the newest per day. Named versions are always kept.
(function () {
    const DB_NAME = 'draftpunk-versions';
    const STORE   = 'versions';
    const INTERVAL_MS    = 15 * 60 * 1000;
    const BIG_DELETE     = 100;   // words removed in one change
    const HOUR = 3600000, DAY = 86400000;

    // ── IndexedDB ───────────────────────────────────────────────────────────
    let dbPromise = null;
    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve) => {
            if (!window.indexedDB) return resolve(null);
            let req;
            try { req = indexedDB.open(DB_NAME, 1); } catch (e) { return resolve(null); }
            req.onupgradeneeded = () => {
                const s = req.result.createObjectStore(STORE, { keyPath: 'id' });
                s.createIndex('chapterId', 'chapterId');
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => resolve(null);
            req.onblocked = () => resolve(null);
        });
        return dbPromise;
    }
    async function idbPut(v) {
        const db = await openDb(); if (!db) return false;
        return new Promise(res => {
            try {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(v);
                tx.oncomplete = () => res(true); tx.onerror = () => res(false); tx.onabort = () => res(false);
            } catch (e) { res(false); }
        });
    }
    async function idbDelete(id) {
        const db = await openDb(); if (!db) return;
        return new Promise(res => {
            try { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = tx.onerror = () => res(); }
            catch (e) { res(); }
        });
    }
    async function idbList(chapterId) {
        const db = await openDb(); if (!db) return [];
        return new Promise(res => {
            try {
                const req = db.transaction(STORE, 'readonly').objectStore(STORE).index('chapterId').getAll(chapterId);
                req.onsuccess = () => res(req.result || []); req.onerror = () => res([]);
            } catch (e) { res([]); }
        });
    }

    // ── Helpers ─────────────────────────────────────────────────────────────
    function wordsIn(html) {
        if (typeof window.countWords === 'function') return window.countWords(html || '');
        const t = String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim();
        return t ? t.split(/\s+/).length : 0;
    }
    function deviceTag() {
        let d = null;
        try { d = localStorage.getItem('dpDeviceId'); } catch (e) {}
        return (d || 'd').slice(-6);
    }
    function newId(t) { return t.toString(36) + '-' + deviceTag() + '-' + Math.random().toString(36).slice(2, 6); }

    // ── State per chapter ───────────────────────────────────────────────────
    const S = {};   // id -> { projectId, prevHtml, started, dirty, lastSaveAt, latestHtml, loaded }
    function st(id) { return S[id] || (S[id] = { started: false, dirty: false, lastSaveAt: 0, latestHtml: null, loaded: null }); }

    async function loadLatest(id) {
        const s = st(id);
        if (!s.loaded) {
            s.loaded = idbList(id).then(list => {
                list.sort((a, b) => b.t - a.t);
                if (list[0] && s.latestHtml === null) s.latestHtml = list[0].html;
            });
        }
        return s.loaded;
    }

    // Save a version unless it matches the last one saved (named versions and
    // pre-restore copies are always saved).
    async function save(id, html, reason, opts) {
        opts = opts || {};
        const s = st(id);
        await loadLatest(id);
        if (!opts.force && s.latestHtml === html) return null;
        const t = Date.now();
        const v = {
            id: newId(t), chapterId: id, projectId: s.projectId || opts.projectId || null,
            t: t, html: html || '', words: wordsIn(html), reason: reason,
            name: opts.name || null, removed: opts.removed || 0
        };
        if (opts.title) v.title = opts.title;   // deleted chapters keep their title
        s.lastSaveAt = t;
        const savedLocally = await idbPut(v);
        let savedToCloud = false;
        if (window.pushVersionToCloud) {
            const push = window.pushVersionToCloud(id, v).then(ok => ok !== false, e => { console.warn('Version not saved to cloud:', e); return false; });
            // When it matters (before a restore) or this device can't store it, wait for the cloud
            if (opts.mustStore || !savedLocally) savedToCloud = await push;
        }
        v.stored = savedLocally || savedToCloud;
        if (v.stored) s.latestHtml = v.html;
        prune(id);
        return v;
    }

    // ── Retention ───────────────────────────────────────────────────────────
    function toKeep(list, now) {
        const sorted = list.slice().sort((a, b) => b.t - a.t);
        const keep = new Set(), seenHour = new Set(), seenDay = new Set();
        sorted.forEach((v, i) => {
            const age = now - v.t;
            if (i === 0 || v.name || age < DAY) { keep.add(v.id); return; }
            if (age < 7 * DAY) {
                const h = Math.floor(v.t / HOUR);
                if (!seenHour.has(h)) { seenHour.add(h); keep.add(v.id); }
                return;
            }
            const d = new Date(v.t); const dk = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
            if (!seenDay.has(dk)) { seenDay.add(dk); keep.add(v.id); }
        });
        return keep;
    }
    let pruning = {};
    async function prune(id) {
        if (pruning[id]) return; pruning[id] = true;
        try {
            const list = await idbList(id);
            const keep = toKeep(list, Date.now());
            for (const v of list) {
                if (!keep.has(v.id)) {
                    await idbDelete(v.id);
                    if (window.deleteCloudVersion) window.deleteCloudVersion(id, v.id).catch(() => {});
                }
            }
        } finally { pruning[id] = false; }
    }

    // ── Triggers (called from write.js) ─────────────────────────────────────
    const api = {
        // An editor has been (re)rendered with this text
        attach(id, projectId, html) {
            const s = st(id);
            s.projectId = projectId;
            s.prevHtml  = html;
            loadLatest(id);
        },

        // After every change in a chapter
        onInput(id, html) {
            const s = st(id);
            const before = s.prevHtml != null ? s.prevHtml : html;
            if (!s.started) {
                s.started = true;
                s.lastSaveAt = Date.now();
                save(id, before, 'session-start');           // the text as it was before this session
            }
            const removed = wordsIn(before) - wordsIn(html);
            if (removed >= BIG_DELETE) {
                save(id, before, 'big-delete', { removed });  // the text just before the big deletion
            }
            s.dirty = true;
            if (Date.now() - s.lastSaveAt >= INTERVAL_MS) save(id, html, 'interval');
            s.prevHtml = html;
        },

        // Undo/redo or a restore changed the text without typing
        resync(id, html) { st(id).prevHtml = html; },

        // Leaving a chapter, or the page being hidden or closed
        sessionEnd(id) {
            const s = S[id];
            if (!s || !s.dirty) return;
            s.dirty = false;
            s.started = false;          // the next change starts a new session
            save(id, s.prevHtml, 'session-end');
        },
        endAll() { Object.keys(S).forEach(id => api.sessionEnd(id)); },

        saveNamed(id, html, name) { return save(id, html, 'named', { name: name || 'Saved version', force: true }); },
        saveBeforeRestore(id, html) { return save(id, html, 'before-restore', { force: true, mustStore: true }); },
        saveDeleted(id, html, projectId, title) { return save(id, html, 'chapter-deleted', { force: true, projectId, title }); },

        // Chapters of this project that were deleted and aren't in the chapter
        // list now: the newest "when the chapter was deleted" copy of each,
        // from this device and (when signed in) the cloud. Read-only.
        async listDeleted(projectId, currentIds) {
            const skip = new Set(currentIds || []);
            const found = {};
            const add = v => {
                if (!v || v.reason !== 'chapter-deleted' || v.projectId !== projectId || skip.has(v.chapterId)) return;
                if (!found[v.chapterId] || found[v.chapterId].t < v.t) found[v.chapterId] = v;
            };
            const db = await openDb();
            if (db) {
                await new Promise(res => {
                    try {
                        const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
                        req.onsuccess = () => { const c = req.result; if (!c) return res(); add(c.value); c.continue(); };
                        req.onerror = () => res();
                    } catch (e) { res(); }
                });
            }
            if (window.listCloudDeletedChapters) {
                try { (await window.listCloudDeletedChapters([...skip])).forEach(add); }
                catch (e) { console.warn('Cloud deleted chapters not loaded:', e); }
            }
            return Object.values(found).sort((a, b) => b.t - a.t);
        },

        // All versions of a chapter: this device's plus any from the cloud
        async list(id) {
            let list = await idbList(id);
            if (window.listCloudVersions) {
                try {
                    const cloud = await window.listCloudVersions(id);
                    const have = new Set(list.map(v => v.id));
                    for (const v of (cloud || [])) {
                        if (!have.has(v.id) && v.html != null) { await idbPut(v); list.push(v); }
                    }
                } catch (e) { console.warn('Cloud versions not loaded:', e); }
            }
            const keep = toKeep(list, Date.now());
            return list.filter(v => keep.has(v.id)).sort((a, b) => b.t - a.t);
        },

        _toKeep: toKeep, _idbList: idbList
    };
    window.DPVersions = api;

    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') api.endAll(); });
    window.addEventListener('pagehide', () => api.endAll());

    // ── History panel ───────────────────────────────────────────────────────
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function when(t) {
        const d = new Date(t), now = new Date();
        const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const y = new Date(now); y.setDate(now.getDate() - 1);
        if (d.toDateString() === now.toDateString()) return 'Today ' + time;
        if (d.toDateString() === y.toDateString())   return 'Yesterday ' + time;
        return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }) + ' ' + time;
    }
    function label(v) {
        switch (v.reason) {
            case 'named':           return v.name || 'Saved version';
            case 'big-delete':      return `Before ${Number(v.removed || 0).toLocaleString()} words were deleted`;
            case 'before-restore':  return 'Before a restore';
            case 'session-start':   return 'Start of a writing session';
            case 'session-end':     return 'End of a writing session';
            case 'interval':        return 'Autosave during writing';
            case 'chapter-deleted': return 'When the chapter was deleted';
            default:                return 'Version';
        }
    }

    // Paragraphs of plain text, matching how the editor stores text: text sat
    // directly in the editor is the opening paragraph; each block is a paragraph.
    function paragraphs(html) {
        const root = document.createElement('div');
        root.innerHTML = html || '';
        const out = []; let loose = '';
        const flush = () => { if (loose.trim()) out.push(loose.trim()); loose = ''; };
        root.childNodes.forEach(n => {
            if (n.nodeType === 1 && /^(DIV|P|H2|H3)$/.test(n.tagName)) {
                flush();
                const t = (n.innerText !== undefined ? n.textContent : '').replace(/ /g, ' ').trim();
                if (t) out.push(n.tagName === 'H2' || n.tagName === 'H3' ? '## ' + t : t);
            } else if (n.nodeType === 1 && n.tagName === 'BR') { flush(); }
            else loose += n.textContent;
        });
        flush();
        return out;
    }
    // Longest-common-subsequence diff of two arrays
    function lcsDiff(a, b, limit) {
        const n = a.length, m = b.length;
        if (n * m > limit) return null;
        const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
        for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        const ops = []; let i = 0, j = 0;
        while (i < n && j < m) {
            if (a[i] === b[j]) { ops.push(['=', a[i]]); i++; j++; }
            else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(['-', a[i++]]); }
            else { ops.push(['+', b[j++]]); }
        }
        while (i < n) ops.push(['-', a[i++]]);
        while (j < m) ops.push(['+', b[j++]]);
        return ops;
    }
    function wordDiffHtml(oldP, newP) {
        const a = oldP.split(/(\s+)/), b = newP.split(/(\s+)/);
        const ops = lcsDiff(a, b, 250000);
        if (!ops) return `<del>${esc(oldP)}</del> <ins>${esc(newP)}</ins>`;
        return ops.map(([op, w]) => op === '=' ? esc(w) : op === '-' ? `<del>${esc(w)}</del>` : `<ins>${esc(w)}</ins>`).join('');
    }
    // Changes from the version (old) to the current text (new)
    function compareHtml(oldHtml, newHtml) {
        const A = paragraphs(oldHtml), B = paragraphs(newHtml);
        let ops = lcsDiff(A, B, 4000000);
        if (!ops) ops = [...A.map(p => ['-', p]), ...B.map(p => ['+', p])];
        // Within each run of changes, pair a removed paragraph with the added
        // paragraph most similar to it (an edited paragraph), and show the word
        // changes; anything unpaired is shown as wholly removed or added.
        const rows = [];
        const similarity = (a, b) => {
            const A = new Set(a.toLowerCase().split(/\s+/)), B = new Set(b.toLowerCase().split(/\s+/));
            let common = 0; A.forEach(w => { if (B.has(w)) common++; });
            return common / Math.max(1, Math.min(A.size, B.size));
        };
        for (let k = 0; k < ops.length; ) {
            if (ops[k][0] === '=') { rows.push(['=', esc(ops[k][1])]); k++; continue; }
            const dels = [], adds = [];
            while (k < ops.length && ops[k][0] !== '=') { (ops[k][0] === '-' ? dels : adds).push(ops[k][1]); k++; }
            const usedAdd = new Set(); let minAdd = 0;
            dels.forEach(d => {
                let best = -1, bestScore = 0.5;
                for (let a = minAdd; a < adds.length; a++) {
                    if (usedAdd.has(a)) continue;
                    const sc = similarity(d, adds[a]);
                    if (sc > bestScore) { bestScore = sc; best = a; }
                }
                if (best >= 0) {
                    // added paragraphs that come before the matched one appear first
                    for (let a = minAdd; a < best; a++) if (!usedAdd.has(a)) { rows.push(['+', esc(adds[a])]); usedAdd.add(a); }
                    rows.push(['~', wordDiffHtml(d, adds[best])]); usedAdd.add(best); minAdd = best + 1;
                } else rows.push(['-', esc(d)]);
            });
            adds.forEach((a, i) => { if (!usedAdd.has(i)) rows.push(['+', esc(a)]); });
        }
        if (!rows.some(r => r[0] !== '=')) return '<p class="ver-same">No differences — this version matches your current text.</p>';
        // Collapse long unchanged stretches
        let html = '', run = [];
        const flushRun = () => {
            if (run.length > 4) {
                html += `<p class="ver-eq">${run[0]}</p><p class="ver-skip">… ${run.length - 2} unchanged paragraphs …</p><p class="ver-eq">${run[run.length - 1]}</p>`;
            } else run.forEach(p => html += `<p class="ver-eq">${p}</p>`);
            run = [];
        };
        rows.forEach(([op, p]) => {
            if (op === '=') { run.push(p); return; }
            flushRun();
            html += `<p class="${op === '+' ? 'ver-add' : op === '-' ? 'ver-del' : 'ver-chg'}">${p}</p>`;
        });
        flushRun();
        return html;
    }

    async function openHistory(id) {
        const ch = (window.getExportChapters ? window.getExportChapters() : []).find(c => c.id === id);
        if (!ch) return;
        api.sessionEnd(id);   // capture any unsaved session first

        let ov = document.getElementById('versionOverlay');
        if (!ov) { ov = document.createElement('div'); ov.id = 'versionOverlay'; ov.className = 'export-overlay ver-overlay'; document.body.appendChild(ov); }
        ov.innerHTML = `<div class="export-box ver-box" role="dialog" aria-modal="true" aria-labelledby="verTitle">
            <div class="exp-head"><h2 id="verTitle">HISTORY</h2><button class="exp-x" id="verClose" aria-label="Close">✕</button></div>
            <p class="exp-note ver-chtitle">${esc(ch.title || 'Untitled')}</p>
            <div class="ver-save">
                <input type="text" id="verName" placeholder="Name this version (optional)" maxlength="80">
                <button id="verSaveBtn">SAVE VERSION</button>
            </div>
            <div class="ver-body">
                <div class="ver-list" id="verList"><p class="exp-note">Loading…</p></div>
                <div class="ver-detail" id="verDetail"><p class="exp-note">Choose a version to read, compare, restore or copy from.</p></div>
            </div>
        </div>`;
        ov.style.display = 'flex';
        const $ = s => document.getElementById(s);
        const close = () => { ov.style.display = 'none'; };
        $('verClose').onclick = close;
        ov.onclick = e => { if (e.target === ov) close(); };
        document.addEventListener('keydown', function escH(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escH); } });

        async function refreshList(selectId) {
            const list = await api.list(id);
            if (!list.length) {
                $('verList').innerHTML = '<p class="exp-note">No versions yet. They\'re saved automatically as you write, or you can save one now.</p>';
                return;
            }
            $('verList').innerHTML = list.map((v, i) => {
                const older = list[i + 1];
                const delta = older ? v.words - older.words : null;
                const d = delta === null ? '' : delta === 0 ? '±0' : (delta > 0 ? '+' : '−') + Math.abs(delta).toLocaleString();
                return `<button class="ver-item${v.reason === 'named' ? ' named' : ''}" data-id="${esc(v.id)}">
                    <span class="ver-when">${esc(when(v.t))}</span>
                    <span class="ver-label">${esc(label(v))}</span>
                    <span class="ver-words">${Number(v.words || 0).toLocaleString()} words${d ? ' · ' + d : ''}</span>
                </button>`;
            }).join('');
            $('verList').querySelectorAll('.ver-item').forEach(b => b.onclick = () => showDetail(list.find(v => v.id === b.dataset.id)));
            if (selectId) { const v = list.find(x => x.id === selectId); if (v) showDetail(v); }
        }

        function showDetail(v) {
            ov.querySelectorAll('.ver-item').forEach(b => b.classList.toggle('active', b.dataset.id === v.id));
            ov.querySelector('.ver-box').classList.add('show-detail');
            const current = (window.getExportChapters().find(c => c.id === id) || {}).content || '';
            $('verDetail').innerHTML = `
                <button class="ver-back" id="verBack">← ALL VERSIONS</button>
                <div class="ver-detail-head">
                    <div><b>${esc(when(v.t))}</b> · ${Number(v.words || 0).toLocaleString()} words<br><span class="exp-note">${esc(label(v))}</span></div>
                </div>
                <div class="exp-chips ver-tabs">
                    <label class="exp-chip"><input type="radio" name="verMode" value="read" checked><span>READ</span></label>
                    <label class="exp-chip"><input type="radio" name="verMode" value="compare"><span>COMPARE WITH NOW</span></label>
                </div>
                <div class="ver-text" id="verText"></div>
                <div class="ver-actions">
                    <button id="verCopy">COPY TEXT</button>
                    <button id="verRestore">RESTORE THIS VERSION</button>
                </div>
                <p class="exp-note">Restoring saves your current text as a version first, so you can always go back.</p>`;
            const render = mode => {
                if (mode === 'compare') {
                    $('verText').innerHTML = '<p class="exp-note ver-legend"><ins>Added since</ins> · <del>Removed since</del> this version</p>' + compareHtml(v.html, current);
                } else {
                    const clean = typeof window.sanitizeHtml === 'function' ? window.sanitizeHtml(v.html) : esc(v.html);
                    $('verText').innerHTML = `<div class="write-area ver-read">${clean}</div>`;
                }
            };
            ov.querySelectorAll('input[name=verMode]').forEach(r => r.onchange = () => render(r.value));
            render('read');
            $('verBack').onclick = () => ov.querySelector('.ver-box').classList.remove('show-detail');
            $('verCopy').onclick = async () => {
                const text = paragraphs(v.html).map(p => p.replace(/^## /, '')).join('\n\n');
                try { await navigator.clipboard.writeText(text); $('verCopy').textContent = 'COPIED'; }
                catch (e) {
                    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
                    document.execCommand('copy'); ta.remove(); $('verCopy').textContent = 'COPIED';
                }
            };
            $('verRestore').onclick = async () => {
                if (!confirm(`Replace the current text of "${ch.title}" with this version from ${when(v.t)}?\n\nYour current text will be saved as a version first.`)) return;
                $('verRestore').disabled = true; $('verRestore').textContent = 'RESTORING…';
                const ok = await window.restoreChapterVersion(id, v.html);
                if (ok) { close(); }
                else { $('verRestore').disabled = false; $('verRestore').textContent = 'RESTORE THIS VERSION'; }
            };
        }

        $('verSaveBtn').onclick = async () => {
            const cur = window.getExportChapters().find(c => c.id === id);
            const v = await api.saveNamed(id, cur ? cur.content : '', $('verName').value.trim());
            $('verName').value = '';
            $('verSaveBtn').textContent = 'SAVED';
            setTimeout(() => { const b = $('verSaveBtn'); if (b) b.textContent = 'SAVE VERSION'; }, 1500);
            refreshList(v && v.id);
        };
        refreshList();
    }
    window.openVersionHistory = openHistory;
    api._compareHtml = compareHtml;
})();
