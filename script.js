import { CONFIG } from './data.js';

let chart;
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, name: "", genre: "urbanFantasy", goal: 80000, total: 0, 
    gold: 0, xp: 0, logs: [], stcMode: false, deadline: ""
};

// Map genre to button names
const genreBtnNames = {
    fantasy: "SCROLL OF GUIDANCE",
    sciFi: "DATA UPLINK",
    urbanFantasy: "STREET SMARTS",
    thriller: "INTELLIGENCE BRIEF",
    horror: "FORBIDDEN LORE",
    romance: "HEART'S ADVICE",
    crime: "CASE FILES"
};

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
    document.getElementById('stcBtn').innerText = genreBtnNames[state.genre] || "STORY BEAT TIPS";
    initGraph();
    updateUI();
}

window.addWords = () => {
    const val = parseInt(document.getElementById('wordIn').value) || 0;
    if (val <= 0) return;

    const combat = document.getElementById('combatLog');
    combat.innerText = `WORD HIT: +${val} XP`;
    combat.classList.add('pulse');
    setTimeout(() => combat.classList.remove('pulse'), 500);

    state.total += val;
    state.xp += val;
    state.gold += Math.floor(val / 10);
    
    const today = new Date().toISOString().split('T')[0];
    state.logs.push({ date: today, total: state.total });

    document.getElementById('wordIn').value = "";
    save();
    updateUI();
    updateGraph();
};

window.triggerInspiration = () => {
    const msg = CONFIG.inspiration[Math.floor(Math.random() * CONFIG.inspiration.length)];
    const panel = document.getElementById('inspirationPanel');
    panel.innerText = msg;
    panel.style.display = 'block';
    // Shake effect for "Inspiration"
    panel.classList.add('pulse');
    setTimeout(() => {
        panel.style.display = 'none';
        panel.classList.remove('pulse');
    }, 8000);
};

function initGraph() {
    const ctx = document.getElementById('velocityChart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: state.logs.map(l => l.date),
            datasets: [{
                label: 'Words Written',
                data: state.logs.map(l => l.total),
                borderColor: '#00ffff',
                backgroundColor: 'rgba(0, 255, 255, 0.1)',
                borderWidth: 2,
                tension: 0.3,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { 
                y: { beginAtZero: true, grid: { color: '#222' }, ticks: { color: '#00ffff' } },
                x: { grid: { display: false }, ticks: { color: '#00ffff' } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function updateGraph() {
    if(!chart) return;
    chart.data.labels = state.logs.map(l => l.date);
    chart.data.datasets[0].data = state.logs.map(l => l.total);
    chart.update();
}

window.toggleSTC = () => {
    state.stcMode = !state.stcMode;
    save();
    updateUI();
};

function updateUI() {
    const progress = (state.total / state.goal) * 100;
    let currentData = [...CONFIG.checkpoints].reverse().find(c => progress >= c.pct) || CONFIG.checkpoints[0];
    const index = CONFIG.checkpoints.indexOf(currentData);
    const currentBoss = CONFIG.genreBosses[state.genre][index] || "The Abyss";

    document.getElementById('beatName').innerText = currentData.name;
    document.getElementById('bossName').innerText = `Current Location: ${currentBoss}`;
    document.getElementById('hpBar').style.width = `${Math.min(progress, 100)}%`;
    document.getElementById('hpText').innerText = `${state.total.toLocaleString()} / ${state.goal.toLocaleString()} WORDS`;
    document.getElementById('goldVal').innerText = state.gold;
    document.getElementById('xpVal').innerText = state.xp;

    const stc = document.getElementById('stcAnalysis');
    if (state.stcMode) {
        stc.classList.remove('hidden');
        document.getElementById('stcList').innerHTML = currentData.tasks
            .map(t => `<div class='check-item'><input type='checkbox'> <span><strong>${t.label}:</strong> ${t.desc}</span></div>`).join('');
    } else { stc.classList.add('hidden'); }
}

function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }
window.resetGame = () => { if(confirm("WIPE SYSTEM? ALL DATA WILL BE LOST.")) { localStorage.clear(); location.reload(); }};
