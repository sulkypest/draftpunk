import { CONFIG } from './data.js';

let chart;
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, name: "", genre: "urbanFantasy", goal: 80000, total: 0, 
    gold: 0, xp: 0, logs: [], stcMode: false, deadline: ""
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
    state.name = document.getElementById('nameIn').value || "Author";
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
    initGraph();
    updateUI();
}

window.addWords = () => {
    const val = parseInt(document.getElementById('wordIn').value) || 0;
    if (val <= 0) return;
    state.total += val;
    state.xp += val;
    state.logs.push({ date: new Date().toISOString().split('T')[0], total: state.total });
    document.getElementById('wordIn').value = "";
    save();
    updateUI();
    updateGraph();
};

function initGraph() {
    const ctx = document.getElementById('velocityChart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: state.logs.map(l => l.date),
            datasets: [
                { label: 'Your Progress', data: state.logs.map(l => l.total), borderColor: '#00ffff', borderWidth: 2, tension: 0.3 },
                { label: 'Target Progress', data: getTargetData(), borderColor: 'rgba(255,255,255,0.2)', borderDash: [5,5] }
            ]
        },
        options: { 
            responsive: true, maintainAspectRatio: false, 
            plugins: { legend: { display: true, labels: { color: '#fff', size: 10, boxWidth: 10 } } },
            scales: { x: { display: false }, y: { beginAtZero: true, grid: { color: '#222' } } }
        }
    });
}

function getTargetData() {
    if (!state.deadline) return [];
    const start = new Date(state.logs[0].date);
    const end = new Date(state.deadline);
    const totalDays = Math.ceil((end - start) / 86400000) || 1;
    const dailyRate = state.goal / totalDays;
    return state.logs.map(l => {
        const elapsed = Math.ceil((new Date(l.date) - start) / 86400000);
        return Math.floor(elapsed * dailyRate);
    });
}

function updateUI() {
    const progress = (state.total / state.goal) * 100;
    
    // 1. SAVE THE CAT LEVELS (The "Bosses")
    const stcIndex = STC_BEATS.findLastIndex(b => progress >= b.pct);
    const currentSTC = STC_BEATS[stcIndex] || STC_BEATS[0];
    const nextSTC = STC_BEATS[stcIndex + 1] || { pct: 100, name: "Victory" };
    
    // Boss HP is progress toward the next Level Up
    const bossRange = nextSTC.pct - currentSTC.pct;
    const bossProgress = progress - currentSTC.pct;
    const bossHP = Math.max(0, 100 - (bossProgress / bossRange * 100));

    // 2. MICRO-MILESTONES (The "Lore")
    const loreIndex = [...CONFIG.checkpoints].reverse().findLastIndex(c => progress >= c.pct);
    const currentLore = CONFIG.genreBosses[state.genre][loreIndex] || "The Unknown";

    // Update DOM
    document.getElementById('lvlName').innerText = `LEVEL: ${currentSTC.name}`;
    document.getElementById('bossName').innerText = `BOSS: ${nextSTC.name}`;
    document.getElementById('bossHPBar').style.width = bossHP + "%";
    document.getElementById('bossHPText').innerText = `HP: ${Math.floor(bossHP)}%`;
    
    document.getElementById('loreText').innerText = `LOCATION: ${currentLore}`;
    document.getElementById('hpBar').style.width = progress + "%";
    document.getElementById('hpText').innerText = `${state.total.toLocaleString()} / ${state.goal.toLocaleString()} TOTAL WORDS`;
}

function updateGraph() { if(chart) { chart.data.labels = state.logs.map(l => l.date); chart.data.datasets[0].data = state.logs.map(l => l.total); chart.data.datasets[1].data = getTargetData(); chart.update(); } }
function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }
window.resetGame = () => { if(confirm("WIPE DATA?")) { localStorage.clear(); location.reload(); }};
