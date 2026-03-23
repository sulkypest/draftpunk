let chart;
let audioCtx; 
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, title: "", genre: "urbanFantasy", goal: 80000, total: 0, 
    logs: [], lastLevel: 0, deadline: "", inventory: [] 
};

const RANKS = ["Wordsmith", "Inkslinger", "Plot Baron", "Doctor of Drafts", "Prose Pilot", "Scene Slasher", "Chapter Champion", "Arc Architect", "Theme Weaver", "Manuscript Mage", "Story Sorcerer", "Narrative Knight", "World Builder", "The Scribeanator", "Almighty Wielder of Words!"];

const BOSS_BEATS = [
    { pct: 0, name: "Opening Image", lore: "Intro protagonist's normal world." },
    { pct: 10, name: "Theme Stated", lore: "State the theme through action." },
    { pct: 11, name: "Setup", lore: "Show daily routine & surface wants." },
    { pct: 12, name: "The Catalyst", lore: "Deliver the inciting incident." },
    { pct: 20, name: "The Debate", lore: "Resist change or doubt path." },
    { pct: 25, name: "Break into Two", lore: "Cross the threshold." },
    { pct: 30, name: "B Story", lore: "Intro/Deepen B-story relationship." },
    { pct: 35, name: "Fun & Games", lore: "Deliver the premise experience." },
    { pct: 50, name: "The Midpoint", lore: "Deliver major Midpoint revelation." },
    { pct: 65, name: "Bad Guys Close In", lore: "Increase external opposition." },
    { pct: 75, name: "All Is Lost", lore: "Deliver the lowest point." },
    { pct: 80, name: "Dark Night", lore: "Strip away illusions." },
    { pct: 85, name: "Break into Three", lore: "The new understanding/plan." },
    { pct: 90, name: "The Finale", lore: "The biggest challenge yet." },
    { pct: 100, name: "Final Image", lore: "Closing image of change." }
];

// 100 Daily targets (Simplified extract for space)
const MICRO_TIPS = Array(100).fill("Focus on the current beat goals."); 

const PROMPTS = ["Character refuses.", "Strange smell.", "Someone watching.", "Tool breaks.", "Hostile weather.", "Secret blurted.", "3-min clock.", "Object found."];

window.startQuest = () => {
    state.title = document.getElementById('titleIn').value || "UNTITLED WIP";
    state.genre = document.getElementById('genreIn').value;
    state.goal = parseInt(document.getElementById('goalIn').value) || 80000;
    state.deadline = document.getElementById('deadlineIn').value;
    state.active = true; state.total = 0; state.lastLevel = 0; state.inventory = [];
    state.logs = [{ date: new Date().toISOString().split('T')[0], total: 0 }];
    save(); location.reload();
};

window.addWords = () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const val = parseInt(document.getElementById('wordIn').value) || 0;
    if (val <= 0) return;

    const app = document.querySelector('.app');
    const sprite = document.getElementById('bossSprite');
    sprite.classList.remove('boss-hit');
    app.classList.remove('shake');
    requestAnimationFrame(() => { requestAnimationFrame(() => {
        sprite.classList.add('boss-hit'); app.classList.add('shake');
    });});

    const oldTotal = state.total;
    state.total += val;
    state.logs.push({ date: new Date().toISOString().split('T')[0], total: state.total });
    
    // Buddies every 5k actual words
    if (Math.floor(state.total / 5000) > Math.floor(oldTotal / 5000)) {
        receiveGift();
    }

    const progress = (state.total / state.goal * 100);
    if (progress >= 100) triggerVictory();

    const curIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    if (curIdx > state.lastLevel) {
        state.lastLevel = curIdx;
        triggerDefeat(curIdx);
    }
    document.getElementById('wordIn').value = "";
    save(); updateUI(); updateGraph();
};

function receiveGift() {
    const buddyNum = Math.floor(Math.random() * 20) + 1; 
    const buddyFile = `buddy${buddyNum}.png`;
    state.inventory.push(buddyFile);
    
    document.getElementById('newBuddyImg').src = `buddies/${buddyFile}`;
    document.getElementById('buddyOverlay').classList.remove('hidden');
    playDiscoverySound();
}

function updateUI() {
    const progress = (state.total / state.goal) * 100;
    const curIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    const curB = BOSS_BEATS[curIdx] || BOSS_BEATS[0];
    const nxtB = BOSS_BEATS[curIdx + 1] || { pct: 100, name: "The End" };
    const hp = Math.max(0, 100 - ((progress - curB.pct) / ((nxtB.pct - curB.pct) || 1) * 100));

    // Images from Folders
    let suffix = (hp <= 25) ? "d" : (hp <= 50) ? "c" : (hp <= 75) ? "b" : "a";
    document.getElementById('bossSprite').src = `bosses/${curIdx + 1}${suffix}.png`;
    document.getElementById('levelIcon').src = `ranks/lvl${curIdx + 1}.png`;

    // Counters
    document.getElementById('buddyCountDisplay').innerText = state.inventory.length;
    document.getElementById('hpBar').style.width = Math.min(100, progress) + "%";
    document.getElementById('hpText').innerText = `${state.total.toLocaleString()} WORDS`;
    document.getElementById('sideRankDisplay').innerText = `LVL ${curIdx + 1}`;
    document.getElementById('sideRankName').innerText = RANKS[curIdx].toUpperCase();
    
    const gallery = document.getElementById('buddyGallery');
    gallery.innerHTML = state.inventory.map(img => `<img src="buddies/${img}" class="buddy-relic">`).join('');
}

function playDiscoverySound() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.connect(g); g.connect(audioCtx.destination);
    osc.frequency.setValueAtTime(440, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.2);
    g.gain.setValueAtTime(0.1, audioCtx.currentTime);
    g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.4);
    osc.start(); osc.stop(audioCtx.currentTime + 0.4);
}

// ... Additional helper functions (triggerDefeat, triggerVictory, save, etc.)
window.closeOverlay = () => document.getElementById('levelOverlay').classList.add('hidden');
window.closeBuddyOverlay = () => document.getElementById('buddyOverlay').classList.add('hidden');
window.resetGame = () => { if(confirm("RESET ALL?")) { localStorage.clear(); location.reload(); }};
window.onload = () => { if(state.active) { document.getElementById('setup').classList.add('hidden'); document.getElementById('game').classList.remove('hidden'); updateUI(); initGraph(); } };
function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }
