let chart;
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, genre: "urbanFantasy", goal: 80000, total: 0, 
    logs: [], lastLevel: -1, deadline: "" 
};

const STC_BEATS = [
    { pct: 0, name: "Opening Image", lore: "The 'before' snapshot. Establish the hero's world and the 'stasis monster' keeping them there." },
    { pct: 1, name: "Theme Stated", lore: "A secondary character mentions the life lesson the hero must learn, though the hero ignores it." },
    { pct: 10, name: "Setup", lore: "Explore the hero’s world and introduce the 'A Story' characters. Show what they stand to lose." },
    { pct: 12, name: "The Catalyst", lore: "The telegram, the knock at the door, the change. The world as it was is now gone." },
    { pct: 20, name: "The Debate", lore: "The hero hesitates. Can I do this? Is it safe? This is the last chance to go back." },
    { pct: 25, name: "Break into Two", lore: "The hero makes a choice. They leave the old world and enter the 'upside-down' world of Act 2." },
    { pct: 30, name: "B Story", lore: "Introduce the 'helper' or love interest. This story carries the theme of the book." },
    { pct: 35, name: "Fun & Games", lore: "The 'promise of the premise.' The hero explores the new world. Stakes are still relatively low." },
    { pct: 50, name: "The Midpoint", lore: "Stakes are raised. The hero either gets a false victory or a false defeat. No more playing around." },
    { pct: 65, name: "Bad Guys Close In", lore: "The internal or external pressure mounts. The hero's flaws begin to crumble their progress." },
    { pct: 75, name: "All Is Lost", lore: "The 'whiff of death.' Someone dies or the hero’s goal seems impossible. Total defeat." },
    { pct: 80, name: "Dark Night", lore: "The hero wallows. They finally realize the theme stated at the beginning. The epiphany." },
    { pct: 85, name: "Break into Three", lore: "The hero realizes how to solve the problem and chooses to act one last time." },
    { pct: 90, name: "The Finale", lore: "The hero executes the plan. The old flaws are gone. The A and B stories wrap up." },
    { pct: 100, name: "Final Image", lore: "The 'after' snapshot. Show how much the hero and their world has changed since the start." }
];

const PROMPTS = ["Worst case scenario: Make it happen.", "Add a ticking clock.", "Dialogue only for 100 words.", "Hostile environment: Tech or weather fails."];

window.closeOverlay = () => document.getElementById('levelOverlay').classList.add('hidden');

window.onload = () => { if (state.active) showGame(); };

window.startQuest = () => {
    state.genre = document.getElementById('genreIn').value;
    state.goal = parseInt(document.getElementById('goalIn').value) || 80000;
    state.deadline = document.getElementById('deadlineIn').value;
    state.active = true;
    state.total = 0;
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

    if ("vibrate" in navigator) navigator.vibrate(50);
    document.querySelector('.app').classList.add('shake');
    setTimeout(() => document.querySelector('.app').classList.remove('shake'), 400);

    state.total += val;
    state.logs.push({ date: new Date().toISOString().split('T')[0], total: state.total });
    
    const progress = (state.total / state.goal * 100);
    const curIdx = STC_BEATS.findLastIndex(b => progress >= b.pct);
    
    if (curIdx > state.lastLevel && state.total > 0) {
        state.lastLevel = curIdx;
        document.getElementById('newLevelName').innerText = STC_BEATS[curIdx].name;
        document.getElementById('levelOverlay').classList.remove('hidden');
    }

    document.getElementById('wordIn').value = "";
    save();
    updateUI();
    updateGraph();
};

function updateUI() {
    const progress = (state.total / state.goal) * 100;
    const curIdx = STC_BEATS.findLastIndex(b => progress >= b.pct);
    const curB = STC_BEATS[curIdx] || STC_BEATS[0];
    const nxtB = STC_BEATS[curIdx + 1] || { pct: 100, name: "The End" };

    const hp = Math.max(0, 100 - ((progress - curB.pct) / ((nxtB.pct - curB.pct) || 1) * 100));

    document.getElementById('lvlName').innerText = curB.name;
    document.getElementById('bossName').innerText = `VS: ${nxtB.name}`;
    document.getElementById('bossHPBar').style.width = hp + "%";
    document.getElementById('bossHPText').innerText = `HP: ${Math.floor(hp)}%`;
    document.getElementById('loreBox').innerText = curB.lore;

    const s = document.getElementById('bossSprite');
    s.style.transform = `scale(${0.6 + (hp/250)}) rotate(${curIdx * 24}deg)`;
    s.style.borderRadius = `${(curIdx / 15) * 50}%`;
    
    document.getElementById('hpBar').style.width = Math.min(100, progress) + "%";
    document.getElementById('hpText').innerText = `${state.total.toLocaleString()} / ${state.goal.toLocaleString()} WORDS`;
}

window.getInspiration = () => {
    const b = document.getElementById('inspireBox');
    b.innerText = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    b.classList.remove('hidden');
    setTimeout(() => b.classList.add('hidden'), 5000);
};

function initGraph() {
    const ctx = document.getElementById('velocityChart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: state.logs.map(l => l.date),
            datasets: [{ label: 'Words', data: state.logs.map(l => l.total), borderColor: '#0ff', tension: 0.3 },
                       { label: 'Target', data: getTargetData(), borderColor: 'rgba(255,255,255,0.1)', borderDash: [5,5], pointRadius: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { beginAtZero: true } } }
    });
}

function getTargetData() {
    if (!state.deadline || state.logs.length === 0) return [];
    const start = new Date(state.logs[0].date);
    const end = new Date(state.deadline);
    const days = Math.max(1, (end - start) / 86400000);
    const rate = state.goal / days;
    return state.logs.map(log => {
        const diff = (new Date(log.date) - start) / 86400000;
        return Math.floor(diff * rate);
    });
}

function updateGraph() {
    if(chart) {
        chart.data.labels = state.logs.map(l => l.date);
        chart.data.datasets[0].data = state.logs.map(l => l.total);
        chart.data.datasets[1].data = getTargetData();
        chart.update();
    }
}

function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }
window.resetGame = () => { if(confirm("REBOOT SYSTEM?")) { localStorage.clear(); location.reload(); }};
