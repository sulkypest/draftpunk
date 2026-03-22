import { CONFIG } from './data.js';

let chart;
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, genre: "urbanFantasy", goal: 80000, total: 0, 
    gold: 0, xp: 0, logs: [], lastLevel: 0, deadline: ""
};

const STC_BEATS = [
    { pct: 0, name: "Opening Image" }, { pct: 1, name: "Theme Stated" }, { pct: 10, name: "Setup" },
    { pct: 12, name: "The Catalyst" }, { pct: 20, name: "The Debate" }, { pct: 25, name: "Break into Two" },
    { pct: 30, name: "B Story" }, { pct: 35, name: "Fun & Games" }, { pct: 50, name: "The Midpoint" },
    { pct: 65, name: "Bad Guys Close In" }, { pct: 75, name: "All Is Lost" }, { pct: 80, name: "Dark Night" },
    { pct: 85, name: "Break into Three" }, { pct: 90, name: "The Finale" }, { pct: 100, name: "Final Image" }
];

window.onload = () => { if (state.active) showGame(); };

window.startQuest = () => {
    state.genre = document.getElementById('genreIn').value;
    state.goal = parseInt(document.getElementById('goalIn').value);
    state.deadline = document.getElementById('deadlineIn').value;
    state.active = true;
    state.logs = [{ date: new Date().toISOString().split('T')[0], total: 0 }];
    save();
    showGame();
};

function showGame() {
    document.body.className = `skin-${state.genre}`;
    document.getElementById('setup').classList.add('hidden');
    document.getElementById('game').classList.remove('hidden');
    initGraph();
    updateUI();
}

window.addWords = () => {
    const val = parseInt(document.getElementById('wordIn').value) || 0;
    if (val <= 0) return;

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
    const overlay = document.getElementById('levelOverlay');
    document.getElementById('newLevelName').innerText = levelName;
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.add('hidden'), 3500);
}

function initGraph() {
    const ctx = document.getElementById('velocityChart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: state.logs.map(l => l.date),
            datasets: [
                { label: 'Your Progress', data: state.logs.map(l => l.total), borderColor: 'white', borderWidth: 3, tension: 0.3, pointRadius: 4 },
                { label: 'Target Progress', data: getTargetData(), borderColor: 'rgba(255,255,255,0.2)', borderDash: [10,5], pointRadius: 0 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, labels: { color: '#ccc' } } } }
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
    const nextSTC = STC_BEATS[stcIndex + 1] || { pct: 100, name: "Victory" };
    
    const bossHP = Math.max(0, 100 - ((progress - currentSTC.pct) / (nextSTC.pct - currentSTC.pct) * 100));
    const loreIndex = CONFIG.checkpoints.findLastIndex(c => progress >= c.pct);
    const loreData = CONFIG.checkpoints[loreIndex === -1 ? 0 : loreIndex];
    const currentLore = CONFIG.genreBosses[state.genre][loreIndex === -1 ? 0 : loreIndex] || "The Abyss";

    document.getElementById('lvlName').innerText = `STAGE: ${currentSTC.name}`;
    document.getElementById('loreText').innerText = `CURRENT LORE: ${currentLore}`;
    document.getElementById('bossName').innerText = `BOSS: ${nextSTC.name}`;
    document.getElementById('bossHPBar').style.width = bossHP + "%";
    document.getElementById('bossHPText').innerText = `HP: ${Math.floor(bossHP)}%`;
    document.getElementById('hpBar').style.width = Math.min(100, progress) + "%";
    document.getElementById('hpText').innerText = `${state.total.toLocaleString()} / ${state.goal.toLocaleString()} WORDS`;
    document.getElementById('goldVal').innerText = state.gold;
    document.getElementById('xpVal').innerText = state.xp;

    document.getElementById('stcList').innerHTML = loreData.tasks
        .map(t => `<div class='check-item'><input type='checkbox'><span><strong>${t.label}</strong>: ${t.desc}</span></div>`).join('');
}

function updateGraph() { if(chart) { chart.data.labels = state.logs.map(l => l.date); chart.data.datasets[0].data = state.logs.map(l => l.total); chart.data.datasets[1].data = getTargetData(); chart.update(); } }
function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }
window.resetGame = () => { if(confirm("WIPE SYSTEM?")) { localStorage.clear(); location.reload(); }};
