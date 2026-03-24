let chart;
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, title: "", goal: 80000, total: 0, genre: "urbanFantasy",
    logs: [], lastLevel: 0, deadline: "", inventory: [] 
};

const GENRE_STYLES = {
    urbanFantasy: "#0ff", sciFi: "#0fa", fantasy: "#ffd700", horror: "#f00",
    cyberpunk: "#f0f", crimeNoir: "#708090", romance: "#ff69b4"
};

function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }

window.start = function() {
    state.title = document.getElementById('titleIn').value.toUpperCase() || "PROJECT";
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
        document.getElementById('bossBeatTitle').innerText = BOSS_BEATS[newIdx].name.toUpperCase();
        document.getElementById('levelOverlay').style.display = 'flex';
    }
    save(); updateUI(); updateGraph();
    document.getElementById('wordIn').value = "";
};

function updateUI() {
    if (typeof BOSS_BEATS === 'undefined') return;
    const progress = (state.total / state.goal) * 100;
    const curIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    const curB = BOSS_BEATS[curIdx] || BOSS_BEATS[0];
    const nxtB = BOSS_BEATS[curIdx+1] || {pct: 100, name: "THE END"};
    
    const beatSpan = nxtB.pct - curB.pct;
    const progressInBeat = progress - curB.pct;
    const hp = Math.max(0, 100 - (progressInBeat / (beatSpan || 1) * 100));

    // Update Text Elements
    document.getElementById('wipDisplay').innerText = state.title;
    document.getElementById('lvlName').innerText = `BEAT ${curIdx + 1}: ${curB.name.toUpperCase()}`;
    document.getElementById('bossName').innerText = nxtB.name.toUpperCase();
    document.getElementById('hpBar').style.width = Math.min(100, progress) + "%";
    document.getElementById('bossHPBar').style.width = hp + "%";
    document.getElementById('hpText').innerText = `${state.total.toLocaleString()} / ${state.goal.toLocaleString()}`;
    document.getElementById('loreBox').innerText = curB.lore;
    document.getElementById('tipsBox').innerText = MICRO_TIPS[Math.min(100, Math.floor(progress))];
    document.getElementById('sideRankName').innerText = RANKS[curIdx].toUpperCase();

    // Image logic
    const sprite = document.getElementById('bossSprite');
    const suffix = hp <= 25 ? 'd' : hp <= 50 ? 'c' : hp <= 75 ? 'b' : 'a';
    sprite.src = `bosses/${curIdx + 1}${suffix}.png`;
    sprite.onerror = () => sprite.style.display = 'none';
    sprite.onload = () => sprite.style.display = 'block';

    if (state.deadline) {
        const days = Math.ceil((new Date(state.deadline) - new Date()) / (1000 * 60 * 60 * 24));
        document.getElementById('daysLeftDisplay').innerText = days > 0 ? days : "0";
    }

    // Apply Genre Color
    document.documentElement.style.setProperty('--neon-primary', GENRE_STYLES[state.genre]);
}

function initGraph() {
    const canvas = document.getElementById('velocityChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (chart) chart.destroy();
    chart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: state.logs.map(l => l.date),
            datasets: [{ 
                data: state.logs.map(l => l.total), 
                borderColor: GENRE_STYLES[state.genre], 
                backgroundColor: 'rgba(0, 255, 255, 0.1)',
                tension: 0.3, 
                fill: true 
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { ticks: { color: '#0ff', font: { family: 'monospace' } } } }
        }
    });
}

function updateGraph() { if(chart) { chart.data.labels = state.logs.map(l => l.date); chart.data.datasets[0].data = state.logs.map(l => l.total); chart.update(); } }
window.showGrenade = function() { document.getElementById('inspireText').innerText = GRENADES[Math.floor(Math.random() * GRENADES.length)]; document.getElementById('grenadeOverlay').style.display = 'flex'; };
window.closeGrenade = function() { document.getElementById('grenadeOverlay').style.display = 'none'; };
window.closeOverlay = function() { document.getElementById('levelOverlay').style.display = 'none'; };
window.resetGame = function() { if(confirm("PURGE SYSTEM DATA?")) { localStorage.clear(); location.reload(); }};

window.onload = function() {
    if (state.active) {
        document.getElementById('setup').style.display = 'none';
        document.getElementById('mainDashboard').style.display = 'flex';
        updateUI(); 
        initGraph();
    }
};
