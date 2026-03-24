let chart;
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, title: "", goal: 80000, total: 0, genre: "urbanFantasy",
    logs: [], lastLevel: 0, deadline: "", inventory: [] 
};

const GENRE_STYLES = {
    urbanFantasy: "#0ff", sciFi: "#0fa", fantasy: "#ffd700", horror: "#ff0000",
    cyberpunk: "#f0f", crimeNoir: "#708090", romance: "#ff69b4", thriller: "#ffa500", western: "#cd7f32"
};

const BOSS_BEATS = [
    { pct: 0, name: "Opening Image", lore: "Establish the normal world." },
    { pct: 10, name: "Theme Stated", lore: "A hint of the truth." },
    { pct: 25, name: "Break into Two", lore: "The journey begins." },
    { pct: 50, name: "Midpoint", lore: "The stakes double." },
    { pct: 75, name: "All Is Lost", lore: "The lowest point." },
    { pct: 90, name: "Finale", lore: "The final battle." },
    { pct: 100, name: "Resolution", lore: "The new normal." }
];

const MICRO_TIPS = Array.from({length: 101}, (_, i) => `Micro-Beat ${i}: Focus on sensory detail and character reaction.`);

const GRENADES = [
    "A phone rings—it's someone who shouldn't have the number.",
    "A sudden discovery: a hidden compartment or a deleted file.",
    "Someone is lying, and the hero just caught the slip-up.",
    "A power outage or a sudden equipment failure at the worst time.",
    "An unexpected visitor arrives with a warrant or a warning.",
    "The hero realizes they are being followed by a familiar face.",
    "A character reveals a secret that changes the goal of the scene.",
    "The weather turns violent, forcing characters into a tight space.",
    "A secondary character makes a romantic or aggressive move.",
    "The hero loses a vital item: a key, a weapon, or a piece of ID.",
    "A ghost from the past appears in a public place.",
    "An explosion or loud crash occurs nearby, but out of sight.",
    "The hero is offered a bribe they actually need.",
    "A deadline is moved up—they have half the time they thought.",
    "The antagonist sends a 'gift' that is actually a threat.",
    "A trusted ally is caught communicating with the enemy.",
    "The protagonist's internal flaw causes a public embarrassment.",
    "A law enforcement officer starts asking too many questions.",
    "Someone collapses or falls ill, demanding immediate attention.",
    "The hero discovers the person they trust most isn't who they say they are."
];

function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }

window.start = () => {
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

window.addWords = () => {
    const val = parseInt(document.getElementById('wordIn').value) || 0;
    if (val <= 0) return;
    
    const oldProgress = (state.total / state.goal) * 100;
    state.total += val;
    state.logs.push({ date: new Date().toLocaleDateString(), total: state.total });
    const newProgress = (state.total / state.goal) * 100;

    // Check for Boss Beat Level Up
    const newIdx = BOSS_BEATS.findLastIndex(b => newProgress >= b.pct);
    if (newIdx > state.lastLevel) {
        state.lastLevel = newIdx;
        showBossOverlay(BOSS_BEATS[newIdx].name);
    }

    // Check for Buddy (Every 5k)
    if (Math.floor(state.total / 5000) > Math.floor((state.total - val) / 5000)) {
        state.inventory.push(`buddy${Math.floor(Math.random() * 20) + 1}.png`);
        document.getElementById('buddyOverlay').style.display = 'flex';
    }

    save(); updateUI(); updateGraph();
    document.getElementById('wordIn').value = "";
};

function showBossOverlay(name) {
    document.getElementById('bossBeatTitle').innerText = name;
    document.getElementById('levelOverlay').style.display = 'flex';
}

function updateUI() {
    const color = GENRE_STYLES[state.genre] || "#0ff";
    document.documentElement.style.setProperty('--neon', color);
    
    const progress = (state.total / state.goal) * 100;
    const curIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    const curB = BOSS_BEATS[curIdx] || BOSS_BEATS[0];
    const nxtB = BOSS_BEATS[curIdx+1] || {pct: 100, name: "The End"};
    const hp = Math.max(0, 100 - ((progress - curB.pct) / ((nxtB.pct - curB.pct) || 1) * 100));

    document.getElementById('wipDisplay').innerText = state.title;
    document.getElementById('lvlName').innerText = curB.name;
    document.getElementById('bossName').innerText = nxtB.name;
    document.getElementById('bossHPBar').style.width = hp + "%";
    document.getElementById('hpBar').style.width = Math.min(100, progress) + "%";
    document.getElementById('hpText').innerText = `${state.total.toLocaleString()} / ${state.goal.toLocaleString()}`;
    
    document.getElementById('loreBox').innerText = curB.lore;
    document.getElementById('tipsBox').innerText = MICRO_TIPS[Math.floor(progress)] || "Keep writing!";
    document.getElementById('sideRankName').innerText = `LVL ${curIdx + 1}`;
    document.getElementById('buddyCountDisplay').innerText = state.inventory.length;
    document.getElementById('buddyGallery').innerHTML = state.inventory.map(i => `<img src="buddies/${i}" class="buddy-relic">`).join('');
}

function initGraph() {
    const ctx = document.getElementById('velocityChart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: state.logs.map(l => l.date),
            datasets: [{ data: state.logs.map(l => l.total), borderColor: GENRE_STYLES[state.genre], tension: 0.2, fill: false }]
        },
        options: { 
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { ticks: { color: '#444' } } }
        }
    });
}

function updateGraph() { if(chart) { chart.data.labels = state.logs.map(l => l.date); chart.data.datasets[0].data = state.logs.map(l => l.total); chart.update(); } }

window.toggleIntel = () => document.getElementById('intelContainer').classList.toggle('hidden');

window.showGrenade = () => {
    document.getElementById('inspireText').innerText = GRENADES[Math.floor(Math.random() * GRENADES.length)];
    document.getElementById('grenadeOverlay').style.display = 'flex';
};

window.closeGrenade = () => document.getElementById('grenadeOverlay').style.display = 'none';
window.closeOverlay = () => document.getElementById('levelOverlay').style.display = 'none';
window.closeBuddyOverlay = () => document.getElementById('buddyOverlay').style.display = 'none';
window.resetGame = () => { if(confirm("Clear all data?")) { localStorage.clear(); location.reload(); }};

window.onload = () => {
    if (state.active) {
        document.getElementById('setup').style.display = 'none';
        document.getElementById('mainDashboard').style.display = 'flex';
        updateUI(); initGraph();
    } else {
        document.getElementById('setup').style.display = 'block';
        document.getElementById('mainDashboard').style.display = 'none';
    }
};
