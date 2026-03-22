let chart;
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, title: "", genre: "urbanFantasy", goal: 80000, total: 0, 
    logs: [], lastLevel: -1, deadline: "" 
};

// 15 Major Boss Beats
const BOSS_BEATS = [
    { pct: 0, name: "Opening Image", lore: "The 'Before' snapshot. Establish the hero's world." },
    { pct: 1, name: "Theme Stated", lore: "A character mentions the life lesson the hero must learn." },
    { pct: 10, name: "Setup", lore: "Explore the hero’s world and introduce 'A Story' characters." },
    { pct: 12, name: "The Catalyst", lore: "The life-changing event that knocks the hero out of their routine." },
    { pct: 20, name: "The Debate", lore: "The hero hesitates. Can I do this? Is it safe?" },
    { pct: 25, name: "Break into Two", lore: "The hero proactive choice to enter the unknown." },
    { pct: 30, name: "B Story", lore: "Introduce the character who helps the hero learn the theme." },
    { pct: 35, name: "Fun & Games", lore: "The 'promise of the premise.' High energy exploration." },
    { pct: 50, name: "The Midpoint", lore: "Stakes raised. False victory or false defeat." },
    { pct: 65, name: "Bad Guys Close In", lore: "Internal and external pressure mounts." },
    { pct: 75, name: "All Is Lost", lore: "The lowest point. The 'whiff of death'." },
    { pct: 80, name: "Dark Night", lore: "The epiphany. The hero learns how to truly change." },
    { pct: 85, name: "Break into Three", lore: "The hero chooses to act with new knowledge." },
    { pct: 90, name: "The Finale", lore: "The final push. Proving growth through action." },
    { pct: 100, name: "Final Image", lore: "The 'After' snapshot. Mirroring the opening." }
];

// 100 Microbeats from PDF
const MICRO_TIPS = [
    "Intro protagonist's normal world; establish tone/genre.", "Show daily routine; establish surface wants.", "Intro side characters; show relationships/tension.", "Suggest deeper need; show flaws or limitations.", "Ground the reader in place, rules, and stakes.", "Plant future secrets or unanswered questions.", "Intro the theme subtly through action.", "Create friction; show the normal world can't hold.", "Protagonist feels pressure or restlessness.", "Position story for disruption; change is necessary.",
    "Hint at story message; challenge hero's worldview.", "The Catalyst: deliver the inciting incident.", "Hero reacting emotionally to the catalyst.", "Hero resists change or doubts the path ahead.", "Explore consequences of saying yes or no.", "Add pressure from outside forces.", "Add pressure from within: fear or guilt.", "Complicate relationships during hesitation.", "Make the old life less viable.", "Push protagonist toward a decision.",
    "Break into Two: cross the threshold.", "B-Story: Intro/deepen important relationship.", "Let the relationship reflect the theme.", "Show hero in a more personal/vulnerable light.", "Build trust or conflict with B-story character.", "Reveal something emotionally significant.", "B-story influences protagonist's choices.", "Strengthen the emotional spine of the novel.", "Contrast outer plot and inner life.", "Tie relationship firmly to protagonist's arc.",
    "Deliver on the novel's premise/Fun & Games.", "Protagonist exploring the new situation.", "Add novelty, energy, or intrigue.", "Give hero a small win or discovery.", "Increase complications in entertaining ways.", "Develop supporters through teamwork.", "Expand world through meaningful scenes.", "Cost of the new path begins to emerge.", "Hero believes they are adapting.", "Introduce a twist, obstacle, or reversal.",
    "Deepen stakes and sharpen goals.", "Show emotional growth or avoidance.", "Make the premise feel full and alive.", "Build momentum through cause and effect.", "Add a meaningful success or setback.", "Tighten pressure from antagonistic forces.", "Stress the hero's flaw or weakness.", "Set up the turning point to come.", "Make things feel intense and unstable.", "Bring plot/emotion together for midpoint.",
    "Midpoint: major revelation or stake raise.", "Show the aftermath of the midpoint.", "Increase external opposition.", "Increase internal conflict.", "Damage the hero's confidence.", "Begin closing off easy options.", "Create friction among allies.", "Antagonist/Opposing force gaining ground.", "Revisit protagonist's flaw under pressure.", "Consequences become harder to avoid.",
    "Place strain on the B-story.", "Hero chooses poorly or blindly.", "Escalate the emotional cost.", "Remove safety or comfort.", "Increase the pace of problems.", "Protagonist feels trapped.", "Allow a brief hope or clue.", "Undermine that hope or complicate it.", "Bring plot strands together toward crisis.", "Position the story for collapse.",
    "All Is Lost: Lowest point/symbolic death.", "Hero feels the weight of failure.", "Strip away pretense, ego, or illusion.", "Hero reflects on what went wrong.", "Reconnect emotional crisis to theme.", "Show what they lose if they don't change.", "B-story offers insight or comfort.", "Give protagonist a moment of truth.", "Hero realizes what they truly need.", "Prepare the breakthrough.",
    "Break into Three: new understanding/plan.", "Start the final push with clarity.", "Gather allies, tools, and courage.", "Put the new plan into action.", "Hero acting differently than before.", "Fresh resistance from the opposition.", "Hero applies what they've learned.", "Build momentum through difficult actions.", "Supporting characters get meaningful roles.", "Emotional and plot stakes collide.",
    "Present the biggest challenge yet.", "Hero nearly fails again, but differently.", "Growth now matters in action, not thought.", "Drive toward the climax.", "Deliver the central confrontation.", "Resolve the external plot.", "Resolve the emotional arc.", "Show cost, gain, and what has changed.", "Tie up threads without overexplaining.", "Final Image: end with a moment of change."
];

const PROMPTS = ["A character refuses to cooperate.", "Introduce a strange smell.", "Someone watching from afar.", "A tool breaks.", "Weather turns hostile.", "Secret blurted out.", "3-min ticking clock.", "Lost object found.", "Unexpected knock.", "Sudden silence.", "Worst case happens.", "Lie revealed.", "Hero must sacrifice.", "Power shift.", "5-word flashback.", "Bribe offered.", "Safe path destroyed.", "Work with enemy.", "Misdirected message.", "Fact is false.", "Physical injury.", "Old promise due.", "Weather stakes.", "Hidden door.", "Unexpected 'No'.", "Followed by friend.", "Object is fake.", "Truth-telling page.", "Item vanishes.", "Strength is weakness.", "Animal disruption.", "Unwanted gift.", "Sound-only writing.", "Wrong time.", "Grudge settled.", "Two evils choice.", "Motivation shift.", "Hidden talent.", "Facing fear.", "Enemy kindness.", "Ally betrayal.", "Leaving everything.", "Reality glitch.", "Letter for another.", "Friend request.", "Hidden in plain sight.", "Secret habit.", "Déjà vu.", "Leap of faith.", "Not the hero.", "Calm character snaps.", "Map to nowhere."];

window.closeOverlay = () => document.getElementById('levelOverlay').classList.add('hidden');
window.onload = () => { if (state.active) showGame(); };

window.startQuest = () => {
    state.title = document.getElementById('titleIn').value || "UNTITLED WIP";
    state.genre = document.getElementById('genreIn').value;
    state.goal = parseInt(document.getElementById('goalIn').value) || 80000;
    state.deadline = document.getElementById('deadlineIn').value;
    state.active = true;
    state.total = 0;
    state.lastLevel = 0;
    state.logs = [{ date: new Date().toISOString().split('T')[0], total: 0 }];
    save();
    showGame();
};

function showGame() {
    document.body.className = `skin-${state.genre}`;
    document.getElementById('wipDisplay').innerText = state.title;
    document.getElementById('setup').classList.add('hidden');
    document.getElementById('game').classList.remove('hidden');
    initGraph();
    updateUI();
}

window.toggleIntel = () => {
    const cont = document.getElementById('intelContainer');
    cont.classList.toggle('hidden');
    document.querySelector('.intel-btn').innerText = cont.classList.contains('hidden') ? "VIEW MICROBEAT TIPS ▾" : "HIDE MICROBEAT TIPS ▴";
};

window.addWords = () => {
    const val = parseInt(document.getElementById('wordIn').value) || 0;
    if (val <= 0) return;
    if ("vibrate" in navigator) navigator.vibrate(50);
    document.querySelector('.app').classList.add('shake');
    setTimeout(() => document.querySelector('.app').classList.remove('shake'), 400);

    state.total += val;
    state.logs.push({ date: new Date().toISOString().split('T')[0], total: state.total });
    
    const progress = (state.total / state.goal * 100);
    const curIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    
    if (curIdx > state.lastLevel && state.total > 0) {
        state.lastLevel = curIdx;
        document.getElementById('newLevelName').innerText = BOSS_BEATS[curIdx].name;
        document.getElementById('levelOverlay').classList.remove('hidden');
    }
    document.getElementById('wordIn').value = "";
    save();
    updateUI();
    updateGraph();
};

function updateUI() {
    const progress = (state.total / state.goal) * 100;
    const curIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    const curB = BOSS_BEATS[curIdx] || BOSS_BEATS[0];
    const nxtB = BOSS_BEATS[curIdx + 1] || { pct: 100, name: "The End" };
    const hp = Math.max(0, 100 - ((progress - curB.pct) / ((nxtB.pct - curB.pct) || 1) * 100));

    // Calculate current Microbeat Tip (1 of 100)
    const microIdx = Math.min(99, Math.floor((state.total / state.goal) * 100));

    document.getElementById('lvlName').innerText = curB.name;
    document.getElementById('bossName').innerText = `You are battling the ${nxtB.name.toUpperCase()} boss!`;
    document.getElementById('bossHPBar').style.width = hp + "%";
    document.getElementById('bossHPText').innerText = `HP: ${Math.floor(hp)}%`;
    
    document.getElementById('loreBox').innerText = curB.lore;
    document.getElementById('tipsBox').innerText = `STEP ${microIdx + 1}: ${MICRO_TIPS[microIdx]}`;

    const s = document.getElementById('bossSprite');
    s.style.animationDuration = `${Math.max(0.1, hp / 100)}s`;
    s.style.transform = `rotate(${curIdx * 24}deg)`;
    s.style.borderRadius = `${(curIdx / 15) * 50}%`;
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
    const days = Math.max(1, (end - start) / 86400000);
    const rate = state.goal / days;
    return state.logs.map(log => {
        const diff = (new Date(log.date) - start) / 86400000;
        return Math.floor(diff * rate);
    });
}

function updateGraph() { if(chart) { chart.data.labels = state.logs.map(l => l.date); chart.data.datasets[0].data = state.logs.map(l => l.total); chart.data.datasets[1].data = getTargetData(); chart.update(); } }
function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }
window.resetGame = () => { if(confirm("REBOOT SYSTEM?")) { localStorage.clear(); location.reload(); }};
