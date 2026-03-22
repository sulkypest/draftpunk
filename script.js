import { CONFIG } from './data.js';

let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, name: "", genre: "urbanFantasy", goal: 80000, total: 0, 
    gold: 0, xp: 0, history: [], stcMode: false 
};

window.onload = () => { if (state.active) showGame(); };

window.startQuest = () => {
    state.name = document.getElementById('nameIn').value || "Author";
    state.genre = document.getElementById('genreIn').value;
    state.goal = parseInt(document.getElementById('goalIn').value) || 80000;
    state.active = true;
    save();
    showGame();
};

function showGame() {
    document.getElementById('setup').classList.add('hidden');
    document.getElementById('game').classList.remove('hidden');
    document.body.className = state.genre + "-theme";
    updateUI();
}

window.addWords = () => {
    const val = parseInt(document.getElementById('wordIn').value) || 0;
    if (val <= 0) return;
    state.total += val;
    state.xp += val;
    state.gold += Math.floor(val / 10);
    state.history.unshift({ words: val, time: new Date().toLocaleTimeString() });
    if(state.history.length > 5) state.history.pop();
    document.getElementById('wordIn').value = "";
    save();
    updateUI();
};

window.toggleSTC = () => { state.stcMode = !state.stcMode; save(); updateUI(); };

function updateUI() {
    const progress = (state.total / state.goal) * 100;
    // Precisely find the current checkpoint
    let currentData = [...CONFIG.checkpoints].reverse().find(c => progress >= c.pct) || CONFIG.checkpoints[0];
    const index = CONFIG.checkpoints.indexOf(currentData);
    const currentBoss = CONFIG.genreBosses[state.genre][index] || "Unknown Entity";

    document.getElementById('beatName').innerText = currentData.name;
    document.getElementById('bossName').innerText = `Milestone: ${currentBoss}`;
    document.getElementById('hpBar').style.width = `${Math.min(progress, 100)}%`;
    document.getElementById('hpText').innerText = `${state.total.toLocaleString()} / ${state.goal.toLocaleString()} WORDS`;
    document.getElementById('statDisplay').innerText = `Credits: ${state.gold}c | Progress: ${progress.toFixed(2)}%`;

    const stc = document.getElementById('stcAnalysis');
    if (state.stcMode) {
        stc.classList.remove('hidden');
        document.getElementById('stcList').innerHTML = currentData.tasks
            .map(t => `<div class='check-item'><input type='checkbox'> ${t}</div>`).join('');
    } else { stc.classList.add('hidden'); }
}

function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }
window.resetGame = () => { if(confirm("Reset Campaign?")) { localStorage.clear(); location.reload(); }};
