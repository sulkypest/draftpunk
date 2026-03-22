import { CONFIG } from './data.js';

let chart; // Variable for the graph
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, name: "", genre: "urbanFantasy", goal: 80000, total: 0, 
    gold: 0, xp: 0, history: [], stcMode: false,
    deadline: "", logs: [] 
};

window.onload = () => { if (state.active) showGame(); };

window.startQuest = () => {
    state.name = document.getElementById('nameIn').value || "Author";
    state.genre = document.getElementById('genreIn').value;
    state.goal = parseInt(document.getElementById('goalIn').value) || 80000;
    state.deadline = document.getElementById('deadlineIn').value || new Date(Date.now() + 7776000000).toISOString().split('T')[0];
    state.active = true;
    state.logs = [{ date: new Date().toISOString().split('T')[0], total: 0 }];
    save();
    showGame();
};

function showGame() {
    document.getElementById('setup').classList.add('hidden');
    document.getElementById('game').classList.remove('hidden');
    updateUI();
    initGraph();
}

window.addWords = () => {
    const val = parseInt(document.getElementById('wordIn').value) || 0;
    if (val <= 0) return;

    // Gamification Feed
    const combat = document.getElementById('combatLog');
    combat.innerText = `CRITICAL HIT: +${val} WORDS`;
    combat.classList.add('pulse');
    setTimeout(() => combat.classList.remove('pulse'), 500);

    state.total += val;
    state.xp += val;
    state.gold += Math.floor(val / 10);
    
    // Log for graph
    const today = new Date().toISOString().split('T')[0];
    state.logs.push({ date: today, total: state.total });

    // Inspiration Engine (15% chance)
    if (Math.random() < 0.15) triggerInspiration();

    document.getElementById('wordIn').value = "";
    save();
    updateUI();
    updateGraph();
};

function triggerInspiration() {
    const msg = CONFIG.inspiration[Math.floor(Math.random() * CONFIG.inspiration.length)];
    const panel = document.getElementById('inspirationPanel');
    panel.innerText = msg;
    panel.style.display = 'block';
    setTimeout(() => panel.style.display = 'none', 7000);
}

function initGraph() {
    const ctx = document.getElementById('velocityChart').getContext('2d');
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: state.logs.map(l => l.date),
            datasets: [{
                label: 'Actual Progress',
                data: state.logs.map(l => l.total),
                borderColor: '#ff00ff',
                backgroundColor: 'rgba(255, 0, 255, 0.1)',
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, grid: { color: '#333' } }, x: { grid: { display: false } } },
            plugins: { legend: { display: false } }
        }
    });
}

function updateGraph() {
    chart.data.labels = state.logs.map(l => l.date);
    chart.data.datasets[0].data = state.logs.map(l => l.total);
    chart.update();
}

window.toggleSTC = () => { state.stcMode = !state.stcMode; save(); updateUI(); };

function updateUI() {
    const progress = (state.total / state.goal) * 100;
    let currentData = [...CONFIG.checkpoints].reverse().find(c => progress >= c.pct) || CONFIG.checkpoints[0];
    const index = CONFIG.checkpoints.indexOf(currentData);
    const currentBoss = CONFIG.genreBosses[state.genre][index] || "The Abyss";

    document.getElementById('beatName').innerText = currentData.name;
    document.getElementById('bossName').innerText = `Milestone: ${currentBoss}`;
    document.getElementById('hpBar').style.width = `${Math.min(progress, 100)}%`;
    document.getElementById('hpText').innerText = `${state.total.toLocaleString()} / ${state.goal.toLocaleString()} WORDS`;
    document.getElementById('goldVal').innerText = state.gold;
    document.getElementById('xpVal').innerText = state.xp;

    if (state.stcMode) {
        document.getElementById('stcAnalysis').classList.remove('hidden');
        document.getElementById('stcList').innerHTML = currentData.tasks
            .map(t => `<div class='check-item'><input type='checkbox'> ${t}</div>`).join('');
    } else { document.getElementById('stcAnalysis').classList.add('hidden'); }
}

function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }
window.resetGame = () => { if(confirm("WIPE SYSTEM? ALL DATA WILL BE LOST.")) { localStorage.clear(); location.reload(); }};
