// Admin area. Everything here is also enforced by the database rules: a
// non-admin who opens this page sees nothing and can do nothing.
(function () {
    const REASONS = {
        'child-safety': 'May be a risk to children', sexual: 'Sexual content or unwanted advances',
        harassment: 'Bullying or harassment', hate: 'Hate or abuse', underage: 'May be under 16',
        spam: 'Spam or scams', other: 'Something else'
    };
    const TYPES = { message: 'Message', groupMessage: 'Group message', friendRequest: 'Friend request', share: 'Shared chapter', writer: 'Writer' };
    const URGENT = ['child-safety', 'sexual'];
    let reports = [], suspended = [], view = 'open';
    const names = {};
    const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const when = t => t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    const $ = id => document.getElementById(id);

    async function waitForUser() {
        for (let i = 0; i < 100; i++) {
            const u = window.getCurrentUser && window.getCurrentUser();
            if (u !== undefined && window.dpAdmin) return u;
            await new Promise(r => setTimeout(r, 100));
        }
        return null;
    }

    async function start() {
        const user = await waitForUser();
        if (!user) { $('admStatus').textContent = 'Sign in first, then come back to this page.'; return; }
        if (!(await window.dpAdmin.check())) { $('admStatus').textContent = 'This page is for the Draft Punk admin only.'; return; }
        $('admStatus').style.display = 'none';
        $('admContent').style.display = '';
        await loadAll();
        wireNotices();
        await loadNotices();
    }

    async function loadAll() {
        try {
            [reports, suspended] = await Promise.all([window.dpAdmin.reports(), window.dpAdmin.suspended()]);
        } catch (e) {
            $('admReports').innerHTML = `<p class="adm-err">Couldn't load: ${esc(e.message)}</p>`;
            return;
        }
        const uids = new Set();
        reports.forEach(r => { uids.add(r.from); });
        await Promise.all([...uids].filter(u => u && !(u in names)).map(async u => { names[u] = await window.dpAdmin.username(u); }));
        renderReports();
        renderSuspended();
        const w = await window.dpAdmin.weekly();
        $('admWeekly').textContent = w ? `${w.body} (${when(w.at)})` : 'Nothing yet. This fills in every Monday morning.';
    }

    // ── Notices ──────────────────────────────────────────────────────
    let notices = [];
    const toLocalInput = t => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
    async function loadNotices() {
        try { notices = await window.dpAdmin.notices(); } catch (e) { $('admNotices').innerHTML = `<p class="adm-err">Couldn't load notices: ${esc(e.message)}</p>`; return; }
        const now = Date.now();
        const state = n => n.startAt > now ? 'SCHEDULED' : (n.endAt && n.endAt <= now ? 'ENDED' : 'SHOWING');
        $('admNotices').innerHTML = notices.length ? notices.map(n => `<div class="adm-row">
            <span><span class="adm-tag">${state(n)}</span> <strong>${esc(n.title)}</strong>
            <span class="adm-dim"> · ${esc(n.type)} · from ${when(n.startAt)}${n.endAt ? ' to ' + when(n.endAt) : ''}</span></span>
            <button type="button" class="btn-secondary" data-delnotice="${esc(n.id)}">DELETE</button></div>`).join('')
            : '<p class="adm-dim">No notices yet.</p>';
    }
    function formNotice() {
        const f = $('admNoticeForm');
        return {
            type: f.type.value, title: f.title.value.trim(), body: f.body.value.trim(),
            buttonText: f.buttonText.value.trim(), buttonUrl: f.buttonUrl.value.trim(),
            startAt: f.startAt.value ? new Date(f.startAt.value).getTime() : Date.now(),
            endAt: f.endAt.value ? new Date(f.endAt.value).getTime() : 0
        };
    }
    function wireNotices() {
        const f = $('admNoticeForm');
        f.startAt.value = toLocalInput(Date.now());
        f.onsubmit = async e => {
            e.preventDefault();
            const n = formNotice(), err = $('admNoticeErr');
            err.textContent = '';
            if (n.buttonText && !n.buttonUrl) { err.textContent = 'Add a link for the button, or remove the button text.'; return; }
            if (n.endAt && n.endAt <= n.startAt) { err.textContent = 'The end has to be after the start.'; return; }
            try { await window.dpAdmin.saveNotice(n); f.reset(); f.startAt.value = toLocalInput(Date.now()); await loadNotices(); }
            catch (ex) { err.textContent = 'Couldn\'t save: ' + ex.message; }
        };
        $('admNoticePreview').onclick = () => {
            const n = formNotice();
            if (!n.title) { $('admNoticeErr').textContent = 'Add a title to preview.'; return; }
            window.dpShowNotice(n, () => {});
        };
        document.addEventListener('click', async e => {
            const b = e.target.closest('[data-delnotice]');
            if (!b) return;
            if (!confirm('Delete this notice? Writers who haven\'t seen it yet won\'t see it.')) return;
            try { await window.dpAdmin.deleteNotice(b.dataset.delnotice); await loadNotices(); } catch (ex) { alert('Could not delete: ' + ex.message); }
        });
    }

    function isOpen(r) { return r.status !== 'done'; }
    function isSuspended(uid) { return suspended.some(s => s.uid === uid); }

    window.admShow = function (v) {
        view = v;
        $('admTabOpen').setAttribute('aria-selected', String(v === 'open'));
        $('admTabDone').setAttribute('aria-selected', String(v === 'done'));
        renderReports();
    };

    function renderReports() {
        const open = reports.filter(isOpen);
        $('admOpenCount').textContent = open.length ? `(${open.length})` : '';
        let list = view === 'open' ? open : reports.filter(r => !isOpen(r));
        if (view === 'open') list = list.slice().sort((a, b) => (URGENT.includes(b.reason) - URGENT.includes(a.reason)) || (b.createdAt - a.createdAt));
        if (!list.length) { $('admReports').innerHTML = `<p class="adm-dim">${view === 'open' ? 'No open reports.' : 'None yet.'}</p>`; return; }
        $('admReports').innerHTML = list.map(r => {
            const urgent = URGENT.includes(r.reason);
            const target = r.targetUid ? `${esc(r.targetUsername || '?')}${isSuspended(r.targetUid) ? ' <span class="adm-tag">SUSPENDED</span>' : ''}` : '—';
            return `<article class="adm-card${urgent ? ' urgent' : ''}" data-id="${esc(r.id)}">
                <div class="adm-card-top">
                    ${urgent ? '<span class="adm-tag urgent">URGENT</span>' : ''}
                    <strong>${esc(REASONS[r.reason] || r.reason)}</strong>
                    <span class="adm-dim">${esc(TYPES[r.type] || r.type)} · ${when(r.createdAt)}</span>
                </div>
                <dl class="adm-dl">
                    <dt>Reported</dt><dd>${target}</dd>
                    <dt>By</dt><dd>${esc(names[r.from] || r.from)}</dd>
                    ${r.excerpt ? `<dt>As they saw it</dt><dd class="adm-quote">${esc(r.excerpt)}</dd>` : ''}
                    ${r.note ? `<dt>Their note</dt><dd>${esc(r.note)}</dd>` : ''}
                    ${r.path ? `<dt>Now</dt><dd><button type="button" class="adm-link" data-act="look">Show what's there now</button><span class="adm-now"></span></dd>` : ''}
                    ${!isOpen(r) ? `<dt>Dealt with</dt><dd>${when(r.handledAt)}${r.adminNote ? ' · ' + esc(r.adminNote) : ''}</dd>` : ''}
                </dl>
                <div class="adm-actions">
                    ${r.path ? '<button type="button" class="btn-secondary" data-act="delete">DELETE IT</button>' : ''}
                    ${r.targetUid && !isSuspended(r.targetUid) ? '<button type="button" class="btn-secondary" data-act="suspend">SUSPEND WRITER</button>' : ''}
                    ${isOpen(r)
                        ? '<input type="text" class="adm-note" maxlength="1000" placeholder="Note (optional)" aria-label="Note"><button type="button" data-act="done">MARK DEALT WITH</button>'
                        : '<button type="button" class="btn-secondary" data-act="reopen">REOPEN</button>'}
                </div>
                <p class="adm-err" aria-live="polite"></p>
            </article>`;
        }).join('');
    }

    function renderSuspended() {
        if (!suspended.length) { $('admSuspended').innerHTML = '<p class="adm-dim">None.</p>'; return; }
        $('admSuspended').innerHTML = suspended.map(s => `<div class="adm-row">
            <span><strong>${esc(s.username || s.uid)}</strong> <span class="adm-dim">since ${when(s.at)}${s.reason ? ' · ' + esc(s.reason) : ''}</span></span>
            <button type="button" class="btn-secondary" data-unsuspend="${esc(s.uid)}" data-name="${esc(s.username || '')}">LIFT</button>
        </div>`).join('');
    }

    document.addEventListener('click', async e => {
        const lift = e.target.closest('[data-unsuspend]');
        if (lift) {
            if (!confirm(`Lift the suspension for ${lift.dataset.name || 'this writer'}? They'll be able to write and use social features again.`)) return;
            lift.disabled = true;
            try { await window.dpAdmin.unsuspend(lift.dataset.unsuspend); await loadAll(); }
            catch (err) { alert('Could not lift it: ' + err.message); lift.disabled = false; }
            return;
        }
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const card = btn.closest('.adm-card');
        const r = reports.find(x => x.id === card.dataset.id);
        const err = card.querySelector('.adm-err');
        err.textContent = '';
        try {
            if (btn.dataset.act === 'look') {
                const item = await window.dpAdmin.item(r.path);
                card.querySelector('.adm-now').textContent = item
                    ? (r.path.startsWith('shares/') ? ` "${item.chapterTitle || ''}", ${item.wordCount || 0} words` : ` ${item.body || ''}`)
                    : ' Gone (deleted).';
            } else if (btn.dataset.act === 'delete') {
                if (!confirm(r.path.startsWith('shares/') ? 'Stop this chapter being shared? The writer keeps their chapter.' : 'Delete this message for everyone?')) return;
                await window.dpAdmin.deleteItem(r.path);
                card.querySelector('.adm-now') && (card.querySelector('.adm-now').textContent = ' Deleted.');
                btn.remove();
            } else if (btn.dataset.act === 'suspend') {
                const why = prompt(`Suspend ${r.targetUsername || 'this writer'}? They'll still be able to sign in and export their writing.\n\nReason (kept with the suspension):`, REASONS[r.reason] || '');
                if (why === null) return;
                await window.dpAdmin.suspend(r.targetUid, r.targetUsername, why, r.id);
                await loadAll();
            } else if (btn.dataset.act === 'done') {
                await window.dpAdmin.markReport(r.id, 'done', card.querySelector('.adm-note').value);
                await loadAll();
            } else if (btn.dataset.act === 'reopen') {
                await window.dpAdmin.markReport(r.id, 'open', r.adminNote || '');
                await loadAll();
            }
        } catch (ex) { err.textContent = 'That didn\'t work: ' + ex.message; }
    });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
