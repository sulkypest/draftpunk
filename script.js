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
    { pct: 0, name: "Opening Image", lore: "Establish tone and normal world." },
    { pct: 10, name: "Theme Stated", lore: "Hint at the message." },
    { pct: 25, name: "Threshold", lore: "Entering the new world." },
    { pct: 50, name: "Midpoint", lore: "Stakes raised significantly." },
    { pct: 75, name: "All Is Lost", lore: "The lowest point." },
    { pct: 90, name: "Finale", lore: "The final confrontation." },
    { pct: 100, name: "Final Image", lore: "The change solidified." }
];

const MICRO_TIPS = Array.from({length: 101}, (_, i) => `Micro-Beat ${i}: Focus on the specific sensory details of this moment.`);

function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }

window.start = () => {
    state.title = document.getElementById('titleIn').value || "PROJECT";
    state.goal = parseInt(document.getElementById('goalIn').value) || 80000;
    state.deadline = document.getElementById('deadlineIn').value;
    state.genre = document.getElementById('genreIn').value;
    state.active = true; // Lock the state
    state.total = 0;
    state.logs = [{ date: new Date().toLocaleDateString(), total: 0 }];
    save();
    location.reload(); 
};

window.addWords = () => {
    const val = parseInt(document.getElementById('wordIn').value) || 0;
    if (val <= 0) return;
    state.total += val;
    state.logs.push({ date: new Date().toLocaleDateString(), total: state.total });

    if (state.total % 5000 < val) {
        state.inventory.push(`buddy${Math.floor(Math.random() * 20) + 1}.png`);
        document.getElementById('buddyOverlay').style.display = 'flex';
    }

    save(); updateUI(); updateGraph();
    document.getElementById('wordIn').value = "";
};

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
    document.getElementById('hpText').innerText = `${state.total.toLocaleString()} / ${state.goal.toLocaleString()} WORDS`;
    
    document.getElementById('loreBox').innerText = curB.lore;
    document.getElementById('tipsBox').innerText = MICRO_TIPS[Math.floor(progress)] || "Keep going!";
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

window.toggleIntel = () => {
    const container = document.getElementById('intelContainer');
    container.classList.toggle('hidden');
};

window.showGrenade = () => {
    const p = ["A secret is blurted out.", "Something breaks.", "An unexpected visitor.", "A lie is revealed."];
    document.getElementById('inspireText').innerText = p[Math.floor(Math.random()*p.length)];
    document.getElementById('grenadeOverlay').style.display = 'flex';
};

window.closeGrenade = () => document.getElementById('grenadeOverlay').style.display = 'none';
window.closeOverlay = () => document.getElementById('levelOverlay').style.display = 'none';
window.closeBuddyOverlay = () => document.getElementById('buddyOverlay').style.display = 'none';
window.resetGame = () => { if(confirm("Reset?")) { localStorage.clear(); location.reload(); }};

window.onload = () => {
    if (state && state.active) {
        document.getElementById('setup').classList.add('hidden');
        document.getElementById('mainDashboard').classList.remove('hidden');
        updateUI(); 
        initGraph();
    }
};
