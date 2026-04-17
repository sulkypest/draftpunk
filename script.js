console.log("Draft Punk Script Loading...");

// Returns the best available image for a boss (1-based index)
// Uses game sprite manifest if loaded, falls back to bosses/ folder
window.getBossImgSrc = function(oneBased) {
    const key = 'Boss' + String(oneBased).padStart(2, '0');
    if (window.gameManifest && window.gameManifest.bosses[key]) {
        const idle = window.gameManifest.bosses[key].Idle;
        if (idle && idle.length) return idle[0];
    }
    return 'bosses/' + oneBased + '.png';
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
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yr = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return d.getUTCFullYear() + '-W' + Math.ceil(((d - yr) / 86400000 + 1) / 7);
}
function getMonthKey()  { const d = new Date(); return d.getFullYear() + '-' + d.getMonth(); }
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

// Migrate existing projects: seed XP from word count if not yet tracked
if (state.active !== false && state.total > 0 && state.xp == null) {
    state.xp = state.total;
    save();
}


const GENRE_STYLES = {
    urbanFantasy: "#0ff", sciFi: "#0fa", fantasy: "#ffd700", horror: "#ff0000",
    cyberpunk: "#f0f", crimeNoir: "#708090", romance: "#ff69b4", thriller: "#ffa500", western: "#cd7f32"
};

function save() {
    if (activeId) {
        if (!dpData.projects) dpData.projects = {};
        dpData.projects[activeId] = state;
    }
    localStorage.setItem('draftPunkData', JSON.stringify(dpData));
}

// ── Period reset (weekly / monthly / yearly counters) ─────────────────────────
function checkPeriodResets() {
    let changed = false;
    if (state.lastWeekReset  !== getWeekKey())  { state.wordsThisWeek  = 0; state.lastWeekReset  = getWeekKey();  changed = true; }
    if (state.lastMonthReset !== getMonthKey()) { state.wordsThisMonth = 0; state.lastMonthReset = getMonthKey(); changed = true; }
    if (state.lastYearReset  !== getYearKey())  { state.wordsThisYear  = 0; state.lastYearReset  = getYearKey();  changed = true; }
    if (changed) save();
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
    window.location.href = 'index.html';
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

    const prevWriterLevel = getWriterLevel(state.xp || 0);

    // ── Base XP: 1 per word ───────────────────────────────────────────────────
    state.xp              = (state.xp || 0) + val;
    state.total          += val;
    state.wordsThisWeek   = (state.wordsThisWeek  || 0) + val;
    state.wordsThisMonth  = (state.wordsThisMonth || 0) + val;
    state.wordsThisYear   = (state.wordsThisYear  || 0) + val;
    state.logs.push({ date: new Date().toLocaleDateString(), total: state.total });

    // ── Daily streak bonus ────────────────────────────────────────────────────
    const today = getTodayKey();
    if (state.lastWritingDate !== today) {
        if (state.lastWritingDate === getYesterdayKey()) {
            state.currentStreak = (state.currentStreak || 0) + 1;
        } else {
            state.currentStreak = 1;
        }
        state.lastWritingDate = today;
        if (state.currentStreak > 1) {
            const streakBonus = state.currentStreak * 10;
            state.xp += streakBonus;
            showCombatToast(`🔥 ${state.currentStreak}-DAY STREAK`, `+${streakBonus} BONUS XP`, null);
        }
    }

    // ── Session length bonus ──────────────────────────────────────────────────
    if (val >= 5000) {
        state.xp += 500;
        showCombatToast('MEGA SESSION', '+500 BONUS XP', '💥');
    } else if (val >= 2000) {
        state.xp += 250;
        showCombatToast('LONG SESSION', '+250 BONUS XP', '⚡');
    }

    // ── Boss beat defeated ────────────────────────────────────────────────────
    const progress = (state.total / state.goal) * 100;
    const newIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    if (newIdx > state.lastLevel) {
        state.lastLevel = newIdx;
        state.xp += 500;
        document.getElementById('bossBeatTitle').innerText = BOSS_BEATS[newIdx].name;
        document.getElementById('defeatedBossSprite').src = window.getBossImgSrc(newIdx + 1);
        document.getElementById('levelOverlay').style.display = 'flex';
        if (window.SFX) SFX.bossDefeated();
        const app = document.querySelector('.app');
        app.classList.remove('app-shake');
        void app.offsetWidth;
        app.classList.add('app-shake');
    }

    // ── Buddy found ───────────────────────────────────────────────────────────
    if (Math.floor(state.total / 5000) > Math.floor((state.total - val) / 5000)) {
        const totalBuddiesAvailable = 100;
        const buddyID   = Math.floor(Math.random() * totalBuddiesAvailable) + 1;
        const buddyFile = `buddy${buddyID}.png`;
        if (!state.inventory.includes(buddyFile)) {
            state.inventory.push(buddyFile);
            state.xp += 200;
            const overlayImg = document.getElementById('newBuddySprite');
            if (overlayImg) overlayImg.src = `buddies/${buddyFile}`;
            document.getElementById('buddyOverlay').style.display = 'flex';
            if (window.SFX) SFX.buddyRescued();
            if (window.gameBuddyFound) window.gameBuddyFound();
        }
    }

    const sprite = document.getElementById('bossSprite');
    sprite.classList.remove('hit-shake');
    void sprite.offsetWidth;
    sprite.classList.add('hit-shake');
    if (window.SFX) SFX.bossHit();

    // 1–3% chance of floating damage number
    if (Math.random() < (0.01 + Math.random() * 0.02)) showDamageNumber(val);

    // ── Writer level-up (after all XP awarded this session) ──────────────────
    const newWriterLevel = getWriterLevel(state.xp);
    if (newWriterLevel > prevWriterLevel) {
        const rankName  = RANKS[newWriterLevel - 1] || 'AUTHOR';
        const tier      = Math.min(5, Math.ceil(newWriterLevel / 5));
        const shield    = document.getElementById('levelUpShield');
        shield.src      = `shields/${tier}.png`;
        shield.classList.remove('shield-pop');
        void shield.offsetWidth; // reflow to restart animation
        shield.classList.add('shield-pop');
        document.getElementById('levelUpNumber').innerText = newWriterLevel;
        document.getElementById('levelUpRank').innerText   = rankName;
        document.getElementById('levelUpOverlay').style.display = 'flex';
        if (window.SFX) SFX.levelUp();
        if (window.gameLevelUp) window.gameLevelUp();
    }

    // ── Minion encounters ─────────────────────────────────────────────────────
    const newMinionIdx = MINIONS.findLastIndex(m => progress >= m.pct);
    if (newMinionIdx > (state.lastMinionIdx ?? -1)) {
        state.lastMinionIdx = newMinionIdx;
        const minion = MINIONS[newMinionIdx];
        const labels = ['HENCHMAN DEFEATED', 'MINION SUBDUED', 'FOE VANQUISHED', 'OBSTACLE CRUSHED'];
        const label  = labels[newMinionIdx % labels.length];
        const mKey   = 'MonsterV' + (newMinionIdx + 1);
        const mData  = window.gameManifest && window.gameManifest.monsters[mKey];
        const mSprite = mData && mData.Idle && mData.Idle[0] ? mData.Idle[0] : null;
        showCombatToast(label, minion.name, minion.emoji, minion.taunt, mSprite);
        if (window.SFX) SFX.minionDefeated();
    }

    save(); updateUI(); updateGraph();
    document.getElementById('wordIn').value = '';
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
    const expectedBuddies = Math.floor(newTotal / 5000);
    if (state.inventory.length > expectedBuddies) {
        state.inventory = state.inventory.slice(0, expectedBuddies);
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
    const progress = (state.total / state.goal) * 100;
    const curIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    const curB = BOSS_BEATS[curIdx] || BOSS_BEATS[0];
    const nxtB = BOSS_BEATS[curIdx + 1] || { pct: 100, name: 'The End' };
    const beatSpan = nxtB.pct - curB.pct;
    const progressInBeat = progress - curB.pct;
    const hp = Math.max(0, 100 - (progressInBeat / (beatSpan || 1) * 100));

    document.getElementById('wcMain').innerText = state.total.toLocaleString();
    document.getElementById('wipDisplay').innerText = state.title;
    document.getElementById('lvlName').innerText = `STAGE ${curIdx + 1} — ${curB.name.toUpperCase()}`;
    document.getElementById('bossName').innerText = nxtB.name.toUpperCase();
    document.getElementById('bossHPBar').style.width = hp + '%';
    document.getElementById('hpBar').style.width = Math.min(100, progress) + '%';
    document.getElementById('hpText').innerText = state.total.toLocaleString() + ' / ' + state.goal.toLocaleString();
    document.getElementById('loreBox').innerText = curB.lore;
    document.getElementById('tipsBox').innerText = MICRO_TIPS[Math.min(100, Math.floor(progress))];
    if (window.updateSidebar) window.updateSidebar();
    if (window.updateGame) window.updateGame();
    document.getElementById('buddyCountDisplay').innerText = state.inventory.length;
    document.getElementById('buddyGallery').innerHTML = state.inventory.map(i =>
        `<img src="buddies/${i}" class="buddy-relic" onclick="showBuddyZoom('buddies/${i}')">`
    ).join('');

    const sprite = document.getElementById('bossSprite');
    const scaleFactor = 0.3 + (hp / 100) * 0.7;
    sprite.style.transform = `scale(${scaleFactor})`;
    sprite.src = window.getBossImgSrc(curIdx + 1);
    sprite.onerror = () => sprite.style.visibility = 'hidden';
    sprite.onload  = () => sprite.style.visibility = 'visible';

    // Show project count indicator if more than one project
    const projects = Object.keys(dpData.projects || {});
    const projCount = document.getElementById('projectCountLabel');
    if (projCount) projCount.textContent = projects.length > 1 ? projects.length + ' PROJECTS' : '';

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
    document.getElementById('bossZoomSprite').src = window.getBossImgSrc(curBeatIdx + 1);
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
        container.innerHTML = '<div style="opacity:0.5;font-size:0.8rem;padding:10px 0;">No projects found.</div>';
    } else {
        container.innerHTML = ids.map(id => {
            const p       = projects[id];
            const isActive = id === activeId;
            return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:10px;
                         border:1px solid ${isActive ? 'var(--neon)' : 'var(--border)'};box-sizing:border-box;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:900;font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.title || 'UNTITLED'}</div>
                    <div style="font-size:0.7rem;opacity:0.5;">${(p.total || 0).toLocaleString()} / ${(p.goal || 0).toLocaleString()} WORDS</div>
                </div>
                ${isActive
                    ? '<span style="font-size:0.65rem;color:var(--neon);white-space:nowrap;">ACTIVE</span>'
                    : `<button onclick="switchProject('${id}')" style="font-size:0.65rem;padding:5px 9px;white-space:nowrap;">SWITCH</button>
                       <button onclick="deleteProject('${id}')" style="font-size:0.65rem;padding:5px 9px;background:#333;white-space:nowrap;">✕</button>`
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
    updateUI();
    initGraph();
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
function runSplash(then) {
    const splash = document.getElementById('splashScreen');
    // Only show once per browser session
    if (!splash || sessionStorage.getItem('splashSeen')) {
        if (splash) splash.style.display = 'none';
        then();
        return;
    }
    sessionStorage.setItem('splashSeen', '1');

    splash.classList.add('splash-visible');

    // Attempt sound immediately; browser may block until user gesture
    if (window.SFX) {
        try { SFX.intro(); } catch(e) {}
    }

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
    if (!isStandalone) {
        document.querySelectorAll('.install-btn').forEach(b => b.classList.remove('hidden'));
    }

    const nav = document.querySelector('.app-nav');
    runSplash(function () {
        if (localStorage.getItem('justSignedOut')) {
            localStorage.removeItem('justSignedOut');
            history.replaceState({}, '', 'index.html');
            document.getElementById('authScreen').style.display = 'flex';
            document.getElementById('setup').style.display = 'none';
            document.getElementById('mainDashboard').classList.add('hidden');
            if (nav) nav.style.display = 'none';
            return;
        }

        const hasActive = activeId && dpData.projects && dpData.projects[activeId] && dpData.projects[activeId].active;

        if (hasActive) {
            window.showDashboard();
        } else if (localStorage.getItem('authDecisionMade')) {
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
