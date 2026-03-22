import { CONFIG } from './data.js';

let chart;
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, genre: "urbanFantasy", goal: 80000, total: 0, 
    gold: 0, xp: 0, logs: [], lastLevel: 0, stcMode: false, deadline: ""
};

const STC_BEATS = [
    { pct: 0, name: "Opening Image" }, { pct: 1, name: "Theme Stated" }, { pct: 10, name: "Setup" },
    { pct: 12, name: "The Catalyst" }, { pct: 20, name: "The Debate" }, { pct: 25, name: "Break into Two" },
    { pct: 30, name: "B Story" }, { pct: 35, name: "Fun & Games" }, { pct: 50, name: "The Midpoint" },
    { pct: 65, name: "Bad Guys Close In" }, { pct: 75, name: "All Is Lost" }, { pct: 80, name: "Dark Night" },
    { pct: 85, name: "Break into Three" }, { pct: 90, name: "The Finale" }, { pct: 100, name: "Final Image" }
];

const genreBtnNames = {
    fantasy: "SCROLL OF GUIDANCE", sciFi: "DATA UPLINK", urbanFantasy: "STREET SMARTS",
    thriller: "INTEL BRIEF", horror: "FORBIDDEN LORE", romance: "HEART'S ADVICE", crime: "CASE FILES"
};

window.onload = () => { if (state.active) showGame(); };

// AUDIO ENGINE
function playVictorySound() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [261, 329, 392, 523].forEach((f, i) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.frequency.value = f; g.gain.setValueAtTime(0.1, ctx.currentTime + i*0.1);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i*0.1 + 0.1);
        o.connect(g); g.connect(ctx.destination);
        o.start(ctx.currentTime + i*0.1); o.stop(ctx.currentTime + i*0.1 + 0.1);
    });
}

window.startQuest = () => {
    state.genre = document.getElementById('genreIn').value;
    state.goal = parseInt(document.getElementById('goalIn').value) || 80000;
    state.deadline = document.getElementById('deadlineIn').value;
    state.active = true;
    state.logs = [{ date: new Date().toISOString().split('T')[0], total: 0 }];
    save();
    showGame();
};

function showGame() {
    document.getElementById('setup').classList.add('hidden');
    document.getElementById('game').classList.remove('hidden');
    document.getElementById('stcBtn').innerText = genreBtnNames[state.genre] || "STORY TIPS";
    initGraph();
    updateUI();
}

window.addWords = () => {
    const val = parseInt(document.getElementById('wordIn').value) || 0;
    if (val <= 0) return;

    document.querySelector('.app').classList.add('shake');
    setTimeout(() => document.querySelector('.app').classList.remove('shake'), 400);

    state.total += val;
    state.xp += val;
    state.gold += Math.floor(val / 5);
    state.logs.push({ date: new Date().toISOString().split('T')[0], total: state.total });
    
    const progress = (state.total / state.goal * 100);
    const currentSTCIndex = STC_BEATS.findLastIndex(b => progress >= b.pct);
    
    if (currentSTCIndex > state.lastLevel) {
        state.lastLevel = currentSTCIndex;
        triggerLevelUp(STC_BEATS[currentSTCIndex].name);
    }

    document.getElementById('wordIn').value = "";
    save();
    updateUI();
    updateGraph();
};

function triggerLevelUp(levelName) {
    playVictorySound();
    const overlay = document.getElementById('levelOverlay');
    document.getElementById('newLevelName').innerText = levelName;
    overlay.classList.remove('hidden');
    state.gold += 500; 
    setTimeout(() => overlay.classList.add('hidden'), 3500);
}

window.toggleSTC = () => { state.stcMode = !state.stcMode; save(); updateUI(); };

window.triggerInspiration = () => {
    const p = document.getElementById('inspirationPanel');
    p.innerText = CONFIG.inspiration[Math.floor(Math.random() * CONFIG.inspiration.length)];
    p.style.display = 'block';
    setTimeout(() => p.style.display = 'none', 6000);
};

function initGraph() {
    const ctx = document.getElementById('velocityChart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: state.logs.map(l => l.date),
            datasets: [
                { label: 'Your Progress', data: state.logs.map(l => l.total), borderColor: '#00ffff', borderWidth: 2, tension: 0.3, pointRadius: 0 },
                { label: 'Target Progress', data: getTargetData(), borderColor: 'rgba(255,255,255,0.1)', borderDash: [5,5], pointRadius: 0 }
            ]
        },
        options: { 
            responsive: true, maintainAspectRatio: false, 
            plugins: { legend: { display: true, labels: { color: '#555', font: { size: 9 } } } },
            scales: { x: { display: false }, y: { beginAtZero: true, grid: { color: '#111' }, ticks: { color: '#444' } } }
        }
    });
}

function getTargetData() {
    if (!state.deadline) return [];
    const start = new Date(state.logs[0].date);
    const end = new Date(state.deadline);
    const days = Math.max(1, Math.ceil((end - start) / 86400000));
    const rate = state.goal / days;
    return state.logs.map(l => {
        const elapsed = Math.ceil((new Date(l.date) - start) / 86400000);
        return Math.floor(elapsed * rate);
    });
}

function updateUI() {
    const progress = (state.total / state.goal) * 100;
    const stcIndex = STC_BEATS.findLastIndex(b => progress >= b.pct);
    const currentSTC = STC_BEATS[stcIndex] || STC_BEATS[0];
    const nextSTC = STC_BEATS[stcIndex + 1] || { pct: 100, name: "The End" };
    
    const bossHP = Math.max(0, 100 - ((progress - currentSTC.pct) / (nextSTC.pct - currentSTC.pct) * 100));
    const loreIndex = CONFIG.checkpoints.findLastIndex(c => progress >= c.pct);
    const loreData = CONFIG.checkpoints[loreIndex === -1 ? 0 : loreIndex];
    const currentLore = CONFIG.genreBosses[state.genre][loreIndex === -1 ? 0 : loreIndex] || "The Abyss";

    // Visual Updates
    document.getElementById('lvlName').innerText = `STAGE: ${currentSTC.name}`;
    document.getElementById('loreText').innerText = `LORE: ${currentLore}`;
    document.getElementById('bossName').innerText = `BOSS: ${nextSTC.name}`;
    document.getElementById('bossHPBar').style.width = bossHP + "%";
    document.getElementById('bossHPText').innerText = `HP: ${Math.floor(bossHP)}%`;
    document.getElementById('hpBar').style.width = Math.min(100, progress) + "%";
    document.getElementById('hpText').innerText = `${state.total.toLocaleString()} / ${state.goal.toLocaleString()} WORDS`;
    document.getElementById('goldVal').innerText = state.gold;
    document.getElementById('xpVal').innerText = state.xp;

    const sprite = document.getElementById('bossSprite');
    sprite.style.borderRadius = `${stcIndex * 6}%`;
    sprite.style.filter = `hue-rotate(${stcIndex * 24}deg) brightness(1.2)`;

    const stc = document.getElementById('stcAnalysis');
    if (state.stcMode) {
        stc.classList.remove('hidden');
        document.getElementById('stcList').innerHTML = loreData.tasks
            .map(t => `<div class='check-item'><input type='checkbox'><span><strong>${t.label}</strong>: ${t.desc}</span></div>`).join('');
    } else { stc.classList.add('hidden'); }
}

function updateGraph() { if(chart) { chart.data.labels = state.logs.map(l => l.date); chart.data.datasets[0].data = state.logs.map(l => l.total); chart.data.datasets[1].data = getTargetData(); chart.update(); } }
function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }
window.resetGame = () => { if(confirm("WIPE SYSTEM?")) { localStorage.clear(); location.reload(); }};
