// ── Check a Writing Record (verify.html) ─────────────────────────────────────
// For competition organisers, editors and anyone a writer sends a Writing
// Record link to. No account needed.
//   1. Loads a shared record (read-only, by its link or code).
//   2. Checks a story, pasted or opened from a file, against the record's
//      fingerprint (record-core.js), entirely in this browser. The story is
//      never sent anywhere or stored: there is no network call that carries it,
//      and this page has no error monitoring.
// Everything shown is built with escaping: records come from other people.
(function () {
    'use strict';

    function esc(v) {
        return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    const num = v => { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; };
    const fmt = n => Math.round(num(n)).toLocaleString('en-GB');
    const pct = (a, b) => b > 0 ? Math.round((a / b) * 100) : 0;
    const fmtDate = t => t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    const fmtDateTime = t => t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    const fmtDay = k => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
    function fmtMins(m) { m = Math.round(num(m)); const h = Math.floor(m / 60), r = m % 60; return h ? `${h}h ${r}m` : `${r}m`; }

    // A record link, or just its code (24 letters and numbers)
    function parseShareInput(s) {
        const t = String(s || '').trim();
        const m = t.match(/[?&]share=([a-f0-9]{24})\b/i) || t.match(/^([a-f0-9]{24})$/i);
        return m ? m[1].toLowerCase() : null;
    }

    // What a check result means, in plain words
    function verdict(r, fp) {
        if (!r || !r.checked) return { level: 'none', title: 'NOT ENOUGH TEXT TO CHECK', text: 'Paste at least a few sentences of the story.' };
        const p = Math.round(r.share * 100);
        const sizeNote = fp && fp.words && r.words < fp.words * 0.8
            ? ` The record covers ${fmt(fp.words)} words; this story is ${fmt(r.words)}, so the record also includes other writing.` : '';
        if (r.exact) return { level: 'match', title: '✓ MATCHES THE RECORD EXACTLY', text: 'This story is the text in the record, word for word.' };
        if (r.share >= 0.95) return { level: 'match', title: '✓ MATCHES THE RECORD', text: `${p}% of the story matches the record. Small differences, such as a title or a few edits, account for the rest.` + sizeNote };
        if (r.share >= 0.6) return { level: 'partial', title: 'MOSTLY MATCHES', text: `${p}% of the story matches the record. The rest was changed after the record was issued, or isn’t in it. If the writer edited the story afterwards, they can update the link.` + sizeNote };
        if (r.share >= 0.15) return { level: 'partial', title: 'PARTLY MATCHES', text: `Only ${p}% of the story matches the record. Much of this story isn’t in it.` };
        return { level: 'nomatch', title: '✗ DOESN’T MATCH THIS RECORD', text: p ? `Only ${p}% of the story matches. This doesn’t look like the text in the record.` : 'None of this story was found in the record.' };
    }

    // ── Word files (.docx): read the text without any library ───────────────
    // A .docx is a zip. Find word/document.xml through the zip's central
    // directory, unzip it with the browser's own decompressor, keep the text.
    async function docxToText(buf) {
        const b = new Uint8Array(buf), v = new DataView(buf instanceof ArrayBuffer ? buf : b.buffer, b.byteOffset, b.byteLength);
        let eocd = -1;
        for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        if (eocd < 0) throw new Error('not-docx');
        const count = v.getUint16(eocd + 10, true);
        let p = v.getUint32(eocd + 16, true), entry = null;
        for (let i = 0; i < count && p + 46 <= b.length; i++) {
            if (v.getUint32(p, true) !== 0x02014b50) break;
            const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
            const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
            const local = v.getUint32(p + 42, true);
            const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl));
            if (name === 'word/document.xml') { entry = { method, size, local }; break; }
            p += 46 + nl + xl + cl;
        }
        if (!entry || v.getUint32(entry.local, true) !== 0x04034b50) throw new Error('not-docx');
        const start = entry.local + 30 + v.getUint16(entry.local + 26, true) + v.getUint16(entry.local + 28, true);
        const data = b.subarray(start, start + entry.size);
        let xmlBytes;
        if (entry.method === 0) xmlBytes = data;
        else if (entry.method === 8) xmlBytes = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
        else throw new Error('not-docx');
        const xml = new TextDecoder().decode(xmlBytes);
        return xml.replace(/<w:tab\/>/g, ' ').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n')
            .replace(/<w:delText[^>]*>[\s\S]*?<\/w:delText>/g, '')   // tracked deletions aren't part of the text
            .replace(/<[^>]+>/g, '')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    }

    const api = { parseShareInput, verdict, docxToText };
    if (typeof module === 'object' && module.exports) { module.exports = api; return; }
    window.DPVerify = api;

    // ── Page ────────────────────────────────────────────────────────────────
    let record = null;
    const $ = id => document.getElementById(id);

    function renderRecord(id, snap) {
        const T = snap.totals || {};
        const notTyped = num(T.pasted) + num(T.dropped);
        const added = num(T.typed) + notTyped + num(T.imported);
        const days = Object.keys(snap.days || {}).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
        const mins = Object.values(snap.days || {}).reduce((s, d) => s + num(d && d.min), 0);
        const pastes = (Array.isArray(snap.pastes) ? snap.pastes.length : 0) + num(T.earlierPastes);
        const issued = snap.issuedBy === 'draft-punk';
        let html = `<div class="verify-card">
            <div class="verify-card-title">${esc(snap.title || 'Untitled')}</div>
            <div class="record-meta">${snap.author ? esc(snap.author) + ' · ' : ''}${issued ? 'Issued' : 'Shared'} ${esc(fmtDateTime(snap.issuedAt || snap.generatedAt))}</div>
            ${issued
                ? `<div class="record-issued"><b>✓ ISSUED BY DRAFT PUNK</b><span>Draft Punk built this report from the record saved in the writer’s account. The writer couldn’t edit it.</span></div>`
                : `<div class="record-issued older"><b>EARLIER SHARE LINK</b><span>This link was made before Draft Punk began issuing reports itself (November 2026). Its figures were sent by the writer’s own device, and it can’t be checked against a story. Ask the writer to update the link.</span></div>`}
            <div class="record-facts">
                <div><b>${added ? pct(num(T.typed), added) + '%' : '—'}</b><span>of text added was typed in Draft Punk</span></div>
                <div><b>${fmt(pastes)}</b><span>paste${pastes === 1 ? '' : 's'} or imports</span></div>
                <div><b>${fmtMins(mins)}</b><span>active writing over ${days.length} day${days.length === 1 ? '' : 's'}${days.length ? ' (' + esc(fmtDay(days[0])) + (days.length > 1 ? ' – ' + esc(fmtDay(days[days.length - 1])) : '') + ')' : ''}</span></div>
                <div><b>${fmt(T.words)}</b><span>words, of which ${fmt(T.untrackedWords)} were written before the record began</span></div>
            </div>
            <a class="verify-full" href="record.html?share=${esc(id)}" target="_blank" rel="noopener">SEE THE FULL RECORD ↗</a>
        </div>`;
        $('vfRecord').innerHTML = html;
        const canCheck = !!(snap.fingerprint && snap.fingerprint.hashes);
        $('vfStorySection').style.display = canCheck ? '' : 'none';
        $('vfResult').innerHTML = '';
    }

    function say(where, text) { $(where).innerHTML = `<p class="record-muted">${esc(text)}</p>`; }

    async function load(id) {
        record = null;
        $('vfStorySection').style.display = 'none';
        if (!id) { say('vfRecord', 'That doesn’t look like a Writing Record link. It should contain “share=” followed by 24 letters and numbers.'); return; }
        say('vfRecord', 'LOADING…');
        // sync.js (a module) provides getEvidenceShare; wait briefly for it
        for (let i = 0; i < 50 && !window.getEvidenceShare; i++) await new Promise(r => setTimeout(r, 100));
        if (!window.getEvidenceShare) { say('vfRecord', 'Couldn’t connect. Check your connection and reload.'); return; }
        try {
            const snap = await window.getEvidenceShare(id);
            if (!snap) { say('vfRecord', 'There’s no record at that link. The writer may have stopped sharing it.'); return; }
            record = { id, snap };
            renderRecord(id, snap);
            try { history.replaceState(null, '', 'verify.html?share=' + id); } catch (e) {}
        } catch (e) {
            say('vfRecord', 'Couldn’t load the record. Check your connection and try again.');
        }
    }

    function check() {
        if (!record || !window.DPRecordCore) return;
        const text = $('vfStory').value;
        const r = window.DPRecordCore.compare(record.snap.fingerprint, text);
        const v = verdict(r, record.snap.fingerprint);
        $('vfResult').innerHTML = `<div class="verify-result ${v.level}">
            <b>${esc(v.title)}</b><span>${esc(v.text)}</span>
            ${r && r.checked ? `<span class="record-muted">Story: ${fmt(r.words)} words. Checked against the record as issued on ${esc(fmtDate(record.snap.issuedAt))}.</span>` : ''}
        </div>`;
    }

    document.addEventListener('DOMContentLoaded', () => {
        $('vfLinkForm').addEventListener('submit', e => { e.preventDefault(); load(parseShareInput($('vfLink').value)); });
        $('vfCheck').addEventListener('click', check);
        $('vfStory').addEventListener('input', () => { $('vfResult').innerHTML = ''; });
        $('vfFile').addEventListener('change', async () => {
            const f = $('vfFile').files[0];
            if (!f) return;
            $('vfFileName').textContent = f.name;
            try {
                const isDocx = /\.docx$/i.test(f.name);
                if (!isDocx && /\.(doc|pdf|pages|odt|rtf)$/i.test(f.name)) throw new Error('type');
                $('vfStory').value = isDocx ? await docxToText(await f.arrayBuffer()) : await f.text();
                check();
            } catch (e) {
                $('vfFileName').textContent = '';
                say('vfResult', 'That file couldn’t be read here. Open it, copy the story, and paste it into the box instead. (Word .docx and plain text files can be opened directly.)');
            }
            $('vfFile').value = '';
        });
        const id = parseShareInput(location.search);
        if (id) { $('vfLink').value = location.origin + location.pathname.replace(/verify\.html$/, 'record.html') + '?share=' + id; load(id); }
    });
})();
