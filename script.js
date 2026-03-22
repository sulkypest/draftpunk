let chart;
let audioCtx; 
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, title: "", genre: "urbanFantasy", goal: 80000, total: 0, 
    logs: [], lastLevel: 0, deadline: "" 
};

// YOUR CUSTOM RANKS
const RANKS = [
    "Wordsmith", "Inkslinger", "Plot Baron", "Doctor of Drafts", "Prose Pilot",
    "Scene Slasher", "Chapter Champion", "Arc Architect", "Theme Weaver", "Manuscript Mage",
    "Story Sorcerer", "Narrative Knight", "World Builder", "The Scribeanator", "Almighty Wielder of Words!"
];

// SAVE THE CAT STRUCTURE (80,000 WORDS) 
const BOSS_BEATS = [
    { pct: 0, name: "Opening Image", lore: "Introduce the normal world and hint at what is lacking. [cite: 8]" },
    { pct: 10, name: "Theme Stated", lore: "A moment that hints at the story's deeper message. [cite: 12]" },
    { pct: 11, name: "Setup", lore: "Show daily routine and establish surface wants. [cite: 10]" },
    { pct: 12, name: "The Catalyst", lore: "The inciting incident that changes everything. [cite: 14]" },
    { pct: 20, name: "The Debate", lore: "Resistance, doubt, and fear of the path ahead. [cite: 16, 18]" },
    { pct: 25, name: "Break into Two", lore: "Choosing to leave the old world behind. [cite: 20]" },
    { pct: 30, name: "B Story", lore: "Introduce a relationship that reflects the theme. [cite: 22]" },
    { pct: 35, name: "Fun & Games", lore: "Deliver on the promise of the premise. [cite: 24]" },
    { pct: 50, name: "The Midpoint", lore: "Stakes raised; false victory or defeat. [cite: 28]" },
    { pct: 65, name: "Bad Guys Close In", lore: "External opposition and internal conflict escalate. [cite: 30, 32]" },
    { pct: 75, name: "All Is Lost", lore: "The lowest point; a symbolic death. [cite: 34]" },
    { pct: 80, name: "Dark Night", lore: "Realizing true needs over surface wants. [cite: 36]" },
    { pct: 85, name: "Break into Three", lore: "A new plan born from lessons learned. [cite: 38]" },
    { pct: 90, name: "The Finale", lore: "The final push with clarity and purpose. [cite: 40, 42]" },
    { pct: 100, name: "Final Image", lore: "An image reflecting the total change. [cite: 44]" }
];

// 100 DAILY TARGETS OF 800 WORDS EACH [cite: 2, 8-44]
const MICRO_TIPS = [
    "Intro protagonist's normal world. [cite: 8]", "Show daily routine & surface wants. [cite: 10]", "Intro side characters & tension. [cite: 10]", "Suggest deeper need & flaws. [cite: 10]", "Ground reader in world rules. [cite: 10]", "Plant future conflicts. [cite: 10]", "Intro theme subtly. [cite: 10]", "Create friction in normal world. [cite: 10]", "Protagonist feels restlessness. [cite: 10]", "Make change feel necessary. [cite: 10]",
    "State the theme through action. [cite: 12]", "Deliver the inciting incident. [cite: 14]", "React emotionally to catalyst. [cite: 16]", "Resist change or doubt path. [cite: 18]", "Explore consequences of choice. [cite: 18]", "Add pressure from outside. [cite: 18]", "Add pressure from within. [cite: 18]", "Complicate relationships. [cite: 18]", "Old life becomes non-viable. [cite: 18]", "Push toward the decision. [cite: 18]",
    "Cross the threshold. [cite: 20]", "Intro/Deepen B-story relationship. [cite: 22]", "Relationship reflects theme. [cite: 22]", "Show protagonist vulnerability. [cite: 22]", "Build chemistry with B-story. [cite: 22]", "Reveal emotional significance. [cite: 22]", "B-story influences choices. [cite: 22]", "Strengthen emotional spine. [cite: 22]", "Tension between outer/inner plot. [cite: 22]", "Tie relationship to the arc. [cite: 22]",
    "Deliver the premise experience. [cite: 24]", "Explore the new situation. [cite: 24]", "Add novelty and energy. [cite: 24]", "Grant a small win or discovery. [cite: 24]", "Complicate entertainingly. [cite: 24]", "Develop supporting cast. [cite: 24]", "Expand the world meaning. [cite: 24]", "Show emerging costs of path. [cite: 26]", "Hero thinks they are adapting. [cite: 26]", "Intro a twist or obstacle. [cite: 26]",
    "Deepen stakes and goals. [cite: 26]", "Show emotional growth/avoidance. [cite: 26]", "Make promise feel full. [cite: 26]", "Build cause-and-effect momentum. [cite: 26]", "Add meaningful setbacks. [cite: 26]", "Tighten antagonistic pressure. [cite: 26]", "Stress the hero's flaw. [cite: 26]", "Set up the turning point. [cite: 26]", "Make things unstable. [cite: 26]", "Prepare for the Midpoint. [cite: 26]",
    "Deliver major Midpoint revelation. [cite: 28]", "Show Midpoint aftermath. [cite: 30]", "Increase external opposition. [cite: 30]", "Increase internal conflict. [cite: 30]", "Damage hero's confidence. [cite: 30]", "Close off easy options. [cite: 30]", "Friction among allies. [cite: 30]", "Antagonist gains ground. [cite: 30]", "Revisit flaw under pressure. [cite: 30]", "Consequences harden. [cite: 30]",
    "Strain on B story. [cite: 30]", "Make fearful choices. [cite: 30]", "Escalate emotional cost. [cite: 30]", "Remove comfort and certainty. [cite: 30]", "Increase pace of problems. [cite: 32]", "Make hero feel trapped. [cite: 32]", "Allow a brief hope. [cite: 32]", "Undermine that hope. [cite: 32]", "Bring strands to crisis. [cite: 32]", "Position for collapse. [cite: 32]",
    "Deliver the lowest point. [cite: 34]", "Weight of failure. [cite: 36]", "Strip away illusions. [cite: 36]", "Reflect on what went wrong. [cite: 36]", "Reconnect crisis to theme. [cite: 36]", "Show loss if no change. [cite: 36]", "B-story offers comfort. [cite: 36]", "Moment of truth. [cite: 36]", "Realize true needs. [cite: 36]", "Prepare breakthrough. [cite: 36]",
    "The new understanding/plan. [cite: 38]", "Push with clarity/purpose. [cite: 40]", "Gather allies and tools. [cite: 40]", "Put plan into action. [cite: 40]", "Act differently than before. [cite: 40]", "Fresh resistance. [cite: 42]", "Apply what was learned. [cite: 42]", "Build momentum in action. [cite: 42]", "Meaningful roles for allies. [cite: 42]", "Stakes collide. [cite: 42]",
    "The biggest challenge yet. [cite: 42]", "Near-failure differently. [cite: 42]", "Growth matters in action. [cite: 42]", "Drive toward climax. [cite: 42]", "Central confrontation. [cite: 42]", "Resolve external plot. [cite: 42]", "Resolve emotional arc. [cite: 42]", "Cost, gain, and change. [cite: 42]", "Tie up threads. [cite: 42]", "Final Image of change. [cite: 44]"
];

const PROMPTS = ["Character refuses.", "Strange smell.", "Someone watching.", "Tool breaks.", "Hostile weather.", "Secret blurted.", "3-min clock.", "Object found.", "Unexpected knock.", "Sudden silence.", "Worst case.", "Lie revealed.", "Hero sacrifice.", "Power shift.", "5-word flashback.", "Bribe.", "Safe path gone.", "Work with enemy.", "Misdirected msg.", "Fact is false.", "Injury.", "Promise due.", "Weather stakes.", "Hidden door.", "No.", "Followed.", "Fake object.", "Truth page.", "Item vanishes.", "Strength is weakness.", "Animal.", "Unwanted gift.", "Sound-only writing.", "Wrong time.", "Grudge.", "Two evils.", "Motivation shift.", "Talent.", "Core fear.", "Enemy kindness.", "Ally betrayal.", "Leaving all.", "Reality glitch.", "Another's letter.", "Danger request.", "Hiding.", "Secret habit.", "Deja vu.", "Leap of faith.", "Not the hero.", "Calm snap.", "Map to nowhere."];

window.closeOverlay = () => document.getElementById('levelOverlay').classList.add('hidden');

function playLevelUpSound() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'square';
    const now = audioCtx.currentTime;
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.3);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.start(); osc.stop(now + 0.5);
}

window.startQuest = () => {
    state.title = document.getElementById('titleIn').value || "UNTITLED WIP";
    state.genre = document.getElementById('genreIn').value;
    state.goal = parseInt(document.getElementById('goalIn').value) || 80000;
    state.deadline = document.getElementById('deadlineIn').value;
    state.active = true; state.total = 0; state.lastLevel = 0;
    state.logs = [{ date: new Date().toISOString().split('T')[0], total: 0 }];
    save(); showGame();
};

function showGame() {
    document.body.className = `skin-${state.genre}`;
    document.getElementById('wipDisplay').innerText = state.title;
    document.getElementById('setup').classList.add('hidden');
    document.getElementById('game').classList.remove('hidden');
    document.getElementById('sidePanels').classList.remove('hidden');
    initGraph(); updateUI();
}

window.addWords = () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const val = parseInt(document.getElementById('wordIn').value) || 0;
    if (val <= 0) return;

    const app = document.querySelector('.app');
    const sprite = document.getElementById('bossSprite');
    
    // FORCE RESTART ANIMATION VIA DOUBLE REQUEST
    sprite.classList.remove('boss-hit');
    app.classList.remove('shake');

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            sprite.classList.add('boss-hit');
            app.classList.add('shake');
        });
    });

    state.total += val;
    state.logs.push({ date: new Date().toISOString().split('T')[0], total: state.total });
    
    const progress = (state.total / state.goal * 100);
    const curIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    
    if (curIdx > state.lastLevel) {
        state.lastLevel = curIdx;
        triggerDefeat(curIdx);
    }
    document.getElementById('wordIn').value = "";
    save(); updateUI(); updateGraph();
};

function triggerDefeat(idx) {
    playLevelUpSound();
    const sprite = document.getElementById('bossSprite');
    sprite.style.transform = 'scale(0) rotate(720deg)';
    setTimeout(() => {
        document.getElementById('newLevelName').innerText = BOSS_BEATS[idx].name;
        document.getElementById('rankTitle').innerText = `LEVEL ${idx + 1}: ${RANKS[idx]}`;
        document.getElementById('levelOverlay').classList.remove('hidden');
        sprite.style.transform = ''; 
    }, 600);
}

function updateUI() {
    const progress = (state.total / state.goal) * 100;
    const curIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    const curB = BOSS_BEATS[curIdx] || BOSS_BEATS[0];
    const nxtB = BOSS_BEATS[curIdx + 1] || { pct: 100, name: "The End" };
    
    const beatRange = nxtB.pct - curB.pct;
    const hp = Math.max(0, 100 - ((progress - curB.pct) / (beatRange || 1) * 100));
    const microIdx = Math.min(99, Math.floor((state.total / state.goal) * 100));

    document.getElementById('lvlName').innerText = curB.name;
    document.getElementById('bossName').innerText = `You are battling the ${nxtB.name.toUpperCase()} BEAT BOSS!`;
    document.getElementById('bossHPBar').style.width = hp + "%";
    document.getElementById('bossHPText').innerText = `HP: ${Math.floor(hp)}%`;
    document.getElementById('loreBox').innerText = curB.lore;
    document.getElementById('tipsBox').innerText = `STEP ${microIdx + 1}/100: ${MICRO_TIPS[microIdx]}`;
    document.getElementById('hpBar').style.width = Math.min(100, progress) + "%";
    document.getElementById('hpText').innerText = `${state.total.toLocaleString()} / ${state.goal.toLocaleString()} WORDS`;

    document.getElementById('sideRankDisplay').innerText = `LVL ${curIdx + 1}`;
    document.getElementById('sideRankName').innerText = RANKS[curIdx].toUpperCase();
    
    if (state.deadline) {
        const diff = new Date(state.deadline) - new Date();
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
        document.getElementById('daysLeftDisplay').innerText = days > 0 ? days : "!!";
    }

    const s = document.getElementById('bossSprite');
    s.style.borderRadius = progress < 25 ? "0%" : progress < 50 ? "50% 0%" : progress < 75 ? "50%" : "30% 70%";
    
    if (hp < 40) {
        s.style.filter = `blur(${(40-hp)/5}px) hue-rotate(${(40-hp)*3}deg)`;
        s.style.animation = "glitch-vibe 0.1s infinite";
    } else {
        s.style.filter = "none";
        s.style.animation = "pulse 1.5s infinite alternate ease-in-out";
    }
}

window.getInspiration = () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.8);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.8);
    osc.start(); osc.stop(audioCtx.currentTime + 0.8);

    const b = document.getElementById('inspireBox');
    b.innerText = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    b.classList.remove('hidden');
    setTimeout(() => b.classList.add('hidden'), 6000);
};

window.toggleIntel = () => {
    const cont = document.getElementById('intelContainer');
    cont.classList.toggle('hidden');
    document.querySelector('.intel-btn').innerText = cont.classList.contains('hidden') ? "VIEW MICROBEAT TIPS ▾" : "HIDE MICROBEAT TIPS ▴";
};

function initGraph() {
    const ctx = document.getElementById('velocityChart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: state.logs.map(l => l.date),
            datasets: [{ label: 'Words', data: state.logs.map(l => l.total), borderColor: 'var(--neon)', tension: 0.3 },
                       { label: 'Target', data: getTargetData(), borderColor: 'rgba(255,255,255,0.1)', borderDash: [5,5], pointRadius: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { beginAtZero: true } } }
    });
}

function getTargetData() {
    if (!state.deadline || state.logs.length === 0) return [];
    const start = new Date(state.logs[0].date);
    const end = new Date(state.deadline);
    const rate = state.goal / Math.max(1, (end - start) / 86400000);
    return state.logs.map(log => Math.floor(((new Date(log.date) - start) / 86400000) * rate));
}

function updateGraph() { if(chart) { chart.data.labels = state.logs.map(l => l.date); chart.data.datasets[0].data = state.logs.map(l => l.total); chart.data.datasets[1].data = getTargetData(); chart.update(); } }
function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }
window.resetGame = () => { if(confirm("REBOOT SYSTEM?")) { localStorage.clear(); location.reload(); }};
window.onload = () => { if (state.active) showGame(); };
