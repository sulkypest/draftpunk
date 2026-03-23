let chart;
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, title: "", goal: 80000, total: 0, 
    logs: [], lastLevel: 0, deadline: "", inventory: [] 
};

const RANKS = ["Wordsmith", "Inkslinger", "Plot Baron", "Doctor of Drafts", "Prose Pilot", "Scene Slasher", "Chapter Champion", "Arc Architect", "Theme Weaver", "Manuscript Mage", "Story Sorcerer", "Narrative Knight", "World Builder", "The Scribeanator", "Almighty Wielder of Words!"];

const BOSS_BEATS = [
    { pct: 0, name: "Opening Image", lore: "Establish tone and normal world." },
    { pct: 10, name: "Theme Stated", lore: "Hint at the message." },
    { pct: 11, name: "Setup", lore: "Show daily routine." },
    { pct: 12, name: "The Catalyst", lore: "The incident that changes everything." },
    { pct: 20, name: "The Debate", lore: "Doubt and resistance." },
    { pct: 25, name: "Break into Two", lore: "Choosing the new world." },
    { pct: 30, name: "B Story", lore: "The thematic relationship." },
    { pct: 35, name: "Fun & Games", lore: "The promise of the premise." },
    { pct: 50, name: "The Midpoint", lore: "Stakes raised." },
    { pct: 65, name: "Bad Guys Close In", lore: "Opposition escalates." },
    { pct: 75, name: "All Is Lost", lore: "The lowest point." },
    { pct: 80, name: "Dark Night", lore: "Realizing true needs." },
    { pct: 85, name: "Break into Three", lore: "A new plan." },
    { pct: 90, name: "The Finale", lore: "The final confrontation." },
    { pct: 100, name: "Final Image", lore: "The change solidified." }
];

const PROMPTS = ["A secret is blurted out.", "Something breaks.", "An unexpected visitor.", "A sudden change in weather.", "A deadline is moved up.", "A lie is revealed."];

function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }

window.start = () => {
    state.title = document.getElementById('titleIn').value || "PROJECT";
    state.goal = parseInt(document.getElementById('goalIn').value) || 80000;
    state.deadline = document.getElementById('deadlineIn').value;
    state.active = true;
    state.logs = [{ date: new Date().toISOString().split('T')[0], total: 0 }];
    save();
    location.reload(); 
};

window.addWords = () => {
    const val = parseInt(document.getElementById('wordIn').value) || 0;
    if (val <= 0) return;
    const oldTotal = state.total;
    state.total += val;
    state.logs.push({ date: new Date().toISOString().split('T')[0], total: state.total });

    if (Math.floor(state.total / 5000) > Math.floor(oldTotal / 5000)) {
        const buddyNum = Math.floor(Math.random() * 20) + 1;
        state.inventory.push(`buddy${buddyNum}.png`);
        document.getElementById('newBuddyImg').src = `buddies/buddy${buddyNum}.png`;
        document.getElementById('buddyOverlay').classList.remove('hidden');
    }

    const progress = (state.total / state.goal * 100);
    const curIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    if (curIdx > state.lastLevel) {
        state.lastLevel = curIdx;
        document.getElementById('newLevelName').innerText = BOSS_BEATS[curIdx].name;
        document.getElementById('rankTitle').innerText = RANKS[curIdx];
        document.getElementById('levelOverlay').classList.remove('hidden');
    }
    save(); updateUI(); updateGraph();
    document.getElementById('wordIn').value = "";
};

function updateUI() {
    const progress = (state.total / state.goal) * 100;
    const curIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    const curB = BOSS_BEATS[curIdx] || BOSS_BEATS[0];
    const nxtB = BOSS_BEATS[curIdx+1] || {pct: 100, name: "The End"};
    const hp = Math.max(0, 100 - ((progress - curB.pct) / ((nxtB.pct - curB.pct) || 1) * 100));

    document.getElementById('wipDisplay').innerText = state.title;
    document.getElementById('lvlName').innerText = curB.name;
    document.getElementById('bossName').innerText = nxtB.name;
    document.getElementById('bossHPBar').style.width = hp + "%";
    document.getElementById('bossHPText').innerText = `HP: ${Math.floor(hp)}%`;
    document.getElementById('hpBar').style.width = Math.min(100, progress) + "%";
    document.getElementById('hpText').innerText = `${state.total} / ${state.goal} WORDS`;
    
    document.getElementById('loreBox').innerText = curB.lore;
    document.getElementById('tipsBox').innerText = `Microbeat focus: ${Math.floor(progress)}% of story reached.`;

    document.getElementById('bossSprite').src = `bosses/${curIdx+1}${hp <= 25 ? 'd' : hp <= 50 ? 'c' : hp <= 75 ? 'b' : 'a'}.png`;
    document.getElementById('levelIcon').src = `ranks/lvl${curIdx+1}.png`;
    document.getElementById('sideRankDisplay').innerText = `LVL ${curIdx+1}`;
    document.getElementById('sideRankName').innerText = RANKS[curIdx];
    document.getElementById('buddyCountDisplay').innerText = state.inventory.length;

    const gallery = document.getElementById('buddyGallery');
    gallery.innerHTML = state.inventory.map(img => `<img src="buddies/${img}" class="buddy-relic">`).join('');
}

window.toggleIntel = () => document.getElementById('intelContainer').classList.toggle('hidden');
window.getInspiration = () => {
    const box = document.getElementById('inspireBox');
    box.innerText = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    box.classList.remove('hidden');
    setTimeout(() => box.classList.add('hidden'), 5000);
};

function initGraph() {
    const ctx = document.getElementById('velocityChart').getContext('2d');
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: state.logs.map(l => l.date),
            datasets: [{ label: 'Wordcount', data: state.logs.map(l => l.total), borderColor: '#0ff', fill: false }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}
function updateGraph() { if(chart) { chart.data.labels = state.logs.map(l => l.date); chart.data.datasets[0].data = state.logs.map(l => l.total); chart.update(); } }
window.closeOverlay = () => document.getElementById('levelOverlay').classList.add('hidden');
window.closeBuddyOverlay = () => document.getElementById('buddyOverlay').classList.add('hidden');
window.resetGame = () => { localStorage.clear(); location.reload(); };

window.onload = () => {
    if (state.active) {
        document.getElementById('setup').style.display = 'none';
        document.getElementById('mainDashboard').classList.remove('hidden');
        updateUI(); initGraph();
    }
};
