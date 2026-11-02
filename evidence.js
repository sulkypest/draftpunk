// ── Writing evidence report ──────────────────────────────────────────────────
// Reads the edit log (cloud batches + any not yet uploaded from this device),
// verifies it, and summarises how the text was entered and how it changed.
(function () {
    const P = window.DPProv;
    let current = null; // { batches, titles, projectTitle, source, verifications, stats }

    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const fmtDate = ms => ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
    const fmtDay  = ms => ms ? new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';
    const fmtNum  = n => (n || 0).toLocaleString();
    const pct     = x => x == null ? '—' : (x * 100).toFixed(1) + '%';
    const fmtDur  = ms => {
        const m = Math.round(ms / 60000);
        return m < 60 ? m + ' MIN' : Math.floor(m / 60) + ' HR ' + (m % 60) + ' MIN';
    };

    function projectInfo() {
        const dp  = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
        const wd  = JSON.parse(localStorage.getItem('writingData') || '{}');
        const id  = dp.activeProjectId || null;
        const titles = {};
        if (wd.projectId === id && Array.isArray(wd.chapters)) wd.chapters.forEach(c => { titles[c.id] = c.title; });
        return { id, title: (dp.projects && dp.projects[id] && dp.projects[id].title) || 'PROJECT', titles };
    }

    function normalise(b) {
        const out = { ...b };
        const st = P.serverMs(b);
        if (st) out.serverTime = st;
        delete out._id; delete out.qid;
        return out;
    }

    async function load() {
        const info = projectInfo();
        document.getElementById('evProject').textContent = info.title;
        if (window.dpProv) await window.dpProv.flush();

        const local = ((window.dpProv && await window.dpProv.localBatches()) || [])
            .filter(b => !info.id || b.projectId === info.id).map(normalise);

        let cloud = null, source;
        const user = window.getCurrentUser && window.getCurrentUser();
        if (user && window.provList) {
            try { cloud = (await window.provList(info.id)).map(normalise); } catch (e) { cloud = null; }
        }
        if (cloud) source = local.length ? `CLOUD LOG + ${local.length} BATCH(ES) WAITING TO UPLOAD FROM THIS DEVICE` : 'CLOUD LOG';
        else if (user) source = 'COULD NOT REACH THE CLOUD LOG — SHOWING THIS DEVICE ONLY';
        else source = 'NOT SIGNED IN — SHOWING THIS DEVICE ONLY. SIGN IN SO THE LOG IS SERVER-TIMESTAMPED.';

        await render((cloud || []).concat(local), info.titles, info.title, source);
    }

    async function render(batches, titles, projectTitle, source) {
        const byChapter = {};
        batches.forEach(b => (byChapter[b.chapterId] = byChapter[b.chapterId] || []).push(b));
        const verifications = {};
        for (const id of Object.keys(byChapter)) verifications[id] = await P.verifyChapter(byChapter[id]);
        const stats = P.analyse(batches);
        current = { batches, titles, projectTitle, source, verifications, stats };

        document.getElementById('evStatus').textContent = source;
        const body = document.getElementById('evBody');
        if (!batches.length) {
            body.innerHTML = `<p class="ev-note">NOTHING LOGGED YET FOR THIS PROJECT. THE LOG RECORDS EVERY EDIT MADE ON THE WRITE PAGE FROM NOW ON — IT CANNOT RECONSTRUCT WRITING DONE BEFORE IT WAS ADDED.</p>`;
            return;
        }
        const title = id => titles[id] || 'DELETED / UNKNOWN CHAPTER';
        const chapterIds = Object.keys(byChapter).sort((a, b) =>
            Math.min(...byChapter[a].map(x => x.start)) - Math.min(...byChapter[b].map(x => x.start)));

        body.innerHTML =
            sectionIntegrity(chapterIds, byChapter, verifications, title) +
            sectionActivity(stats) +
            sectionDaily(stats) +
            sectionExternal(stats, title) +
            sectionTimeline(chapterIds, byChapter, title) +
            sectionLimits();
    }

    // ── Sections ──────────────────────────────────────────────────────────────
    function sectionIntegrity(ids, byChapter, ver, title) {
        const rows = ids.map(id => {
            const v = ver[id];
            const snaps = byChapter[id].filter(b => b.snap != null).length;
            let chain;
            if (!v.cloudCount) chain = '<span class="ev-warn">NOT UPLOADED</span>';
            else if (v.ok) chain = '<span class="ev-ok">✓ INTACT</span>';
            else {
                const bits = [];
                if (v.hashFailures.length) bits.push(v.hashFailures.length + ' ALTERED');
                if (v.linkFailures.length) bits.push(v.linkFailures.length + ' BROKEN LINK');
                if (v.gaps.length) bits.push(v.gaps.map(g => g[0] === g[1] ? '#' + g[0] : '#' + g[0] + '–' + g[1]).join(', ') + ' MISSING');
                if (v.snapFailures.length) bits.push(v.snapFailures.length + ' SNAPSHOT MISMATCH');
                chain = '<span class="ev-bad">✗ ' + bits.join(' · ') + '</span>';
            }
            return `<tr><td>${esc(title(id))}</td><td>${v.cloudCount}${v.localCount ? ' +' + v.localCount : ''}</td>
                <td>${chain}</td><td>${snaps}</td><td>${v.unexplained.length}</td><td>${v.lateUploads}</td></tr>`;
        }).join('');
        return `<div class="ev-section"><h3>INTEGRITY <span class="ev-tag">VERIFIED BY CALCULATION</span></h3>
            <div class="ev-scroll"><table class="ev-table"><thead><tr><th>CHAPTER</th><th>BATCHES</th><th>CHAIN</th>
            <th>SNAPSHOTS</th><th>UNEXPLAINED</th><th>LATE UPLOAD</th></tr></thead><tbody>${rows}</tbody></table></div>
            <p class="ev-note">CHAIN: EVERY UPLOADED BATCH IS RE-HASHED AND CHECKED AGAINST THE ONE BEFORE IT; ANY EDIT, DELETION OR REORDERING AFTER UPLOAD SHOWS HERE.
            UNEXPLAINED: BATCHES WHERE THE TEXT LENGTH CHANGED BY MORE OR LESS THAN THE LOGGED EDITS ACCOUNT FOR (EG A BROWSER EXTENSION EDITING THE PAGE).
            LATE UPLOAD: BATCHES THAT REACHED THE SERVER MORE THAN 10 MINUTES AFTER THEY WERE WRITTEN (USUALLY OFFLINE WRITING).</p></div>`;
    }

    function sectionActivity(s) {
        const a = s.added;
        const row = (label, val) => `<div class="ev-stat"><span>${label}</span><b>${val}</b></div>`;
        return `<div class="ev-section"><h3>HOW THE TEXT WAS ENTERED <span class="ev-tag">MEASURED</span></h3>
            <div class="ev-stats">
            ${row('LOG COVERS', fmtDay(s.first) + ' → ' + fmtDay(s.last))}
            ${row('WRITING SESSIONS', fmtNum(s.sessions))}
            ${row('ACTIVE WRITING TIME', fmtDur(s.activeMs))}
            ${row('EDIT EVENTS', fmtNum(s.events))}
            ${row('CHARACTERS TYPED', fmtNum((a.t || 0) + (a.n || 0)))}
            ${row('KEYBOARD COMPOSITION / AUTOCORRECT', fmtNum((a.c || 0) + (a.r || 0)))}
            ${row('CHARACTERS PASTED', fmtNum(a.p))}
            ${row('BURST INSERTS (DICTATION, EXPANDERS)', fmtNum(a.b))}
            ${row('DROPPED / IMPORTED / OTHER', fmtNum((a.x || 0) + (a.i || 0) + (a.o || 0)))}
            ${row('SHARE ENTERED AT THE KEYBOARD', pct(s.typedShare))}
            ${row('CHARACTERS DELETED', fmtNum(s.removed))}
            ${row('DELETED ÷ ADDED', s.revisionRatio == null ? '—' : s.revisionRatio.toFixed(2))}
            ${row('TYPING INTERVAL (MEDIAN, IQR)', s.intervalMedian == null ? '—' : `${s.intervalMedian} MS (${s.intervalP25}–${s.intervalP75})`)}
            ${row('MID-TYPING PAUSES 2S–2MIN', fmtNum(s.pauses))}
            </div></div>`;
    }

    function sectionDaily(s) {
        const days = Object.keys(s.byDay).sort();
        if (!days.length) return '';
        const max = Math.max(...days.map(d => s.byDay[d].typed + s.byDay[d].external + s.byDay[d].other)) || 1;
        const bars = days.map(d => {
            const r = s.byDay[d];
            const w = v => (v / max * 100).toFixed(2) + '%';
            return `<div class="ev-day"><span class="ev-day-label">${d}</span>
                <div class="ev-day-bar"><i class="ev-typed" style="width:${w(r.typed)}"></i><i class="ev-ext" style="width:${w(r.external)}"></i><i class="ev-other" style="width:${w(r.other)}"></i></div>
                <span class="ev-day-n">${fmtNum(r.typed + r.external + r.other)}</span></div>`;
        }).join('');
        return `<div class="ev-section"><h3>CHARACTERS ADDED PER DAY</h3>
            <div class="ev-legend"><span><i class="ev-typed"></i>KEYBOARD</span><span><i class="ev-ext"></i>PASTE / BURST / IMPORT</span><span><i class="ev-other"></i>UNDO / OTHER</span></div>
            ${bars}</div>`;
    }

    function sectionExternal(s, title) {
        const list = s.external.slice().sort((a, b) => b.chars - a.chars);
        if (!list.length) return `<div class="ev-section"><h3>PASTES AND OTHER NON-TYPED INSERTS</h3><p class="ev-note">NONE LOGGED.</p></div>`;
        const shown = list.slice(0, 100);
        const rows = shown.map(e => `<tr><td>${fmtDate(e.time)}</td><td>${esc(P.KIND_LABELS[e.kind])}</td>
            <td>${fmtNum(e.chars)}</td><td>${esc(title(e.chapterId))}</td></tr>`).join('');
        return `<div class="ev-section"><h3>PASTES AND OTHER NON-TYPED INSERTS (${fmtNum(list.length)})</h3>
            <div class="ev-scroll"><table class="ev-table"><thead><tr><th>WHEN</th><th>TYPE</th><th>CHARS</th><th>CHAPTER</th></tr></thead>
            <tbody>${rows}</tbody></table></div>
            ${list.length > shown.length ? `<p class="ev-note">LARGEST ${shown.length} SHOWN; ALL ARE IN THE EXPORT.</p>` : ''}
            <p class="ev-note">PASTED TEXT ITSELF IS NOT STORED — ONLY ITS SIZE AND TIME. THE SNAPSHOTS BELOW SHOW WHAT IT BECAME.</p></div>`;
    }

    function sectionTimeline(ids, byChapter, title) {
        const parts = ids.map(id => {
            const snaps = byChapter[id].filter(b => b.snap != null).sort((a, b) => a.end - b.end);
            if (!snaps.length) return '';
            const rows = snaps.map((b, i) => `<div class="ev-snap">
                <button class="ev-snap-btn" onclick="showDiff('${esc(id)}', ${i})">${fmtDate(b.end)} · ${fmtNum(P.countWords(b.snap))} WDS</button>
                <div class="ev-diff" id="evdiff_${esc(id)}_${i}"></div></div>`).join('');
            return `<details class="ev-chapter"><summary>${esc(title(id))} — ${snaps.length} SNAPSHOT${snaps.length === 1 ? '' : 'S'}</summary>${rows}</details>`;
        }).join('');
        return `<div class="ev-section"><h3>CHANGES OVER TIME</h3>
            <p class="ev-note">A FULL-TEXT SNAPSHOT IS TAKEN ROUGHLY EVERY 10 MINUTES OF WRITING AND WHEN YOU LEAVE THE PAGE. TAP ONE TO SEE WHAT CHANGED SINCE THE ONE BEFORE.</p>
            ${parts || '<p class="ev-note">NO SNAPSHOTS YET.</p>'}</div>`;
    }

    function sectionLimits() {
        return `<div class="ev-section"><h3>WHAT THIS DOES AND DOESN'T SHOW</h3><p class="ev-note">
            VERIFIED: THE UPLOADED LOG HAS NOT BEEN ALTERED, REORDERED OR TRIMMED MID-CHAIN SINCE UPLOAD, AND EACH BATCH CARRIES A TIMESTAMP SET BY THE SERVER, NOT THE DEVICE.
            THE SNAPSHOTS MATCH THE TEXT FINGERPRINTS RECORDED AT THE TIME.<br><br>
            MEASURED: HOW EACH CHARACTER ARRIVED (KEYBOARD, PASTE, DICTATION-STYLE BURST, IMPORT), WHEN, AND HOW MUCH WAS REVISED.<br><br>
            NOT PROVABLE: THAT A PERSON COMPOSED THE WORDS. SOMEONE COULD RETYPE TEXT BY HAND, OR SCRIPT FAKE KEYSTROKES IN REAL TIME.
            NOTHING BEFORE THE LOG WAS ADDED IS COVERED. A THIRD PARTY CAN CHECK AN EXPORT'S INTERNAL CONSISTENCY WITH "VERIFY AN EXPORTED FILE",
            BUT CONFIRMING THE SERVER TIMES THEMSELVES NEEDS ACCESS TO THE DRAFT PUNK DATABASE.</p></div>`;
    }

    // ── Diff view ─────────────────────────────────────────────────────────────
    window.showDiff = function (chapterId, i) {
        const el = document.getElementById(`evdiff_${chapterId}_${i}`);
        if (!el) return;
        if (el.innerHTML) { el.innerHTML = ''; return; }
        const snaps = current.batches.filter(b => b.chapterId === chapterId && b.snap != null).sort((a, b) => a.end - b.end);
        const prev = i > 0 ? snaps[i - 1].snap : '';
        const diff = P.diffParagraphs(prev, snaps[i].snap);
        if (!diff) { el.innerHTML = '<p class="ev-note">TOO LARGE TO COMPARE HERE.</p>'; return; }
        const changed = diff.filter(d => d[0] !== '=');
        if (!changed.length) { el.innerHTML = '<p class="ev-note">NO PARAGRAPH-LEVEL CHANGES.</p>'; return; }
        el.innerHTML = (i === 0 ? '<p class="ev-note">FIRST SNAPSHOT — FULL TEXT AT THAT POINT:</p>' : '') +
            changed.map(d => `<p class="${d[0] === '+' ? 'ev-add' : 'ev-del'}">${d[0]} ${esc(d[1])}</p>`).join('');
    };

    // ── Export and verify ─────────────────────────────────────────────────────
    window.exportEvidence = function () {
        if (!current) return;
        const data = {
            format: 'draftpunk-evidence', version: 1, exported: new Date().toISOString(),
            project: current.projectTitle, source: current.source,
            chapters: current.titles, stats: current.stats, verification: current.verifications,
            hashing: 'SHA-256 of JSON.stringify([v, chapterId, projectId, seq, prevHash, deviceId, sessionId, start, end, startLen, len, textHash, snap, ev, recovered?1:0])',
            batches: current.batches
        };
        const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'draftpunk-evidence-' + current.projectTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
    };

    window.verifyFile = function (e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async ev => {
            try {
                const data = JSON.parse(ev.target.result);
                if (data.format !== 'draftpunk-evidence' || !Array.isArray(data.batches)) throw new Error('bad');
                document.getElementById('evProject').textContent = (data.project || 'PROJECT') + ' — FROM FILE';
                await render(data.batches, data.chapters || {}, data.project || 'PROJECT',
                    `VERIFYING ${file.name.toUpperCase()} (EXPORTED ${fmtDate(Date.parse(data.exported))}). EVERYTHING BELOW IS RECALCULATED FROM THE FILE, NOT TAKEN FROM IT.`);
            } catch (err) {
                alert('That file is not a Draft Punk evidence export.');
            }
            e.target.value = '';
        };
        reader.readAsText(file);
    };

    // ── Boot: wait for auth to resolve once, then load ───────────────────────
    let loaded = false;
    const go = () => { if (!loaded) { loaded = true; load(); } };
    document.addEventListener('dpAuthChanged', e => {
        // Reload when a user signs in after the page has shown local-only data
        if (loaded && e.detail && e.detail.user) { load(); return; }
        go();
    });
    // If sync.js can't load (offline), fall back to local data
    setTimeout(go, 4000);
})();
