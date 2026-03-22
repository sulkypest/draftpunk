let chart;
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, title: "", genre: "urbanFantasy", goal: 80000, total: 0, 
    logs: [], lastLevel: -1, deadline: "" 
};

const RANKS = [
    "Wordsmith", "Inkslinger", "Plot Baron", "Draft Drifter", "Prose Pilot",
    "Scene Slasher", "Chapter Chaser", "Arc Architect", "Theme Weaver", "Manuscript Mage",
    "Story Soul", "Narrative Knight", "World Builder", "The Final Scribe", "Legendary Architect"
];

const BOSS_BEATS = [
    { pct: 0, name: "Opening Image", lore: "Establish the 'Before' world." },
    { pct: 1, name: "Theme Stated", lore: "The lesson is whispered." },
    { pct: 10, name: "Setup", lore: "Introduce the life to be changed." },
    { pct: 12, name: "The Catalyst", lore: "The telegram of destiny." },
    { pct: 20, name: "The Debate", lore: "Hesitation before the leap." },
    { pct: 25, name: "Break into Two", lore: "Leaving the old world behind." },
    { pct: 30, name: "B Story", lore: "The helper/lover arrives." },
    { pct: 35, name: "Fun & Games", lore: "The promise of the premise." },
    { pct: 50, name: "The Midpoint", lore: "Stakes raised. No turning back." },
    { pct: 65, name: "Bad Guys Close In", lore: "Internal/External pressure." },
    { pct: 75, name: "All Is Lost", lore: "The whiff of death." },
    { pct: 80, name: "Dark Night", lore: "The epiphany." },
    { pct: 85, name: "Break into Three", lore: "The new plan." },
    { pct: 90, name: "The Finale", lore: "The battle for change." },
    { pct: 100, name: "Final Image", lore: "The 'After' world." }
];

const MICRO_TIPS = [
    "Intro normal world & hint what's lacking.", "Show routine; establish surface want.", "Intro side characters & tension.", "Suggest deeper need & flaws.", "Ground reader in rules & stakes.", "Plant future conflict seeds.", "Intro theme subtly.", "Create friction in the old world.", "Protagonist feels restlessness.", "Position change as necessary.",
    "Hint at story's deeper message.", "The Catalyst: Deliver inciting incident.", "Reaction to catalyst.", "Resist change/doubt path.", "Explore consequences of yes/no.", "Outside force pressure.", "Inner fear/guilt pressure.", "Complicate relations.", "Old life less viable.", "Push toward decision.",
    "Break into Two: Cross threshold.", "B-Story: Intro relationship.", "Relationship reflects theme.", "Show hero's vulnerability.", "Build trust/conflict with B.", "Reveal emotional significance.", "B-story influence choices.", "Strengthen emotional spine.", "Outer vs Inner tension.", "Tie B to protagonist arc.",
    "Deliver premise; fun & games.", "Explore new situation.", "Add novelty & intrigue.", "Small discovery/win.", "Complicate in entertaining way.", "Develop supporters via team.", "Expand world meanings.", "Cost of new path emerges.", "Hero thinks they are adapting.", "Introduce twist or reversal.",
    "Deepen stakes & goals.", "Show emotional avoidance.", "Make premise feel full.", "Build momentum via cause.", "Setback or temptation.", "Tighten antagonistic pressure.", "Stress hero's flaw.", "Set up turning point.", "Make things feel unstable.", "Plot/Emotion ready for mid.",
    "Midpoint: Major revelation.", "Show midpoint aftermath.", "Increase external opposition.", "Increase internal conflict.", "Damage hero's confidence.", "Close off easy options.", "Friction among allies.", "Antagonist gains ground.", "Revisit flaw under pressure.", "Harder-to-avoid consequences.",
    "Strain on B story.", "Hero chooses blindly.", "Escalate emotional cost.", "Remove safety/comfort.", "Increase problem pace.", "Protagonist feels trapped.", "Allow brief hope.", "Undermine/complicate hope.", "Plot strands join for crisis.", "Position for collapse.",
    "All Is Lost: symbolic death.", "Feel weight of failure.", "Strip away ego/illusion.", "Reflect on what went wrong.", "Reconnect crisis to theme.", "Show stakes of no change.", "B story offers comfort.", "Moment of truth.", "Realise true need.", "Prepare breakthrough.",
    "Break into Three: new plan.", "Start push with clarity.", "Gather tools & allies.", "New plan in action.", "Hero acts differently.", "Opposition resistance.", "Apply what's learned.", "Build difficult momentum.", "Supporters' meaningful roles.", "Plot/Stakes collide.",
    "Biggest challenge yet.", "Nearly fail differently.", "Growth matters in action.", "Drive toward climax.", "Central confrontation.", "Resolve external plot.", "Resolve emotional arc.", "Cost, gain, change.", "Tie up remaining threads.", "Final Image: contrast with start."
];

const PROMPTS = ["Character refuses.", "Strange smell.", "Someone watching.", "Tool breaks.", "Hostile weather.", "Secret blurted.", "3-min clock.", "Object found.", "Unexpected knock.", "Sudden silence.", "Worst case.", "Lie revealed.", "Hero sacrifice.", "Power shift.", "5-word flashback.", "Bribe.", "Safe path gone.", "Work with enemy.", "Misdirected msg.", "Fact is false.", "Injury.", "Promise due.", "Weather stakes.", "Hidden door.", "No.", "Followed.", "Fake object.", "Truth page.", "Item vanishes.", "Strength is weakness.", "Animal.", "Unwanted gift.", "Sound-only writing.", "Wrong time.", "Grudge.", "Two evils.", "Motivation shift.", "Talent.", "Core fear.", "Enemy kindness.", "Ally betrayal.", "Leaving all.", "Reality glitch.", "Another's letter.", "Danger request.", "Hiding.", "Secret habit.", "Deja vu.", "Leap of faith.", "Not the hero.", "Calm snap.", "Map to nowhere."];

window.closeOverlay = () => document.getElementById('levelOverlay').classList.add('hidden');

function playLevelUpSound() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'square';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.4);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
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
    initGraph(); updateUI();
}

window.toggleIntel = () => {
    const cont = document.getElementById('intelContainer');
    cont.classList.toggle('hidden');
    document.querySelector('.intel-btn').innerText = cont.classList.contains('hidden') ? "VIEW MICROBEAT TIPS ▾" : "HIDE MICROBEAT TIPS ▴";
};

window.addWords = () => {
    const val = parseInt(document.getElementById('wordIn').value) || 0;
    if (val <= 0) return;
    document.querySelector('.app').classList.add('shake');
    setTimeout(() => document.querySelector('.app').classList.remove('shake'), 400);

    state.total += val;
    state.logs.push({ date: new Date().toISOString().split('T')[0], total: state.total });
    
    const progress = (state.total / state.goal * 100);
    const curIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    
    if (curIdx > state.lastLevel && state.total > 0) {
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
        document.getElementById('rankTitle').innerText = `LEVEL ${idx + 1}: ${RANKS[idx] || "Architect"}`;
        document.getElementById('levelOverlay').classList.remove('hidden');
        sprite.style.transform = ''; 
    }, 600);
}

function updateUI() {
    const progress = (state.total / state.goal) * 100;
    const curIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    const curB = BOSS_BEATS[curIdx] || BOSS_BEATS[0];
    const nxtB = BOSS_BEATS[curIdx + 1] || { pct: 100, name: "The End" };
    const hp = Math.max(0, 100 - ((progress - curB.pct) / ((nxtB.pct - curB.pct) || 1) * 100));
    const microIdx = Math.min(99, Math.floor((state.total / state.goal) * 100));

    document.getElementById('lvlName').innerText = curB.name;
    document.getElementById('bossName').innerText = `You are battling the ${nxtB.name.toUpperCase()} BEAT BOSS!`;
    document.getElementById('bossHPBar').style.width = hp + "%";
    document.getElementById('bossHPText').innerText = `HP: ${Math.floor(hp)}%`;
    document.getElementById('loreBox').innerText = curB.lore;
    document.getElementById('tipsBox').innerText = `STEP ${microIdx + 1}/100: ${MICRO_TIPS[microIdx]}`;

    const s = document.getElementById('bossSprite');
    s.style.animationDuration = `${Math.max(0.1, hp / 100)}s`;
    s.style.borderRadius = progress < 25 ? "0%" : progress < 50 ? "50% 0%" : progress < 75 ? "50%" : "30% 70%";
    if (hp < 30) s.style.marginLeft = `${(Math.random() - 0.5) * 8}px`;

    document.getElementById('hpBar').style.width = Math.min(100, progress) + "%";
    document.getElementById('hpText').innerText = `${state.total.toLocaleString()} / ${state.goal.toLocaleString()} WORDS`;
}

window.getInspiration = () => {
    const b = document.getElementById('inspireBox');
    b.innerText = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    b.classList.remove('hidden');
    setTimeout(() => b.classList.add('hidden'), 6000);
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
