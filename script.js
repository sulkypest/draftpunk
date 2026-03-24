// script.js - THE LOGIC ENGINE
let chart;
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, title: "", goal: 80000, total: 0, genre: "urbanFantasy",
    logs: [], lastLevel: 0, deadline: "", inventory: [] 
};

const GENRE_STYLES = {
    urbanFantasy: "#0ff", sciFi: "#0fa", fantasy: "#ffd700", horror: "#ff0000",
    cyberpunk: "#f0f", crimeNoir: "#708090", romance: "#ff69b4", thriller: "#ffa500", western: "#cd7f32"
};

function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }

window.start = function() {
    state.title = document.getElementById('titleIn').value || "PROJECT";
    state.goal = parseInt(document.getElementById('goalIn').value) || 80000;
    state.deadline = document.getElementById('deadlineIn').value;
    state.genre = document.getElementById('genreIn').value;
    state.active = true;
    state.total = 0;
    state.logs = [{ date: new Date().toLocaleDateString(), total: 0 }];
    save();
    location.reload(); 
};

window.addWords = function() {
    const val = parseInt(document.getElementById('wordIn').value) || 0;
    if (val <= 0) return;
    state.total += val;
    state.logs.push({ date: new Date().toLocaleDateString(), total: state.total });
    const progress = (state.total / state.goal) * 100;
    const newIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    
    if (newIdx > state.lastLevel) {
        state.lastLevel = newIdx;
        if(document.getElementById('bossBeatTitle')) document.getElementById('bossBeatTitle').innerText = BOSS_BEATS[newIdx].name;
        document.getElementById('levelOverlay').style.display = 'flex';
    }
    save(); updateUI(); updateGraph();
    document.getElementById('wordIn').value = "";
};

function updateUI() {
    try {
        const color = GENRE_STYLES[state.genre] || "#0ff";
        document.documentElement.style.setProperty('--neon', color);
        const progress = (state.total / state.goal) * 100;
        const curIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
        const curB = BOSS_BEATS[curIdx] || BOSS_BEATS[0];
        const nxtB = BOSS_BEATS[curIdx+1] || {pct: 100, name: "The End"};
        
        const beatSpan = nxtB.pct - curB.pct;
        const progressInBeat = progress - curB.pct;
        const hp = Math.max(0, 100 - (progressInBeat / (beatSpan || 1) * 100));

        if(document.getElementById('wipDisplay')) document.getElementById('wipDisplay').innerText = state.title;
        if(document.getElementById('lvlName')) document.getElementById('lvlName').innerText = "BEAT " + (curIdx + 1) + ": " + curB.name;
        if(document.getElementById('bossName')) document.getElementById('bossName').innerText = nxtB.name;
        if(document.getElementById('hpBar')) document.getElementById('hpBar').style.width = Math.min(100, progress) + "%";
        if(document.getElementById('bossHPBar')) document.getElementById('bossHPBar').style.width = hp + "%";
        if(document.getElementById('hpText')) document.getElementById('hpText').innerText = state.total.toLocaleString() + " / " + state.goal.toLocaleString();
        if(document.getElementById('loreBox')) document.getElementById('loreBox').innerText = curB.lore;
        
        const tipIndex = Math.min(100, Math.floor(progress));
        if(document.getElementById('tipsBox')) document.getElementById('tipsBox').innerText = MICRO_TIPS[tipIndex];
        if(document.getElementById('sideRankName')) document.getElementById('sideRankName').innerText = (RANKS[curIdx] || "THE SCRIBE-ANATOR").toUpperCase();

        const sprite = document.getElementById('bossSprite');
        if(sprite) {
            const suffix = hp <= 25 ? 'd' : hp <= 50 ? 'c' : hp <= 75 ? 'b' : 'a';
            sprite.src = `bosses/${curIdx + 1}${suffix}.png`;
            sprite.onerror = () => { sprite.style.display = 'none'; };
            sprite.onload = () => { sprite.style.display = 'block'; };
        }
    } catch (e) { console.error("UI Update failed:", e); }
}

function initGraph() {
    const canvas = document.getElementById('velocityChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: state.logs.map(l => l.date),
            datasets: [{ data: state.logs.map(l => l.total), borderColor: GENRE_STYLES[state.genre], tension: 0.2, fill: false }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
}

function updateGraph() { if(chart) { chart.data.labels = state.logs.map(l => l.date); chart.data.datasets[0].data = state.logs.map(l => l.total); chart.update(); } }

window.showGrenade = function() {
    const insp = document.getElementById('inspireText');
    if(insp) insp.innerText = GRENADES[Math.floor(Math.random() * GRENADES.length)];
    document.getElementById('grenadeOverlay').style.display = 'flex';
};

window.closeGrenade = function() { document.getElementById('grenadeOverlay').style.display = 'none'; };
window.closeOverlay = function() { document.getElementById('levelOverlay').style.display = 'none'; };
window.resetGame = function() { if(confirm("Clear all data?")) { localStorage.clear(); location.reload(); }};

window.onload = function() {
    if (state.active) {
        document.getElementById('setup').style.display = 'none';
        document.getElementById('mainDashboard').style.display = 'flex';
        updateUI(); initGraph();
    } else {
        document.getElementById('setup').style.display = 'block';
        document.getElementById('mainDashboard').style.display = 'none';
    }
};
