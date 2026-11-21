// ── New week / month / year notice ───────────────────────────────────────────
// Shows a one-off on-screen message the first time a writer opens Draft Punk
// in a new week (Monday, local midnight), month or year, so a counter that has
// gone back to 0 doesn't look like lost words.
//
// Read-only with respect to writing data: it only READS draftPunkData. The one
// thing it stores is its own 'dpPeriodSeen' key (which periods it has already
// announced on this device). It never changes a project or a counter.
//
// Loaded straight after sidebar.js, before tracker.js/script.js, so it can read
// last period's figures before the page's own reset clears them.
(function () {
    function pad(n) { return String(n).padStart(2, '0'); }
    // Same week numbering as tracker.js / script.js
    function weekKeyFor(date) {
        const d = new Date(date.getTime());
        const day = d.getDay() || 7;
        d.setDate(d.getDate() + 4 - day);
        const yr = new Date(d.getFullYear(), 0, 1);
        return d.getFullYear() + '-W' + Math.ceil(((d - yr) / 86400000 + 1) / 7);
    }
    function monthKeyFor(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
    function yearKeyFor(d)  { return '' + d.getFullYear(); }

    let dp, seen;
    try { dp = JSON.parse(localStorage.getItem('draftPunkData') || '{}'); } catch (e) { return; }
    try { seen = JSON.parse(localStorage.getItem('dpPeriodSeen') || 'null'); } catch (e) { seen = null; }

    const projects = Object.values((dp && dp.projects) || {});
    if (!projects.length) return;                       // new writer: nothing to announce

    const now  = new Date();
    const cur  = { week: weekKeyFor(now), month: monthKeyFor(now), year: yearKeyFor(now) };
    const weekAgo  = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prev = { week: weekKeyFor(weekAgo), month: monthKeyFor(monthAgo), year: '' + (now.getFullYear() - 1) };

    const FIELDS = {
        week:  { count: 'wordsThisWeek',  key: 'lastWeekReset'  },
        month: { count: 'wordsThisMonth', key: 'lastMonthReset' },
        year:  { count: 'wordsThisYear',  key: 'lastYearReset'  },
    };

    // A period is "new" if this device last saw a different one. For a device
    // with no record yet, it's new if the active project's counter still
    // belongs to an earlier period (its reset is still to come). Only the
    // active project is checked: inactive projects aren't reset until opened,
    // so they would make every first visit look like a new week.
    const active = dp.activeProjectId && dp.projects[dp.activeProjectId];
    function isNew(p) {
        if (seen && seen[p]) return seen[p] !== cur[p];
        const k = active && active[FIELDS[p].key];
        return !!k && k !== cur[p];
    }
    // Last period's words, if they are still on this device (they won't be if
    // the counter was already reset during an earlier visit this period).
    function lastTotal(p) {
        const f = FIELDS[p];
        const old = projects.filter(pr => pr[f.key] === prev[p]);
        if (!old.length) return null;
        return old.reduce((s, pr) => s + (pr[f.count] || 0), 0);
    }

    const LABEL = { week: 'WEEK', month: 'MONTH', year: 'YEAR' };
    const LAST  = { week: 'Last week', month: 'Last month', year: 'Last year' };
    const items = ['year', 'month', 'week'].filter(isNew).map(p => ({ p, last: lastTotal(p) }));

    // Record what we've now seen (whether or not anything is shown), so the
    // message appears once per period on this device.
    try { localStorage.setItem('dpPeriodSeen', JSON.stringify(cur)); } catch (e) {}
    if (!items.length) return;

    function show() {
        const title = 'NEW ' + items.map(i => LABEL[i.p]).join(' + ');
        const lines = items.map(i => {
            const reset = 'Your ' + LABEL[i.p].toLowerCase() + 'ly word count starts again at 0.';
            const was   = (i.last != null && i.last > 0) ? ' ' + LAST[i.p] + ': ' + i.last.toLocaleString() + ' words.' : '';
            return '<p style="font-size:0.8rem;letter-spacing:1px;line-height:1.6;margin:0 0 10px;">' + reset + was + '</p>';
        }).join('');
        const ov = document.createElement('div');
        ov.className = 'overlay';
        ov.id = 'periodNoticeOverlay';
        ov.style.display = 'flex';
        ov.innerHTML =
            '<div class="congrats-box" style="max-width:360px;width:90%;text-align:center;">' +
                '<h2 style="color:var(--neon);margin:0 0 16px;letter-spacing:3px;">' + title + '</h2>' +
                lines +
                (items.some(i => i.p === 'week')
                    ? '<p style="font-size:0.875rem;color:var(--text-dim);letter-spacing:1px;margin:6px 0 0;">Everyone\u2019s weekly count resets at midnight on Monday, so group totals start level.</p>'
                    : '') +
                '<div style="height:18px;"></div>' +
                '<button type="button" style="width:100%;">LET\u2019S WRITE</button>' +
            '</div>';
        function close() { ov.remove(); }
        ov.querySelector('button').addEventListener('click', close);
        ov.addEventListener('click', e => { if (e.target === ov) close(); });
        document.body.appendChild(ov);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
    else show();
})();
