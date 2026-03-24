let chart;
// 1. Safe State Loading
let state;
try {
    state = JSON.parse(localStorage.getItem('draftPunkData')) || {
        active: false, title: "", goal: 80000, total: 0, genre: "urbanFantasy",
        logs: [], lastLevel: 0, deadline: "", inventory: [] 
    };
} catch (e) {
    console.error("Data corrupted, resetting.");
    state = { active: false, title: "", goal: 80000, total: 0, genre: "urbanFantasy", logs: [], lastLevel: 0, deadline: "", inventory: [] };
}

const GENRE_STYLES = {
    urbanFantasy: "#0ff", sciFi: "#0fa", fantasy: "#ffd700", horror: "#ff0000",
    cyberpunk: "#f0f", crimeNoir: "#708090", romance: "#ff69b4", thriller: "#ffa500", western: "#cd7f32"
};

// YOUR 15 RANKS - LOCKED
const RANKS = [
    "Inkslinger", "Plot Scout", "Draft Punk", "Scene Slasher", "Chapter Boss", 
    "Word Runner", "Arc Architect", "Prose Pilot", "Theme Weaver", "Story Sorcerer", 
    "Narrative Knight", "Manuscript Mage", "World Builder", "Legendary Author", "The Scribe-anator"
];

const BOSS_BEATS = [
    { pct: 0, name: "Opening Image", lore: "A snapshot of the 'before' world." },
    { pct: 1, name: "Theme Stated", lore: "Someone hints at the life lesson needed." },
    { pct: 10, name: "Setup", lore: "Exploring the hero's world and flaws." },
    { pct: 12, name: "Catalyst", lore: "The life-changing telegram or explosion." },
    { pct: 20, name: "Debate", lore: "The last chance to turn back." },
    { pct: 25, name: "Break into Two", lore: "Leaving the old world behind." },
    { pct: 30, name: "B Story", lore: "The love interest or helper appears." },
    { pct: 35, name: "Fun and Games", lore: "The 'promise of the premise' in action." },
    { pct: 50, name: "Midpoint", lore: "The stakes are raised or the clock starts." },
    { pct: 60, name: "Bad Guys Close In", lore: "The opposition gets serious." },
    { pct: 75, name: "All Is Lost", lore: "The 'whiff of death' moment." },
    { pct: 80, name: "Dark Night", lore: "The hero hits rock bottom." },
    { pct: 85, name: "Break into Three", lore: "The 'Aha!' moment and the new plan." },
    { pct: 90, name: "Finale", lore: "The final battle and transformation." },
    { pct: 100, name: "Final Image", lore: "The 'after' world—completely changed." }
];

const GRENADES = [
    "A character is not who they say they are.", "A long-buried secret is suddenly unearthed.",
    "A trusted ally commits an act of betrayal.", "An unexpected visitor arrives with life-changing news.",
    "The protagonist discovers a hidden message or map.", "A vital piece of equipment or a weapon breaks.",
    "A natural disaster or accident changes the stakes.", "The antagonist moves against the hero's home.",
    "A character falls ill or is poisoned.", "An old debt is called in by a dangerous party.",
    "The hero is framed for a crime.", "A romantic rival enters the scene.",
    "A deadline is moved up.", "The hero loses a memory.", "An innocent is put in the crosshairs."
];

// ENSURED 101 ENTRIES (0-100)
const MICRO_TIPS = Array(101).fill("Keep writing! Every word counts toward the next beat.").map((defaultTip, i) => {
    const customTips = {
        0: "0%: Hook the reader in the first paragraph with a strong 'Voice'.",
        1: "1%: Establish the 'Stasis'—what is the hero's boring, daily life?",
        10: "10%: SETUP: The world feels too small for the hero now.",
        25: "25%: BREAK INTO TWO: The journey officially begins.",
        50: "50%: MIDPOINT: A massive revelation shifts the goal.",
        75: "75%: ALL IS LOST: The 'Whiff of Death' moment.",
        100: "100%: THE END: You've finished the draft. Celebrate."
    };
    return customTips[i] || `${i}%: ` + defaultTip;
});

function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }

window.start = function() {
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

window.addWords = function() {
    const val = parseInt(document.getElementById('wordIn').value) || 0;
    if (val <= 0) return;
    state.total += val;
    state.logs.push({ date: new Date().toLocaleDateString(), total: state.total });
    
    const progress = (state.total / state.goal) * 100;
    const newIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    if (newIdx > state.lastLevel) {
        state.lastLevel = newIdx;
        const bbt = document.getElementById('bossBeatTitle');
        if(bbt) bbt.innerText = BOSS_BEATS[newIdx].name;
        document.getElementById('levelOverlay').style.display = 'flex';
    }
    save(); updateUI(); updateGraph();
    document.getElementById('wordIn').value = "";
};

function updateUI() {
    try {
        const color = GENRE_STYLES[state.genre] || "#0ff";
        document.documentElement.style.setProperty('--neon', color);
        
        const progress = (state.total / state.goal) * 100;
        const curIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
        const curB = BOSS_BEATS[curIdx] || BOSS_BEATS[0];
        const nxtB = BOSS_BEATS[curIdx+1] || {pct: 100, name: "The End"};
        
        const beatSpan = nxtB.pct - curB.pct;
        const progressInBeat = progress - curB.pct;
        const hp = Math.max(0, 100 - (progressInBeat / (beatSpan || 1) * 100));

        if(document.getElementById('wipDisplay')) document.getElementById('wipDisplay').innerText = state.title;
        if(document.getElementById('lvlName')) document.getElementById('lvlName').innerText = "BEAT " + (curIdx + 1) + ": " + curB.name;
        if(document.getElementById('bossName')) document.getElementById('bossName').innerText = nxtB.name;
        if(document.getElementById('bossHPBar')) document.getElementById('bossHPBar').style.width = hp + "%";
        if(document.getElementById('hpBar')) document.getElementById('hpBar').style.width = Math.min(100, progress) + "%";
        if(document.getElementById('hpText')) document.getElementById('hpText').innerText = state.total.toLocaleString() + " / " + state.goal.toLocaleString();
        if(document.getElementById('loreBox')) document.getElementById('loreBox').innerText = curB.lore;
        
        const tipIndex = Math.min(100, Math.floor(progress));
        if(document.getElementById('tipsBox')) document.getElementById('tipsBox').innerText = MICRO_TIPS[tipIndex];

        const suffix = hp <= 25 ? 'd' : hp <= 50 ? 'c' : hp <= 75 ? 'b' : 'a';
        const sprite = document.getElementById('bossSprite');
        if(sprite) sprite.src = `bosses/${curIdx + 1}${suffix}.png`;

        const rankEl = document.getElementById('sideRankName');
        if(rankEl) rankEl.innerText = (RANKS[curIdx] || "THE SCRIBE-ANATOR").toUpperCase();
        
    } catch (err) {
        console.error("UI Update Error:", err);
    }
}

function initGraph() {
    const canvas = document.getElementById('velocityChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: state.logs.map(l => l.date),
            datasets: [{ data: state.logs.map(l => l.total), borderColor: GENRE_STYLES[state.genre], tension: 0.2, fill: false }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
}

function updateGraph() { if(chart) { chart.data.labels = state.logs.map(l => l.date); chart.data.datasets[0].data = state.logs.map(l => l.total); chart.update(); } }

window.toggleIntel = function() { document.getElementById('intelContainer').classList.toggle('hidden'); };
window.showGrenade = function() {
    document.getElementById('inspireText').innerText = GRENADES[Math.floor(Math.random() * GRENADES.length)];
    document.getElementById('grenadeOverlay').style.display = 'flex';
};
window.closeGrenade = function() { document.getElementById('grenadeOverlay').style.display = 'none'; };
window.closeOverlay = function() { document.getElementById('levelOverlay').style.display = 'none'; };
window.resetGame = function() { if(confirm("Clear all data?")) { localStorage.clear(); location.reload(); }};

window.onload = function() {
    if (state.active) {
        document.getElementById('setup').style.display = 'none';
        document.getElementById('mainDashboard').style.display = 'flex';
        updateUI(); initGraph();
    } else {
        document.getElementById('setup').style.display = 'block';
        document.getElementById('mainDashboard').style.display = 'none';
    }
};
