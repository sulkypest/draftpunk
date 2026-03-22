import { CONFIG } from './data.js';

let chart;
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, name: "", genre: "urbanFantasy", goal: 80000, total: 0, 
    gold: 0, xp: 0, logs: [], stcMode: false, deadline: ""
};

const genreBtnNames = {
    fantasy: "SCROLL OF GUIDANCE", sciFi: "DATA UPLINK", urbanFantasy: "STREET SMARTS",
    thriller: "INTELLIGENCE BRIEF", horror: "FORBIDDEN LORE", romance: "HEART'S ADVICE", crime: "CASE FILES"
};

window.onload = () => { if (state.active) showGame(); };

window.startQuest = () => {
    state.name = document.getElementById('nameIn').value || "Author";
    state.genre = document.getElementById('genreIn').value;
    state.goal = parseInt(document.getElementById('goalIn').value) || 80000;
    state.deadline = document.getElementById('deadlineIn').value;
    state.active = true;
    // Set start date log
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
    combat.innerText = `HIT LANDED! -${val} BOSS HP`;
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

function getIdealData() {
    if (!state.deadline) return [];
    const start = new Date(state.logs[0].date);
    const end = new Date(state.deadline);
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) || 1;
    const wordsPerDay = state.goal / totalDays;

    return state.logs.map((log, index) => {
        const currentDay = Math.ceil((new Date(log.date) - start) / (1000 * 60 * 60 * 24));
        return Math.min(state.goal, Math.floor(currentDay * wordsPerDay));
    });
}

function initGraph() {
    const ctx = document.getElementById('velocityChart').getContext('2d');
    if (chart) chart.destroy();
    
    const idealPath = getIdealData();

    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: state.logs.map(l => l.date),
            datasets: [
                {
                    label: 'Actual',
                    data: state.logs.map(l => l.total),
                    borderColor: '#00ffff',
                    borderWidth: 3,
                    tension: 0.3,
                    fill: false
                },
                {
                    label: 'Target Path',
                    data: idealPath,
                    borderColor: 'rgba(255, 255, 255, 0.2)',
                    borderDash: [5, 5],
                    borderWidth: 1,
                    pointRadius: 0,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { 
                y: { grid: { color: '#222' }, ticks: { color: '#555', font: { size: 9 } } },
                x: { ticks: { display: false }, grid: { display: false } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function updateGraph() {
    if(!chart) return;
    chart.data.labels = state.logs.map(l => l.date);
    chart.data.datasets[0].data = state.logs.map(l => l.total);
    chart.data.datasets[1].data = getIdealData();
    chart.update();
}

window.toggleSTC = () => { state.stcMode = !state.stcMode; save(); updateUI(); };

function updateUI() {
    const progress = (state.total / state.goal) * 100;
    const sortedCheckpoints = [...CONFIG.checkpoints].sort((a, b) => a.pct - b.pct);
    
    let currentBeatIndex = sortedCheckpoints.findLastIndex(c => progress >= c.pct);
    if (currentBeatIndex === -1) currentBeatIndex = 0;
    
    const currentData = sortedCheckpoints[currentBeatIndex];
    const nextData = sortedCheckpoints[currentBeatIndex + 1] || { pct: 100 };
    
    // Boss HP Logic: Progress within the current milestone
    const beatRange = nextData.pct - currentData.pct;
    const progressInBeat = progress - currentData.pct;
    const bossHPPercent = Math.max(0, 100 - (progressInBeat / beatRange * 100));

    const currentBoss = CONFIG.genreBosses[state.genre][currentBeatIndex] || "The Unknown";

    document.getElementById('beatName').innerText = currentData.name;
    document.getElementById('bossName').innerText = `BOSS: ${currentBoss}`;
    
    // Main Progress Bar
    document.getElementById('hpBar').style.width = `${Math.min(progress, 100)}%`;
    document.getElementById('hpText').innerText = `${state.total.toLocaleString()} / ${state.goal.toLocaleString()} WORDS`;
    
    // Boss HP Bar
    document.getElementById('bossHPBar').style.width = `${bossHPPercent}%`;
    document.getElementById('bossHPText').innerText = `BOSS HP: ${Math.floor(bossHPPercent)}%`;

    document.getElementById('goldVal').innerText = state.gold;
    document.getElementById('xpVal').innerText = state.xp;

    const stc = document.getElementById('stcAnalysis');
    if (state.stcMode) {
        stc.classList.remove('hidden');
        document.getElementById('stcList').innerHTML = currentData.tasks
            .map(t => `<div class='check-item'><input type='checkbox'> <span><strong>${t.label}:</strong> ${t.desc}</span></div>`).join('');
    } else { stc.classList.add('hidden'); }
}

window.triggerInspiration = () => {
    const msg = CONFIG.inspiration[Math.floor(Math.random() * CONFIG.inspiration.length)];
    const panel = document.getElementById('inspirationPanel');
    panel.innerText = msg;
    panel.style.display = 'block';
    setTimeout(() => { panel.style.display = 'none'; }, 8000);
};

function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }
window.resetGame = () => { if(confirm("WIPE SYSTEM?")) { localStorage.clear(); location.reload(); }};
