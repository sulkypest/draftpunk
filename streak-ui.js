// ── Streak display ───────────────────────────────────────────────────────────
// Shows the writer streak (streak.js) in three places:
//   • a STREAK box in the sidebar (desktop) and the slide-in panel (mobile)
//   • a small chip at the top of the Write page's footer
//   • once a day on opening, a short bar if today's writing is still to do
//     (and says so if a freeze has covered a missed day)
// Tapping any of them opens a small panel with the last 7 days and freezes.
//
// Read-only: never saves writing data. Its only stored keys ('dpStreakNudge',
// 'dpStreakFrozeSeen') are display bookkeeping that is not synced.
(function () {
    if (!window.DPStreak) return;
    const S = window.DPStreak;
    const DAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    function css() {
        if (document.getElementById('dpStreakCss')) return;
        const st = document.createElement('style');
        st.id = 'dpStreakCss';
        st.textContent = `
            .dp-streak-num { font-size:1.6rem;font-weight:900;line-height:1;margin:5px 0;color:var(--neon); }
            .dp-streak-sub { font-size:0.75rem;letter-spacing:1px;color:var(--text-dim);text-transform:uppercase;line-height:1.4; }
            .dp-streak-box { cursor:pointer; }
            .dp-streak-chip { display:flex;align-items:center;gap:10px;justify-content:space-between;cursor:pointer;
                margin:0 0 10px;padding:8px 10px;border:1px solid var(--border,#2a2a2a);font-size:0.7rem;letter-spacing:1px; }
            .dp-streak-chip b { color:var(--neon);font-size:0.9rem; }
            .dp-streak-week { display:flex;gap:6px;justify-content:space-between;margin:14px 0; }
            .dp-streak-day { flex:1;text-align:center;font-size:0.75rem;letter-spacing:1px;color:var(--text-dim); }
            .dp-streak-dot { height:30px;display:flex;align-items:center;justify-content:center;margin-top:4px;
                border:1px solid var(--border,#2a2a2a);font-size:0.9rem; }
            .dp-streak-dot.written { background:var(--neon);color:#000;border-color:var(--neon); }
            .dp-streak-dot.frozen  { border-color:#7fd8ff;color:#7fd8ff; }
            .dp-streak-dot.today   { border-style:dashed;border-color:var(--neon); }
        `;
        document.head.appendChild(st);
    }

    function subline(v) {
        if (!v.length) return 'WRITE TODAY TO START ONE';
        if (v.doneToday) return 'DONE FOR TODAY';
        return v.freezes ? 'WRITE TODAY · A FREEZE WILL COVER IT IF NOT' : 'WRITE TODAY TO KEEP IT';
    }
    function freezeIcons(v) { return v.freezes ? ' ' + '❄️'.repeat(v.freezes) : ''; }

    function boxHTML(v) {
        return `<div class="sb-label">STREAK</div>
            <div class="dp-streak-num">🔥 ${v.length}${freezeIcons(v)}</div>
            <div class="dp-streak-sub">${subline(v)}</div>`;
    }

    function render() {
        css();
        const v = S.current();
        // Sidebar (desktop) — after the LEVEL box
        const right = document.getElementById('globalSideRight');
        if (right) {
            let box = document.getElementById('sbStreak');
            if (!box) {
                box = document.createElement('div');
                box.id = 'sbStreak'; box.className = 'side-box dp-streak-box';
                box.onclick = openPanel;
                right.insertBefore(box, right.children[1] || null);
            }
            box.innerHTML = boxHTML(v);
        }
        // Mobile slide-in panel — after its LEVEL box
        const panel = document.getElementById('mobSidePanel');
        if (panel) {
            let box = document.getElementById('mobStreak');
            if (!box) {
                const level = panel.querySelector('.side-box');
                box = document.createElement('div');
                box.id = 'mobStreak'; box.className = 'side-box dp-streak-box';
                box.style.marginBottom = '12px';
                box.onclick = openPanel;
                if (level && level.nextSibling) panel.insertBefore(box, level.nextSibling); else panel.appendChild(box);
            }
            box.innerHTML = boxHTML(v);
        }
        // Write page footer chip
        const footer = document.querySelector('.write-footer');
        if (footer) {
            let chip = document.getElementById('writeStreakChip');
            if (!chip) {
                chip = document.createElement('div');
                chip.id = 'writeStreakChip'; chip.className = 'dp-streak-chip';
                chip.onclick = openPanel;
                footer.insertBefore(chip, footer.firstChild);
            }
            chip.innerHTML = `<span><b>🔥 ${v.length}</b> DAY${v.length === 1 ? '' : 'S'}${freezeIcons(v)}</span>
                <span style="color:var(--text-dim);font-size:0.75rem;text-align:right;">${subline(v)}</span>`;
        }
    }

    function openPanel() {
        const v = S.current();
        const ov = document.createElement('div');
        ov.className = 'overlay'; ov.style.display = 'flex'; ov.id = 'dpStreakPanel';
        const days = v.week.map(d => {
            const mark = d.status === 'written' ? '✓' : d.status === 'frozen' ? '❄️' : '';
            return `<div class="dp-streak-day">${DAY[d.weekday]}<div class="dp-streak-dot ${d.status}">${mark}</div></div>`;
        }).join('');
        const slots = Array.from({ length: v.maxFreezes }, (_, i) => i < v.freezes ? '❄️' : '<span style="opacity:0.25">❄️</span>').join(' ');
        ov.innerHTML = `
            <div class="congrats-box" style="max-width:380px;width:92%;text-align:left;">
                <h2 style="color:var(--neon);margin:0;letter-spacing:3px;">🔥 ${v.length}-DAY STREAK</h2>
                <div class="dp-streak-sub" style="margin-top:6px;">${subline(v)} · BEST ${v.best}</div>
                <div class="dp-streak-week">${days}</div>
                <div style="border-top:1px solid var(--border,#2a2a2a);padding-top:12px;">
                    <div style="font-size:0.75rem;letter-spacing:2px;margin-bottom:6px;">STREAK FREEZES &nbsp;${slots}</div>
                    <p style="font-size:0.875rem;color:var(--text-dim);letter-spacing:1px;line-height:1.6;margin:0 0 16px;">
                        A freeze covers a day you miss, automatically. Earn one for every 5 days in a row,
                        or for writing over 1,500 words in a day. Hold up to 3.</p>
                </div>
                <button type="button" style="width:100%;">CLOSE</button>
            </div>`;
        const close = () => ov.remove();
        ov.querySelector('button').onclick = close;
        ov.addEventListener('click', e => { if (e.target === ov) close(); });
        document.body.appendChild(ov);
    }

    // Once a day, on opening: a quiet reminder if today is still to do, and a
    // note when a freeze has covered a missed day (each freeze told once).
    function nudge() {
        const v = S.current();
        let seen = [];
        try { seen = JSON.parse(localStorage.getItem('dpStreakFrozeSeen') || '[]'); } catch (e) {}
        const newFrozen = v.frozeDays.filter(d => !seen.includes(d));
        const shownToday = localStorage.getItem('dpStreakNudge') === v.today;

        let title = '', sub = '';
        if (newFrozen.length && v.length) {
            title = `❄️ ${newFrozen.length > 1 ? newFrozen.length + ' FREEZES' : 'A FREEZE'} SAVED YOUR STREAK`;
            sub = `Your ${v.length}-day streak is safe. ${v.doneToday ? '' : 'Write today to keep it going.'}`;
            try { localStorage.setItem('dpStreakFrozeSeen', JSON.stringify(seen.concat(newFrozen).slice(-30))); } catch (e) {}
        } else if (!shownToday && v.atRisk && v.length >= 2) {
            title = `🔥 ${v.length}-DAY STREAK`;
            sub = v.freezes ? `Write today to keep it going. If you can’t, a freeze will cover it.` : 'Write today to keep it going.';
        } else return;
        try { localStorage.setItem('dpStreakNudge', v.today); } catch (e) {}

        const bar = document.createElement('div');
        bar.id = 'dpStreakNudge';
        bar.style.cssText = `position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:1000;width:380px;max-width:92vw;
            box-sizing:border-box;background:var(--panel,#161616);border:1px solid var(--neon,#0ff);padding:12px 16px;
            font-family:'Courier New',monospace;color:var(--text,#fff);cursor:pointer;`;
        bar.innerHTML = `<div style="font-size:0.75rem;font-weight:900;letter-spacing:2px;">${title}</div>
            <div style="font-size:0.75rem;color:var(--text-dim);letter-spacing:1px;margin-top:4px;line-height:1.4;">${sub}</div>`;
        bar.onclick = () => { bar.remove(); openPanel(); };
        document.body.appendChild(bar);
        setTimeout(() => { bar.style.transition = 'opacity .4s'; bar.style.opacity = '0'; setTimeout(() => bar.remove(), 450); }, 7000);
    }

    window.dpStreakRefresh = render;
    function init() {
        render();
        // Let the new-week message (if any) go first
        setTimeout(() => { if (!document.getElementById('periodNoticeOverlay')) nudge(); else {
            const t = setInterval(() => { if (!document.getElementById('periodNoticeOverlay')) { clearInterval(t); nudge(); } }, 500);
        } }, 1200);
        // Keep the display right if the page stays open past midnight
        setInterval(render, 5 * 60 * 1000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
    else setTimeout(init, 0);
})();
