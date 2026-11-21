// ── Writing Record report page ────────────────────────────────────────────────
// Two modes:
//   record.html             the writer's own report, built from this device's
//                           data (plus other devices' figures pulled from the cloud)
//   record.html?share=ID    a read-only shared report, loaded from the cloud
// Everything shown is built with textContent / escaping, because shared reports
// display data that came from someone else's device.
(function () {
    const params  = new URLSearchParams(location.search);
    const shareId = params.get('share');

    function esc(v) {
        return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function num(v) { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; }
    function fmt(n) { return Math.round(num(n)).toLocaleString(); }
    function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }
    function charsToWords(c) { return Math.round(num(c) / 6); }   // rough: average word + space
    function fmtDate(t) { return t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }
    function fmtDateTime(t) {
        return t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    }
    function fmtDay(k) {
        const [y, m, d] = String(k).split('-').map(Number);
        return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    }
    function fmtMins(m) {
        m = Math.round(num(m));
        const h = Math.floor(m / 60), r = m % 60;
        return h ? `${h}h ${r}m` : `${r}m`;
    }
    function countWordsHtml(html) {
        const t = String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/gi, ' ').trim();
        return t ? t.split(/\s+/).length : 0;
    }

    // ── Build the report data from this device ───────────────────────────────
    function buildSnapshot(author) {
        const dp   = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
        const pid  = dp.activeProjectId;
        const proj = (dp.projects && dp.projects[pid]) || {};
        const wd   = JSON.parse(localStorage.getItem('writingData') || '{}');
        const chapters = (wd.projectId === pid && Array.isArray(wd.chapters)) ? wd.chapters.slice() : [];
        chapters.sort((a, b) => (a.order || 0) - (b.order || 0));

        const snap = {
            v: 1, title: proj.title || 'UNTITLED PROJECT', author: author || '',
            generatedAt: Date.now(), chapters: [], days: {}, pastes: [],
            totals: { typed: 0, pasted: 0, dropped: 0, imported: 0, deleted: 0, untrackedWords: 0, words: 0, earlierPastes: 0, earlierPastedChars: 0 },
            startedAt: 0
        };
        chapters.forEach(ch => {
            const words = ch.wordCount != null ? ch.wordCount : countWordsHtml(ch.content);
            const s = window.DPEvidence && window.DPEvidence.summarise(ch.id);
            const row = {
                title: ch.title || 'Untitled', words: words,
                startedAt: s ? s.startedAt : 0,
                untrackedWords: s ? s.baselineWords : words,
                typed: s ? s.typed : 0, pasted: s ? s.pasted : 0, dropped: s ? s.dropped : 0,
                imported: s ? s.imported : 0, deleted: s ? s.deleted : 0,
                pasteCount: s ? s.pastes.length + s.earlierPastes : 0,
                sprint: s ? s.sprint : false, tracked: !!s
            };
            snap.chapters.push(row);
            const T = snap.totals;
            T.words += words; T.untrackedWords += row.untrackedWords;
            ['typed', 'pasted', 'dropped', 'imported', 'deleted'].forEach(k => T[k] += row[k]);
            if (s) {
                T.earlierPastes += s.earlierPastes; T.earlierPastedChars += s.earlierPastedChars;
                if (s.startedAt && (!snap.startedAt || s.startedAt < snap.startedAt)) snap.startedAt = s.startedAt;
                s.pastes.forEach(p => snap.pastes.push({ t: p.t, c: p.c, w: p.w || 0, k: p.k || 'pasted', ch: row.title, note: p.note || '' }));
                Object.entries(s.days).forEach(([k, v]) => {
                    const d = snap.days[k] || (snap.days[k] = { typed: 0, pasted: 0, deleted: 0, min: 0, words: 0 });
                    d.typed += v.typed; d.pasted += v.pasted; d.deleted += v.deleted; d.min += v.min; d.words += v.words;
                });
            }
        });
        snap.pastes.sort((a, b) => a.t - b.t);
        return snap;
    }

    // ── Render ───────────────────────────────────────────────────────────────
    function render(snap, opts) {
        const T = snap.totals || {};
        const notTyped = num(T.pasted) + num(T.dropped);
        const added = num(T.typed) + notTyped + num(T.imported);
        const typedPct = pct(num(T.typed), added);
        const days = Object.entries(snap.days || {}).sort((a, b) => a[0] < b[0] ? -1 : 1);
        const totalMins = days.reduce((s, [, d]) => s + num(d.min), 0);
        const pastes = Array.isArray(snap.pastes) ? snap.pastes : [];
        const pasteCount = pastes.length + num(T.earlierPastes);
        const pastedWords = pastes.filter(p => p.k !== 'imported').reduce((s, p) => s + (num(p.w) || charsToWords(p.c)), 0);
        const importedWords = pastes.filter(p => p.k === 'imported').reduce((s, p) => s + (num(p.w) || charsToWords(p.c)), 0);
        const maxMins = days.reduce((m, [, d]) => Math.max(m, num(d.min)), 1);

        let html = '';
        html += `<div class="record-head">
            <div class="record-kicker">WRITING RECORD</div>
            <h1 class="record-title">${esc(snap.title)}</h1>
            <div class="record-meta">${snap.author ? esc(snap.author) + ' · ' : ''}${opts.shared ? 'Shared' : 'Generated'} ${esc(fmtDateTime(snap.generatedAt))}</div>
        </div>`;

        if (!added && !num(T.untrackedWords)) {
            html += `<p class="record-muted">Nothing has been written in this project yet.</p>`;
        } else {
            html += `<div class="record-headline">
                <div class="record-big">${added ? typedPct + '%' : '—'}</div>
                <div class="record-big-label">${added
                    ? `of the text added since this record began${snap.startedAt ? ' (' + esc(fmtDate(snap.startedAt)) + ')' : ''} was typed in Draft Punk`
                    : 'No new text has been added since this record began'}</div>
            </div>`;
            if (added) {
                const pP = pct(notTyped, added), pI = Math.max(0, 100 - typedPct - pP);
                html += `<div class="record-bar" role="img" aria-label="${typedPct}% typed, ${pP}% pasted, ${pI}% imported from a file">
                    <span class="seg typed" style="width:${typedPct}%"></span><span class="seg pasted" style="width:${pP}%"></span><span class="seg imported" style="width:${pI}%"></span>
                </div>
                <div class="record-legend">
                    <span><i class="sw typed"></i>Typed ${typedPct}%</span>
                    <span><i class="sw pasted"></i>Pasted ${pP}%</span>
                    ${pI ? `<span><i class="sw imported"></i>Imported from a file ${pI}%</span>` : ''}
                </div>`;
            }
            html += `<div class="record-facts">
                <div><b>${fmt(T.words)}</b><span>words now</span></div>
                <div><b>${fmtMins(totalMins)}</b><span>active writing over ${days.length} day${days.length === 1 ? '' : 's'}</span></div>
                <div><b>${fmt(pasteCount)}</b><span>paste${pasteCount === 1 ? '' : 's'}${pastedWords ? ' (~' + fmt(pastedWords) + ' words)' : ''}</span></div>
                <div><b>${fmt(T.untrackedWords)}</b><span>words already written before the record began (untracked)</span></div>
            </div>`;
        }

        // Timeline
        if (days.length) {
            html += `<h2 class="record-h2">WRITING TIMELINE</h2><div class="record-days">`;
            days.slice().reverse().forEach(([k, d]) => {
                const add = num(d.typed) + num(d.pasted);
                const w = Number(d.words) || 0;
                html += `<div class="record-day">
                    <span class="rd-date">${esc(fmtDay(k))}</span>
                    <span class="rd-bar"><span style="width:${Math.max(2, (num(d.min) / maxMins) * 100)}%"></span></span>
                    <span class="rd-min">${fmtMins(d.min)}</span>
                    <span class="rd-words">${w >= 0 ? '+' : '−'}${fmt(Math.abs(w))} words</span>
                    <span class="rd-typed">${add ? pct(num(d.typed), add) + '% typed' : '—'}</span>
                </div>`;
            });
            html += `</div>`;
        }

        // Chapters
        if ((snap.chapters || []).length) {
            html += `<h2 class="record-h2">CHAPTERS</h2><div class="record-table-wrap"><table class="record-table">
                <thead><tr><th>Chapter</th><th>Words</th><th>Typed</th><th>Pastes</th><th>Untracked</th><th>Record began</th></tr></thead><tbody>`;
            snap.chapters.forEach(c => {
                const a = num(c.typed) + num(c.pasted) + num(c.dropped) + num(c.imported);
                html += `<tr>
                    <td>${esc(c.title)}${c.sprint ? ' <span class="record-tag">SPRINT</span>' : ''}</td>
                    <td>${fmt(c.words)}</td>
                    <td>${a ? pct(num(c.typed), a) + '%' : '—'}</td>
                    <td>${fmt(c.pasteCount)}</td>
                    <td>${num(c.untrackedWords) ? fmt(c.untrackedWords) + ' words' : '—'}</td>
                    <td>${c.tracked ? esc(fmtDate(c.startedAt)) : 'not yet'}</td>
                </tr>`;
            });
            html += `</tbody></table></div>`;
        }

        // Paste log
        if (pastes.length || num(T.earlierPastes)) {
            html += `<h2 class="record-h2">PASTE AND IMPORT LOG</h2>
                <p class="record-muted">Every time text was pasted, dropped or imported. Only the time and size are kept, never the text itself.</p>
                <div class="record-table-wrap"><table class="record-table"><thead><tr><th>When</th><th>Chapter</th><th>Size</th><th>How</th></tr></thead><tbody>`;
            const shown = pastes.slice().reverse().slice(0, 200);
            shown.forEach(p => {
                const words = num(p.w) ? fmt(p.w) + ' words' : '~' + fmt(Math.max(1, charsToWords(p.c))) + ' words';
                const how = p.k === 'imported' ? 'Imported from a file' : p.k === 'dropped' ? 'Dropped in' : 'Pasted' + (p.note ? ' (' + esc(p.note) + ')' : '');
                html += `<tr><td>${esc(fmtDateTime(p.t))}</td><td>${esc(p.ch)}</td><td>${words}</td><td>${how}</td></tr>`;
            });
            html += `</tbody></table></div>`;
            const more = pastes.length - shown.length + num(T.earlierPastes);
            if (more > 0) html += `<p class="record-muted">Plus ${fmt(more)} earlier paste${more === 1 ? '' : 's'} not listed individually.</p>`;
        }

        html += `<h2 class="record-h2">ABOUT THIS RECORD</h2>
            <div class="record-about">
                <p>Draft Punk records how text arrives in each chapter as it is written: typed (on a keyboard, a phone keyboard or by dictation, including Word Runner sprints), pasted, dropped in, or imported from a file. Deletions and active writing time are recorded too. The text itself is not part of this record.</p>
                <p>Text that was already in a chapter when its record began is shown as <b>untracked</b>: it is not counted as either typed or pasted.</p>
                <p>This record shows how text was entered into Draft Punk. It cannot show who composed it: text from elsewhere can be retyped by hand, and the record is kept on the writer's own devices. It is evidence of a writing process, not proof of authorship.</p>
                ${opts.shared ? '<p>This is a snapshot from the date above and does not update by itself.</p>' : ''}
            </div>`;

        document.getElementById('recordRoot').innerHTML = html;
    }

    // ── Share controls (writer's own report only) ────────────────────────────
    function shareKey() {
        const dp = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
        return 'dpRecordShare_' + (dp.activeProjectId || '');
    }
    function renderShareBox(snapRef) {
        const box = document.getElementById('recordShareBox');
        if (!box) return;
        const user = window.getCurrentUser && window.getCurrentUser();
        const existing = localStorage.getItem(shareKey());
        if (!user) {
            box.innerHTML = `<button onclick="dpOpenSignIn()">⊕ SIGN IN TO CREATE A SHARE LINK</button>
                <p class="record-muted">A share link lets anyone you send it to view this report (not your writing).</p>`;
            return;
        }
        if (!existing) {
            box.innerHTML = `<button id="recShareBtn">⤴ CREATE SHARE LINK</button>
                <p class="record-muted">Anyone with the link can view this report — the figures only, never your writing.</p>`;
            document.getElementById('recShareBtn').onclick = async () => {
                const btn = document.getElementById('recShareBtn');
                btn.disabled = true; btn.textContent = 'CREATING…';
                try {
                    const id = await window.createEvidenceShare(snapRef());
                    localStorage.setItem(shareKey(), id);
                } catch (e) { alert('Could not create the link: ' + e.message); }
                renderShareBox(snapRef);
            };
            return;
        }
        const url = location.origin + location.pathname + '?share=' + existing;
        box.innerHTML = `<label class="record-muted" for="recShareUrl">SHARE LINK</label>
            <input id="recShareUrl" type="text" readonly value="${esc(url)}">
            <div class="record-share-btns">
                <button id="recCopy">COPY LINK</button>
                <button id="recUpdate">UPDATE TO LATEST</button>
                <button id="recStop" class="record-stop">STOP SHARING</button>
            </div>
            <p class="record-muted">The link shows the report as it was when shared. Use UPDATE TO LATEST to refresh it.</p>`;
        document.getElementById('recCopy').onclick = () => {
            const inp = document.getElementById('recShareUrl'); inp.select();
            (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).catch(() => document.execCommand('copy'));
            document.getElementById('recCopy').textContent = 'COPIED';
        };
        document.getElementById('recUpdate').onclick = async () => {
            try { await window.updateEvidenceShare(existing, snapRef()); document.getElementById('recUpdate').textContent = 'UPDATED'; }
            catch (e) { alert('Could not update the link: ' + e.message); }
        };
        document.getElementById('recStop').onclick = async () => {
            if (!confirm('Stop sharing? The link will stop working.')) return;
            try { await window.deleteEvidenceShare(existing); } catch (e) { alert('Could not remove the link: ' + e.message); return; }
            localStorage.removeItem(shareKey());
            renderShareBox(snapRef);
        };
    }

    // ── Start ────────────────────────────────────────────────────────────────
    async function showShared() {
        document.getElementById('recordBack').style.display = 'none';
        document.getElementById('recordMadeWith').style.display = '';
        const root = document.getElementById('recordRoot');
        if (!/^[a-f0-9]{24}$/.test(shareId)) { root.innerHTML = '<p class="record-muted">This link isn\'t valid.</p>'; return; }
        if (!window.getEvidenceShare) { root.innerHTML = '<p class="record-muted">Couldn\'t connect. Check your connection and reload.</p>'; return; }
        try {
            const snap = await window.getEvidenceShare(shareId);
            if (!snap) { root.innerHTML = '<p class="record-muted">This report is no longer shared.</p>'; return; }
            render(snap, { shared: true });
            document.title = 'WRITING RECORD — ' + (snap.title || '');
            const actions = document.getElementById('recordActions');
            actions.style.display = '';
            document.getElementById('recordShareBox').innerHTML = '';
        } catch (e) {
            root.innerHTML = '<p class="record-muted">Couldn\'t load this report. Check your connection and reload.</p>';
        }
    }

    function showOwn() {
        const dp = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
        if (!dp.activeProjectId || !dp.projects || !dp.projects[dp.activeProjectId]) {
            location.replace('index.html'); return;
        }
        let author = '';
        const snapRef = () => buildSnapshot(author);
        const draw = () => { render(snapRef(), { shared: false }); renderShareBox(snapRef); };
        draw();
        document.getElementById('recordActions').style.display = '';

        document.addEventListener('dpAuthChanged', async e => {
            const user = e.detail && e.detail.user;
            if (user) {
                author = user.displayName || '';
                try { const u = window.getCurrentUsername && await window.getCurrentUsername(); if (u) author = u; } catch (err) {}
                // Bring in this project's figures from the writer's other devices
                try {
                    const docs = window.pullEvidenceFromCloud && await window.pullEvidenceFromCloud(dp.activeProjectId);
                    if (docs && window.DPEvidence) window.DPEvidence.mergeFromCloud(docs);
                } catch (err) { console.warn('Writing Record pull failed:', err); }
            }
            draw();
        });
    }

    document.addEventListener('DOMContentLoaded', () => { shareId ? showShared() : showOwn(); });
    window._recordTest = { buildSnapshot, render };
})();
