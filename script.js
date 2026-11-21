console.log("Draft Punk Script Loading...");

// Returns the best available image for a boss (1-based index)
// Uses game sprite manifest if loaded, falls back to bosses/ folder
window.getBossImgSrc = function(oneBased) {
    const n = Math.max(1, Math.min(15, oneBased));
    const key = 'Boss' + String(n).padStart(2, '0');
    if (window.gameManifest && window.gameManifest.bosses[key]) {
        const idle = window.gameManifest.bosses[key].Idle;
        if (idle && idle.length) return idle[0];
    }
    return 'bosses/' + n + '.png';
};

// Re-run updateUI once game manifest loads so boss sprite updates from emoji→sprite
window.onGameManifestReady = function() {
    if (typeof updateUI === 'function') updateUI();
};

let deferredPrompt = null;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;

window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
});
window.addEventListener('appinstalled', () => {
    document.querySelectorAll('.install-btn').forEach(b => b.classList.add('hidden'));
});
window.installApp = function() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(() => {
            deferredPrompt = null;
            document.querySelectorAll('.install-btn').forEach(b => b.classList.add('hidden'));
        });
    } else {
        document.getElementById('iosInstallOverlay').style.display = 'flex';
    }
};
window.closeIOSInstall = function() {
    document.getElementById('iosInstallOverlay').style.display = 'none';
};

// ── Data model ────────────────────────────────────────────────────────────────
// draftPunkData shape:
// { activeProjectId: string, projects: { [id]: ProjectState } }
// Migrates automatically from old flat format.

function makeProjectId() { return 'proj_' + Date.now(); }

function getWeekKey() {
    const d = new Date();
    const day = d.getDay() || 7;
    d.setDate(d.getDate() + 4 - day);
    const yr = new Date(d.getFullYear(), 0, 1);
    return d.getFullYear() + '-W' + Math.ceil(((d - yr) / 86400000 + 1) / 7);
}
function getMonthKey()  { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function getYearKey()   { return '' + new Date().getFullYear(); }
function getTodayKey()  { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function getYesterdayKey() { const d = new Date(); d.setDate(d.getDate()-1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

function emptyProject(overrides = {}) {
    return {
        active: true,
        title: '', genre: 'urbanFantasy', goal: 80000, deadline: '',
        total: 0, logs: [], lastLevel: -1, inventory: [],
        wordsThisWeek: 0, wordsThisMonth: 0, wordsThisYear: 0,
        lastWeekReset: getWeekKey(), lastMonthReset: getMonthKey(), lastYearReset: getYearKey(),
        xp: 0, currentStreak: 0, lastWritingDate: '',
        createdAt: Date.now(),
        ...overrides
    };
}

function loadDpData() {
    let raw = JSON.parse(localStorage.getItem('draftPunkData') || '{}');

    // Migrate old flat format (had `active` at top level, no `projects`)
    if (raw && raw.active !== undefined && !raw.projects) {
        const id = makeProjectId();
        raw = {
            activeProjectId: id,
            projects: { [id]: { ...raw, createdAt: Date.now() } }
        };
        localStorage.setItem('draftPunkData', JSON.stringify(raw));
    }
    return raw;
}

let dpData  = loadDpData();
let activeId = dpData.activeProjectId || null;
let state   = (activeId && dpData.projects && dpData.projects[activeId])
              || emptyProject({ active: false });

// Migrate existing projects: seed XP from word count if XP is missing or behind total
if (state.active !== false && state.total > 0 && (state.xp == null || state.xp < state.total)) {
    state.xp = state.total;
    save();
}
// Migrate old 0-indexed month key (e.g. '2026-4') to 1-indexed padded ('2026-05').
// Only unpadded single-digit months are unambiguously old format: the previous
// pattern also matched current keys like '2026-11', so this "migration" ran on
// every dashboard load and zeroed the monthly word count.
if (state.lastMonthReset && /^\d{4}-\d$/.test(state.lastMonthReset)) {
    const parts = state.lastMonthReset.split('-');
    const oldMonth = parseInt(parts[1]);
    if (oldMonth <= 11) {
        state.lastMonthReset = parts[0] + '-' + String(oldMonth + 1).padStart(2, '0');
        save();
    }
}


const GENRE_STYLES = {
    urbanFantasy: "#0ff", sciFi: "#0fa", fantasy: "#ffd700", horror: "#ff0000",
    cyberpunk: "#f0f", crimeNoir: "#708090", romance: "#ff69b4", thriller: "#ffa500", western: "#cd7f32"
};

document.addEventListener('dpMonthlyRepaired', () => {
    const fresh = loadDpData();
    Object.keys((fresh && fresh.projects) || {}).forEach(id => {
        const mem = dpData.projects && dpData.projects[id];
        if (!mem) return;
        mem.wordsThisMonth = fresh.projects[id].wordsThisMonth;
        mem.lastMonthReset = fresh.projects[id].lastMonthReset;
    });
    if (state && fresh.projects && fresh.projects[activeId]) {
        state.wordsThisMonth = fresh.projects[activeId].wordsThisMonth;
        state.lastMonthReset = fresh.projects[activeId].lastMonthReset;
    }
    if (typeof updateUI === 'function') updateUI();
});

function save() {
    if (activeId) {
        if (!dpData.projects) dpData.projects = {};
        dpData.projects[activeId] = state;
    }
    localStorage.setItem('draftPunkData', JSON.stringify(dpData));
}

// ── One-time buddy backfill ───────────────────────────────────────────────────
function wordRunnerRescued() {
    try {
        const wr = JSON.parse(localStorage.getItem('wordRunnerData') || '{}');
        return Array.isArray(wr.rescued) ? wr.rescued : [];
    } catch (e) { return []; }
}

function backfillBuddies() {
    // One buddy per 5,000 words. (Counts the whole collection, as before, so
    // this doesn't start adding buddies on page load for existing writers.)
    const expected = Math.floor((state.total || 0) / 5000);
    state.inventory = state.inventory || [];
    if (state.inventory.length >= expected) return;
    while (state.inventory.length < expected) {
        const file = window.DPTracker.rollNewBuddy(state.inventory);
        if (!file) break;
        state.inventory.push(file);
    }
    save();
}

// ── Period reset (weekly / monthly / yearly counters) ─────────────────────────
function checkPeriodResets() {
    if (window.DPTracker.applyPeriodResets(state)) save();
}

// ── Start a new project ───────────────────────────────────────────────────────
window.start = function() {
    const id = makeProjectId();
    if (!dpData.projects) dpData.projects = {};
    dpData.projects[id] = emptyProject({
        title:    document.getElementById('titleIn').value    || 'PROJECT',
        goal:     parseInt(document.getElementById('goalIn').value) || 80000,
        deadline: document.getElementById('deadlineIn').value,
        genre:    document.getElementById('genreIn').value,
        logs:     [{ date: new Date().toLocaleDateString(), total: 0 }]
    });
    dpData.activeProjectId = id;
    localStorage.setItem('draftPunkData', JSON.stringify(dpData));
    window.location.href = 'write.html';
};

// ── Switch to an existing project ─────────────────────────────────────────────
window.switchProject = function(id) {
    if (!dpData.projects || !dpData.projects[id]) return;
    dpData.activeProjectId = id;
    localStorage.setItem('draftPunkData', JSON.stringify(dpData));
    location.reload();
};

// ── Delete a project ──────────────────────────────────────────────────────────
window.deleteProject = function(id) {
    if (!dpData.projects || !dpData.projects[id]) return;
    const title = dpData.projects[id].title || 'this project';
    if (!confirm('Delete "' + title + '"? This cannot be undone.')) return;
    delete dpData.projects[id];
    if (dpData.activeProjectId === id) {
        const remaining = Object.keys(dpData.projects);
        dpData.activeProjectId = remaining.length ? remaining[0] : null;
    }
    localStorage.setItem('draftPunkData', JSON.stringify(dpData));
    location.reload();
};

// ── Floating damage number ────────────────────────────────────────────────────
function showDamageNumber(val) {
    const zone = document.querySelector('.boss-zone');
    if (!zone) return;
    const isCrit = Math.random() < 0.2;
    const el = document.createElement('div');
    el.className = 'damage-number' + (isCrit ? ' damage-crit' : '');
    el.textContent = isCrit ? `CRITICAL! -${val.toLocaleString()}` : `-${val.toLocaleString()}`;
    el.style.left = (15 + Math.random() * 55) + '%';
    el.style.bottom = '10px';
    zone.appendChild(el);
    setTimeout(() => el.remove(), 1200);
}

// ── Combat toast (non-interrupting corner notification) ───────────────────────
function showCombatToast(label, name, emoji, taunt, spriteUrl) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'combat-toast';
    const iconHtml = spriteUrl
        ? `<img src="${spriteUrl}" style="height:40px;width:auto;image-rendering:pixelated;display:block;flex-shrink:0;">`
        : (emoji ? `<span class="toast-emoji">${emoji}</span>` : '');
    toast.innerHTML = `
        <div class="toast-label">${label}</div>
        <div class="toast-name" style="display:flex;align-items:center;gap:6px;">
            ${iconHtml}${name.toUpperCase()}
        </div>
        ${taunt ? `<div class="toast-taunt">"${taunt}"</div>` : ''}`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

// renderJourneyMap removed

// ── Add words ─────────────────────────────────────────────────────────────────
window.addWords = function() {
    const val = parseInt(document.getElementById('wordIn').value) || 0;
    if (val <= 0) return;

    // Writer streak + freezes (all projects together); recorded before the
    // project is updated so a first-time carry-over isn't counted twice
    const sev = window.DPStreak ? window.DPStreak.recordWords(val, JSON.parse(JSON.stringify(dpData.projects || {}))) : null;

    // All the tracker rules live in tracker.js, shared with the Write page
    const ev = window.DPTracker.awardWords(state, val);

    if (ev.streak)  showCombatToast(`🔥 ${ev.streak.days}-DAY STREAK`, `+${ev.streak.bonus} BONUS XP`, null);
    if (ev.session) showCombatToast(ev.session.label, `+${ev.session.bonus} BONUS XP`, ev.session.bonus >= 500 ? '💥' : '⚡');

    // ── Boss beat defeated ────────────────────────────────────────────────────
    if (ev.beat) {
        document.getElementById('bossBeatTitle').innerText = ev.beat.name;
        document.getElementById('defeatedBossSprite').src = window.getBossImgSrc(ev.beat.idx + 1);
        document.getElementById('levelOverlay').style.display = 'flex';
        if (window.SFX) SFX.bossDefeated();
        const app = document.querySelector('.app');
        app.classList.remove('app-shake');
        void app.offsetWidth;
        app.classList.add('app-shake');
    }

    // ── Buddy found ───────────────────────────────────────────────────────────
    ev.buddies.forEach(buddyFile => {
        const overlayImg = document.getElementById('newBuddySprite');
        if (overlayImg) overlayImg.src = `buddies/${buddyFile}`;
        document.getElementById('buddyOverlay').style.display = 'flex';
        if (window.SFX) SFX.buddyRescued();
    });

    const sprite = document.getElementById('bossSprite');
    if (sprite) {
        sprite.classList.remove('hit-shake');
        void sprite.offsetWidth;
        sprite.classList.add('hit-shake');
    }
    if (window.SFX) SFX.bossHit();

    // 1–3% chance of floating damage number
    if (Math.random() < (0.01 + Math.random() * 0.02)) showDamageNumber(val);

    // ── Writer level-up ───────────────────────────────────────────────────────
    if (ev.levelUp) {
        const tier      = Math.min(5, Math.ceil(ev.levelUp.level / 5));
        const shield    = document.getElementById('levelUpShield');
        shield.src      = `shields/${tier}.png`;
        shield.classList.remove('shield-pop');
        void shield.offsetWidth; // reflow to restart animation
        shield.classList.add('shield-pop');
        document.getElementById('levelUpNumber').innerText = ev.levelUp.level;
        document.getElementById('levelUpRank').innerText   = ev.levelUp.rank;
        document.getElementById('levelUpOverlay').style.display = 'flex';
        if (window.SFX) SFX.levelUp();
    }

    // ── Minion encounters ─────────────────────────────────────────────────────
    if (ev.minion) {
        const labels = ['HENCHMAN DEFEATED', 'MINION SUBDUED', 'FOE VANQUISHED', 'OBSTACLE CRUSHED'];
        const label  = labels[ev.minion.idx % labels.length];
        const mKey   = 'MonsterV' + (ev.minion.idx + 1);
        const mData  = window.gameManifest && window.gameManifest.monsters[mKey];
        const mSprite = mData && mData.Idle && mData.Idle[0] ? mData.Idle[0] : null;
        showCombatToast(label, ev.minion.name, ev.minion.emoji, ev.minion.taunt, mSprite);
        if (window.SFX) SFX.minionDefeated();
    }

    save(); updateUI(); updateGraph();
    const wordInBox = document.getElementById('wordIn');
    if (wordInBox) wordInBox.value = '';
    if (sev) {
        if (window.dpStreakRefresh) window.dpStreakRefresh();
        if (sev.frozeDays.length) showCombatToast('\u2744\uFE0F STREAK SAVED', `${sev.frozeDays.length > 1 ? sev.frozeDays.length + ' FREEZES' : 'A FREEZE'} COVERED THE MISSED DAY${sev.frozeDays.length > 1 ? 'S' : ''}`, null);
        sev.earned.forEach(e => showCombatToast(e.kept ? '\u2744\uFE0F STREAK FREEZE EARNED' : '\u2744\uFE0F FREEZES FULL',
            e.kept ? (e.reason === 'streak' ? `${e.days} DAYS IN A ROW` : 'OVER 1,500 WORDS TODAY') : 'YOU ALREADY HOLD THE MAXIMUM OF 3', null));
    }
    // Offer daily reminders (once; only where they can work)
    if (window.dpOfferNotifications) window.dpOfferNotifications();
};

// ── Correct word count ────────────────────────────────────────────────────────
window.showCorrectWords = function() {
    document.getElementById('correctInput').value = state.total;
    document.getElementById('correctOverlay').style.display = 'flex';
    document.getElementById('correctInput').select();
};
window.closeCorrectOverlay = function() {
    document.getElementById('correctOverlay').style.display = 'none';
};
window.applyCorrection = function() {
    const newTotal = parseInt(document.getElementById('correctInput').value);
    if (isNaN(newTotal) || newTotal < 0) return;
    const delta = newTotal - state.total;

    state.total         = newTotal;
    state.wordsThisWeek  = Math.max(0, (state.wordsThisWeek  || 0) + delta);
    state.wordsThisMonth = Math.max(0, (state.wordsThisMonth || 0) + delta);
    state.wordsThisYear  = Math.max(0, (state.wordsThisYear  || 0) + delta);
    state.logs.push({ date: new Date().toLocaleDateString(), total: state.total });

    // Recalculate XP: base is word count, preserve bonus XP earned on top
    const prevBaseXP  = Math.max(0, state.total - delta); // words before correction
    const bonusXP     = Math.max(0, (state.xp || 0) - prevBaseXP); // XP earned beyond words
    state.xp          = newTotal + bonusXP;

    // Recalculate boss beat progress
    const progress = state.goal > 0 ? (newTotal / state.goal) * 100 : 0;
    state.lastLevel = BOSS_BEATS.findLastIndex(b => progress >= b.pct);

    // Recalculate buddy count — 1 buddy per 5000 words, capped at inventory earned
    // Word Runner sprint rescues are earned separately and are never removed.
    const expectedBuddies = Math.floor(newTotal / 5000);
    const rescued = wordRunnerRescued();
    const earned  = state.inventory.filter(b => !rescued.includes(b));
    if (earned.length > expectedBuddies) {
        const keepEarned = earned.slice(0, expectedBuddies);
        state.inventory = state.inventory.filter(b => rescued.includes(b) || keepEarned.includes(b));
    }

    save(); updateUI(); updateGraph();
    if (window.updateSidebar) window.updateSidebar();
    closeCorrectOverlay();
};

// ── Writer level (XP-based, independent of beats) ────────────────────────────
// XP to reach level L: 1000 * (L-1) * L / 2
//   Level 1 =       0 XP   Level 6 = 15,000 XP   Level 11 = 55,000 XP
//   Level 2 =   1,000 XP   Level 7 = 21,000 XP   Level 12 = 66,000 XP
//   Level 3 =   3,000 XP   Level 8 = 28,000 XP   Level 15 = 105,000 XP
//   Level 4 =   6,000 XP   Level 9 = 36,000 XP   Level 20 = 190,000 XP
//   Level 5 =  10,000 XP   Level 10= 45,000 XP   Level 25 = 300,000 XP
// Bonus XP: +1/word (base), +streak*10/day, +250 long session, +500 mega session,
//           +500 boss beat, +200 buddy found, +sprint reward (Wordrunner)
function getWriterLevel(xp) {
    // L = floor((1 + sqrt(1 + 8*xp/1000)) / 2)
    return Math.floor((1 + Math.sqrt(1 + 8 * xp / 1000)) / 2);
}
function getWriterLevelThreshold(level) {
    // XP required to reach this level (1-based)
    const n = level - 1;
    return 1000 * n * (n + 1) / 2;
}

// ── Chart ─────────────────────────────────────────────────────────────────────
let chart;

window.updateChartTheme = function() {
    if (!chart) return;
    const neon    = getComputedStyle(document.body).getPropertyValue('--neon').trim();
    const isLight = document.body.classList.contains('light-mode');
    const gridCol = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)';
    chart.data.datasets[0].borderColor = neon;
    chart.options.scales.y.ticks.color = neon;
    chart.options.scales.y.grid.color  = gridCol;
    chart.update();
};

function initGraph() {
    const ctx = document.getElementById('velocityChart').getContext('2d');
    if (chart) chart.destroy();
    const style = getComputedStyle(document.body);
    const neon  = style.getPropertyValue('--neon').trim();
    const isLight = document.body.classList.contains('light-mode');
    const gridCol = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)';
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: state.logs.map(l => l.date),
            datasets: [{
                data: state.logs.map(l => l.total),
                borderColor: neon,
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.2,
                fill: false
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                y: {
                    ticks: { color: neon, font: { size: 11 } },
                    grid:  { color: gridCol }
                }
            }
        }
    });
}

function updateGraph() {
    if (!chart) return;
    chart.data.labels = state.logs.map(l => l.date);
    chart.data.datasets[0].data = state.logs.map(l => l.total);
    chart.update();
}

// ── UI ────────────────────────────────────────────────────────────────────────
function updateUI() {
    const progress = state.goal > 0 ? (state.total / state.goal) * 100 : 0;
    const curIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    const curB = BOSS_BEATS[curIdx] || BOSS_BEATS[0];
    const nxtB = BOSS_BEATS[curIdx + 1] || { pct: 100, name: 'The End' };
    const beatSpan = nxtB.pct - curB.pct;
    const progressInBeat = progress - curB.pct;
    const hp = Math.max(0, 100 - (progressInBeat / (beatSpan || 1) * 100));

    document.getElementById('wcMain').innerText = state.total.toLocaleString();
    document.getElementById('wipDisplay').innerText = state.title;
    document.getElementById('lvlName').innerText = `STAGE ${curIdx + 1} — ${curB.name.toUpperCase()}`;
    document.getElementById('bossHPBar').style.width = hp + '%';
    document.getElementById('hpBar').style.width = Math.min(100, progress) + '%';
    document.getElementById('hpText').innerText = state.total.toLocaleString() + ' / ' + state.goal.toLocaleString();
    document.getElementById('loreBox').innerText = curB.lore;
    document.getElementById('tipsBox').innerText = MICRO_TIPS[Math.min(100, Math.floor(progress))];
    if (window.updateSidebar) window.updateSidebar();
    document.getElementById('buddyCountDisplay').innerText = state.inventory.length;
    document.getElementById('buddyGallery').innerHTML = state.inventory.map(i =>
        `<img src="buddies/${i}" class="buddy-relic" onclick="showBuddyZoom('buddies/${i}')">`
    ).join('');

    renderStageMap(progress, curIdx);

    // Show project count indicator if more than one project
    const projects = Object.keys(dpData.projects || {});
    const projCount = document.getElementById('projectCountLabel');
    if (projCount) projCount.textContent = projects.length > 1 ? projects.length + ' PROJECTS' : '';

}

// ── Stage map ─────────────────────────────────────────────────────────────────
// Shows the current stage (last boss beaten → next boss) with its minions,
// where the writer is, and a small strip of the bosses already defeated.
// Display only: reads state, never changes or saves it.
const SM_X = '<svg class="sm-x" aria-hidden="true" viewBox="0 0 100 100" fill="none" stroke-linecap="square"><path class="sm-x-under" d="M14 14L86 86M86 14L14 86"/><path class="sm-x-over" d="M14 14L86 86M86 14L14 86"/></svg>';
function smPos(f) { return `calc(var(--sm-pad) + (100% - 2 * var(--sm-pad)) * ${Math.max(0, Math.min(1, f)).toFixed(4)})`; }
function renderStageMap(progress, curIdx) {
    const track = document.getElementById('smTrack');
    if (!track) return;
    const goal  = state.goal > 0 ? state.goal : 0;
    const words = pct => goal ? Math.ceil((pct / 100) * goal - 1e-6) : 0;
    const fmt   = n => n.toLocaleString();
    const done  = pct => progress >= pct;

    // The stage shown: from the last boss beaten to the next one. Once the
    // final boss is beaten, keep showing the last stage, all cleared.
    let leftIdx = curIdx, rightIdx = curIdx + 1;
    if (rightIdx >= BOSS_BEATS.length) { leftIdx = BOSS_BEATS.length - 2; rightIdx = BOSS_BEATS.length - 1; }
    const p0 = leftIdx >= 0 ? BOSS_BEATS[leftIdx].pct : 0;
    const p1 = BOSS_BEATS[rightIdx].pct;
    // Nodes are evenly spaced (so they never crowd on a small screen); the
    // writer moves between them in proportion to the words.
    const stops = [p0].concat(MINIONS.filter(m => m.pct > p0 && m.pct < p1).map(m => m.pct), [p1]);
    const frac = pct => {
        const n = stops.length - 1;
        if (pct <= stops[0]) return 0;
        for (let k = 0; k < n; k++) {
            if (pct <= stops[k + 1]) return (k + (pct - stops[k]) / ((stops[k + 1] - stops[k]) || 1)) / n;
        }
        return 1;
    };
    const you  = frac(Math.min(progress, p1));

    let html = '';
    html += `<div class="sm-line sm-line-done" style="left:var(--sm-pad);width:calc((100% - 2 * var(--sm-pad)) * ${Math.max(0, Math.min(1, you)).toFixed(4)})"></div>`;
    html += `<div class="sm-line sm-line-todo" style="left:${smPos(you)};right:var(--sm-pad)"></div>`;

    // Left end: the boss beaten to open this stage (or the start line)
    if (leftIdx >= 0) {
        html += `<div class="sm-node sm-boss-node sm-defeated-node" style="left:${smPos(0)}"><img src="stagemap/boss${leftIdx + 1}.png" alt="${BOSS_BEATS[leftIdx].name}, defeated">${SM_X}</div>`;
        html += `<div class="sm-tag sm-tag-boss" style="left:${smPos(0)}">${BOSS_BEATS[leftIdx].name.toUpperCase()}<br><span>${fmt(words(p0))}</span></div>`;
    } else {
        html += `<div class="sm-node sm-start" style="left:${smPos(0)}"></div>`;
        html += `<div class="sm-tag sm-tag-boss" style="left:${smPos(0)}">START<br><span>0</span></div>`;
    }

    // Minions in this stage
    let nextMinion = null;
    MINIONS.forEach((m, i) => {
        if (!(m.pct > p0 && m.pct < p1)) return;
        const beaten = done(m.pct);
        const isNext = !beaten && !nextMinion;
        if (isNext) nextMinion = { m: m, i: i };
        html += `<div class="sm-node sm-minion${beaten ? ' sm-defeated-node' : ''}${isNext ? ' sm-is-next' : ''}" style="left:${smPos(frac(m.pct))}"><img src="stagemap/minion${i + 1}.png" alt="${m.name}${beaten ? ', defeated' : ''}">${beaten ? SM_X : ''}</div>`;
        html += `<div class="sm-tag sm-tag-minion" style="left:${smPos(frac(m.pct))}">${fmt(words(m.pct))}</div>`;
    });

    // Right end: the boss that closes this stage
    const rightBeaten = done(p1);
    if (rightBeaten) {
        html += `<div class="sm-node sm-boss-node sm-defeated-node" style="left:${smPos(1)}"><img src="stagemap/boss${rightIdx + 1}.png" alt="${BOSS_BEATS[rightIdx].name}, defeated">${SM_X}</div>`;
    } else {
        html += `<button type="button" class="sm-node sm-boss-node sm-boss-next" style="left:${smPos(1)}" onclick="showBossZoom()" aria-label="${BOSS_BEATS[rightIdx].name}: boss info"><img id="bossSprite" src="stagemap/boss${rightIdx + 1}.png" alt=""></button>`;
    }
    html += `<div class="sm-tag sm-tag-boss sm-tag-next" style="left:${smPos(1)}">${BOSS_BEATS[rightIdx].name.toUpperCase()}<br><span>${fmt(words(p1))}</span></div>`;

    // The writer
    if (!rightBeaten) {
        html += `<div class="sm-you-dot" style="left:${smPos(you)}"></div>`;
        html += `<div class="sm-you" style="left:${smPos(you)}"><span class="sm-you-tag">YOU</span><span class="sm-you-stem"></span></div>`;
    }
    track.innerHTML = html;

    document.getElementById('smRange').textContent = `${p0}% → ${p1}%`;

    // Next encounter
    const nextBox = document.getElementById('smNext');
    if (rightBeaten) {
        nextBox.style.display = 'none';
    } else {
        nextBox.style.display = '';
        const toGo = nextMinion ? words(nextMinion.m.pct) - state.total : words(p1) - state.total;
        document.getElementById('smNextSprite').src = nextMinion ? `stagemap/minion${nextMinion.i + 1}.png` : `stagemap/boss${rightIdx + 1}.png`;
        document.getElementById('smNextName').textContent = (nextMinion ? nextMinion.m.name : BOSS_BEATS[rightIdx].name).toUpperCase();
        document.getElementById('smNextToGo').textContent = fmt(Math.max(0, toGo));
    }
    document.getElementById('smBossToGo').textContent = rightBeaten ? 'DRAFT COMPLETE' : `${fmt(Math.max(0, words(p1) - state.total))} TO GO`;
    document.getElementById('bossName').innerText = 'BOSS: ' + BOSS_BEATS[rightIdx].name.toUpperCase();

    // Defeated bosses, small
    const beatenCount = BOSS_BEATS.filter(b => done(b.pct)).length;
    const strip = document.getElementById('smDefeated');
    strip.style.display = beatenCount ? '' : 'none';
    document.getElementById('smDefeatedLabel').textContent = `DEFEATED ${beatenCount}/${BOSS_BEATS.length}`;
    document.getElementById('smDefeatedList').innerHTML = BOSS_BEATS.slice(0, beatenCount).map((b, i) =>
        `<span class="sm-mini" title="${b.name}"><img src="stagemap/boss${i + 1}.png" alt="${b.name}">${SM_X}</span>`
    ).join('');

    // Threshold ticks on the total progress bar
    const ticks = document.getElementById('progressTicks');
    if (ticks && !ticks.childElementCount) {
        ticks.innerHTML = BOSS_BEATS.map(b => `<i class="sm-tick sm-tick-boss" style="left:${b.pct}%"></i>`).join('')
                        + MINIONS.map(m => `<i class="sm-tick" style="left:${m.pct}%"></i>`).join('');
    }
}

// ── Overlays ──────────────────────────────────────────────────────────────────
window.toggleIntel = function() { document.getElementById('intelContainer').classList.toggle('hidden'); };
window.showGrenade = function() {
    document.getElementById('inspireText').innerText = GRENADES[Math.floor(Math.random() * GRENADES.length)];
    document.getElementById('grenadeOverlay').style.display = 'flex';
};
window.closeGrenade      = function() { document.getElementById('grenadeOverlay').style.display = 'none'; };
window.closeLevelUp      = function() { document.getElementById('levelUpOverlay').style.display = 'none'; };
window.closeOverlay      = function() { document.getElementById('levelOverlay').style.display = 'none'; };
window.closeBuddyOverlay = function() { document.getElementById('buddyOverlay').style.display = 'none'; };

window.showBossZoom = function() {
    const progress   = state.goal > 0 ? (state.total / state.goal) * 100 : 0;
    const curBeatIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    const nextBeat   = BOSS_BEATS[curBeatIdx + 1] || BOSS_BEATS[curBeatIdx];
    const wordsNeeded = Math.ceil((nextBeat.pct / 100) * state.goal) - state.total;
    document.getElementById('bossZoomSprite').src = window.getBossImgSrc(curBeatIdx + 2);
    document.getElementById('bossZoomName').innerText = `STAGE ${curBeatIdx + 2} — ${nextBeat.name.toUpperCase()}`;
    document.getElementById('bossZoomBeat').innerText = wordsNeeded > 0
        ? `${wordsNeeded.toLocaleString()} WORDS TO DEFEAT`
        : 'DEFEATED';
    document.getElementById('bossZoomLore').innerText = nextBeat.lore;
    document.getElementById('bossZoomOverlay').style.display = 'flex';
};
window.closeBossZoom = function() { document.getElementById('bossZoomOverlay').style.display = 'none'; };

window.showBuddyZoom = function(src) {
    const match = src.match(/buddy(\d+)\.png/);
    const num   = match ? parseInt(match[1]) : 0;
    const buddy = BUDDY_DATA[num - 1] || { name: 'MYSTERY BUDDY', fact: 'Origins unknown.' };
    document.getElementById('buddyZoomSprite').src = src;
    document.getElementById('buddyZoomName').innerText = buddy.name.toUpperCase();
    document.getElementById('buddyZoomFact').innerText = buddy.fact;
    document.getElementById('buddyZoomOverlay').style.display = 'flex';
};
window.closeBuddyZoom = function() { document.getElementById('buddyZoomOverlay').style.display = 'none'; };

// ── Project settings (edit current) ──────────────────────────────────────────
window.showProjectSettings = function() {
    document.getElementById('editTitle').value    = state.title;
    document.getElementById('editGenre').value    = state.genre;
    document.getElementById('editGoal').value     = state.goal;
    document.getElementById('editDeadline').value = state.deadline;
    document.getElementById('projectSettingsOverlay').style.display = 'flex';
};
window.saveProjectSettings = function() {
    state.title    = document.getElementById('editTitle').value || state.title;
    state.goal     = parseInt(document.getElementById('editGoal').value) || state.goal;
    state.deadline = document.getElementById('editDeadline').value;
    state.genre    = document.getElementById('editGenre').value;
    save(); updateUI(); closeProjectSettings();
};
window.closeProjectSettings = function() {
    document.getElementById('projectSettingsOverlay').style.display = 'none';
};

// ── Project switcher ──────────────────────────────────────────────────────────
window.showProjectSwitcher = function() {
    const container = document.getElementById('projectList');
    const projects  = dpData.projects || {};
    const ids       = Object.keys(projects);

    if (ids.length === 0) {
        container.innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem;padding:10px 0;">No projects found.</div>';
    } else {
        container.innerHTML = ids.map(id => {
            const p       = projects[id];
            const isActive = id === activeId;
            return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:10px;
                         border:1px solid ${isActive ? 'var(--neon)' : 'var(--border)'};box-sizing:border-box;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:900;font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.title || 'UNTITLED'}</div>
                    <div style="font-size:0.75rem;color:var(--text-dim);">${(p.total || 0).toLocaleString()} / ${(p.goal || 0).toLocaleString()} WORDS</div>
                </div>
                ${isActive
                    ? '<span style="font-size:0.75rem;color:var(--neon);white-space:nowrap;">ACTIVE</span>'
                    : `<button onclick="switchProject('${id}')" style="font-size:0.75rem;padding:5px 9px;white-space:nowrap;">SWITCH</button>
                       <button onclick="deleteProject('${id}')" style="font-size:0.75rem;padding:5px 9px;background:#333;white-space:nowrap;">✕</button>`
                }
            </div>`;
        }).join('');
    }

    document.getElementById('projectSwitcherOverlay').style.display = 'flex';
};
window.closeProjectSwitcher = function() {
    document.getElementById('projectSwitcherOverlay').style.display = 'none';
};

// Show setup form for creating a new project (without losing current)
window.showNewProjectForm = function() {
    closeProjectSwitcher();
    document.getElementById('mainDashboard').classList.add('hidden');
    document.getElementById('setup').style.display = 'block';
    document.getElementById('setup').scrollIntoView();
};

// ── Show main dashboard ───────────────────────────────────────────────────────
window.showDashboard = function() {
    // Re-read data in case sync.js has updated localStorage since page load
    dpData   = loadDpData();
    activeId = dpData.activeProjectId || null;
    state    = (activeId && dpData.projects && dpData.projects[activeId])
               || emptyProject({ active: false });

    const nav = document.querySelector('.app-nav');
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('setup').style.display = 'none';
    document.getElementById('mainDashboard').classList.remove('hidden');
    if (nav) nav.style.display = '';
    checkPeriodResets();
    backfillBuddies();
    updateUI();
    initGraph();
};

// ── Home routing ─────────────────────────────────────────────────────────────
// The Write page is the app's home. index.html handles sign-in and project
// setup, and shows the dashboard only when asked for via index.html?dashboard
// (the DRAFT PUNK nav item). Otherwise a user with an active project is sent
// straight to write.html.
window.wantsDashboard = function() {
    return new URLSearchParams(window.location.search).has('dashboard');
};
window.goHome = function() {
    if (window.wantsDashboard()) window.showDashboard();
    else window.location.replace('write.html');
};

// ── Auth screen helpers ───────────────────────────────────────────────────────
window.skipAuth = function() {
    localStorage.setItem('authDecisionMade', '1');
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('setup').style.display = 'block';
};
window.showProjectForm = function() {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('setup').style.display = 'block';
};

// ── Splash screen ─────────────────────────────────────────────────────────────
// Plays the intro animation then calls then(). Does NOT make routing decisions —
// routing is owned entirely by sync.js once Firebase auth resolves.
function runSplash(then) {
    const splash = document.getElementById('splashScreen');
    if (!splash || sessionStorage.getItem('splashSeen')) {
        if (splash) splash.style.display = 'none';
        then();
        return;
    }
    sessionStorage.setItem('splashSeen', '1');

    splash.classList.add('splash-visible');
    if (window.SFX) { try { SFX.intro(); } catch(e) {} }

    setTimeout(function () {
        splash.classList.add('splash-out');
        setTimeout(function () {
            splash.style.display = 'none';
            then();
        }, 600);
    }, 2200);
}

// ── On load ───────────────────────────────────────────────────────────────────
window.onload = function() {
    const wordInEl = document.getElementById('wordIn');
    if (wordInEl) wordInEl.addEventListener('keydown', function(e) { if (e.key === 'Enter') addWords(); });

    if (!isStandalone) {
        document.querySelectorAll('.install-btn').forEach(b => b.classList.remove('hidden'));
    }

    const nav = document.querySelector('.app-nav');

    runSplash(function () {
        // Handle just-signed-out redirect first
        if (localStorage.getItem('justSignedOut')) {
            localStorage.removeItem('justSignedOut');
            history.replaceState({}, '', 'index.html');
            document.getElementById('authScreen').style.display = 'flex';
            document.getElementById('setup').style.display = 'none';
            document.getElementById('mainDashboard').classList.add('hidden');
            if (nav) nav.style.display = 'none';
            return;
        }

        // If there is already an active project in localStorage, show the dashboard
        // immediately — no need to wait for Firebase auth to resolve.
        const hasActive = activeId && dpData.projects && dpData.projects[activeId] && dpData.projects[activeId].active;
        if (hasActive) {
            window.goHome();
            return;
        }

        // If dpUserId is set, auth has already resolved and continueAfterAuth
        // (in sync.js) already showed the correct screen — don't override it.
        if (localStorage.getItem('dpUserId')) return;

        // Not signed in: guest vs first-time / signed-out visitor.
        if (localStorage.getItem('authDecisionMade')) {
            // Guest user (authDecisionMade but no dpUserId) — show project form directly
            document.getElementById('authScreen').style.display = 'none';
            document.getElementById('setup').style.display = 'block';
            document.getElementById('mainDashboard').classList.add('hidden');
            if (nav) nav.style.display = 'none';
        } else {
            document.getElementById('authScreen').style.display = 'flex';
            document.getElementById('setup').style.display = 'none';
            document.getElementById('mainDashboard').classList.add('hidden');
            if (nav) nav.style.display = 'none';
        }
    });
};
