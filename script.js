let chart;
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, title: "", genre: "urbanFantasy", goal: 80000, total: 0, 
    logs: [], lastLevel: -1, deadline: "" 
};

const BOSS_BEATS = [
    { pct: 0, name: "Opening Image", lore: "The 'Before' snapshot. Establish the hero's world." },
    { pct: 1, name: "Theme Stated", lore: "A character mentions the life lesson the hero must learn." },
    { pct: 10, name: "Setup", lore: "Explore the hero’s world and introduce side characters." },
    { pct: 11, name: "The Catalyst", lore: "The life-changing event that knocks the hero out of their routine." },
    { pct: 12, name: "The Debate", lore: "The hero hesitates. Can I do this? Is it safe?" },
    { pct: 20, name: "Break into Two", lore: "The hero proactive choice to enter the unknown." },
    { pct: 21, name: "B Story", lore: "Introduce the character who helps the hero learn the theme." },
    { pct: 30, name: "Fun & Games", lore: "The 'promise of the premise.' High energy exploration." },
    { pct: 50, name: "The Midpoint", lore: "Stakes raised. False victory or false defeat." },
    { pct: 51, name: "Bad Guys Close In", lore: "Internal and external pressure mounts." },
    { pct: 70, name: "All Is Lost", lore: "The lowest point. The 'whiff of death'." },
    { pct: 71, name: "Dark Night", lore: "The epiphany. The hero learns how to truly change." },
    { pct: 80, name: "Break into Three", lore: "The hero chooses to act with new knowledge." },
    { pct: 81, name: "The Finale", lore: "The final push. Proving growth through action." },
    { pct: 99, name: "Final Image", lore: "The 'After' snapshot. Mirroring the opening." }
];

const MICRO_TIPS = [
    "Introduce the protagonist's normal world; establish tone, genre and atmosphere; hint that something is lacking", // 1 [cite: 8]
    "Show the protagonist's daily routine; establish what they want on the surface", // 2 [cite: 10]
    "Introduce important side characters; begin showing relationships and tension", // 3 [cite: 10]
    "Suggest the deeper need beneath the protagonist's want; show flaws, fears or emotional limitations", // 4 [cite: 10]
    "Introduce the story world more fully; ground the reader in place, rules and stakes", // 5 [cite: 10]
    "Plant future conflicts, secrets or unanswered questions", // 6 [cite: 10]
    "Introduce the theme subtly through action, dialogue or contrast", // 7 [cite: 10]
    "Create growing friction in the normal world; show that the current situation cannot hold forever", // 8 [cite: 10]
    "Make the protagonist feel pressure, discomfort or restlessness", // 9 [cite: 10]
    "Position the story for disruption; make the coming change feel necessary", // 10 [cite: 10]
    "Include a moment, line or exchange that hints at the story's deeper message", // 11 [cite: 12]
    "Deliver the inciting incident; force something to happen that changes the direction of life", // 12 [cite: 14]
    "Show the protagonist reacting emotionally to the catalyst", // 13 [cite: 16]
    "Let them resist change or doubt the path ahead", // 14 [cite: 18]
    "Explore the consequences of saying yes or no", // 15 [cite: 18]
    "Add pressure from outside forces", // 16 [cite: 18]
    "Add pressure from within: fear, guilt, uncertainty or longing", // 17 [cite: 18]
    "Complicate relationships during the hesitation phase", // 18 [cite: 18]
    "Make the old life less viable", // 19 [cite: 18]
    "Push the protagonist toward a decision", // 20 [cite: 18]
    "Make the protagonist choose to enter the new world; cross a threshold", // 21 [cite: 20]
    "Introduce or deepen an important relationship", // 22 [cite: 22]
    "Let this relationship reflect the theme", // 23 [cite: 22]
    "Show the protagonist in a more personal or vulnerable light", // 24 [cite: 22]
    "Build trust, conflict or chemistry with the B-story character", // 25 [cite: 22]
    "Reveal something emotionally significant", // 26 [cite: 22]
    "Let the B story influence the protagonist's choices", // 27 [cite: 22]
    "Strengthen the emotional spine of the novel", // 28 [cite: 22]
    "Create tension or contrast between outer plot and inner life", // 29 [cite: 22]
    "Tie the relationship more firmly to the protagonist's arc", // 30 [cite: 22]
    "Deliver on the premise of the novel; give readers the experience they came for", // 31 [cite: 24]
    "Show the protagonist exploring the new situation", // 32 [cite: 24]
    "Add novelty, energy or intrigue", // 33 [cite: 24]
    "Let the protagonist have a small win or discovery", // 34 [cite: 24]
    "Increase complications in an entertaining way", // 35 [cite: 24]
    "Develop supporting characters through conflict or teamwork", // 36 [cite: 24]
    "Expand the world through meaningful scenes", // 37 [cite: 24]
    "Show the cost of the new path beginning to emerge", // 38 [cite: 26]
    "Let the protagonist believe they are adapting", // 39 [cite: 26]
    "Introduce a twist, obstacle or reversal", // 40 [cite: 26]
    "Deepen stakes and sharpen goals", // 41 [cite: 26]
    "Show emotional growth or emotional avoidance", // 42 [cite: 26]
    "Make the promise of the premise feel full and alive", // 43 [cite: 26]
    "Build momentum through cause and effect", // 44 [cite: 26]
    "Add a meaningful success, setback or temptation", // 45 [cite: 26]
    "Tighten pressure from antagonistic forces", // 46 [cite: 26]
    "Stress the protagonist's flaw or weakness", // 47 [cite: 26]
    "Set up the turning point to come", // 48 [cite: 26]
    "Make things feel intense, vivid and unstable", // 49 [cite: 26]
    "Bring plot and emotion together ready for the midpoint", // 50 [cite: 26]
    "Deliver a major revelation, victory, or defeat; raise stakes permanently", // 51 [cite: 28]
    "Show the aftermath of the midpoint", // 52 [cite: 30]
    "Increase external opposition", // 53 [cite: 30]
    "Increase internal conflict", // 54 [cite: 30]
    "Damage the protagonist's confidence or certainty", // 55 [cite: 30]
    "Begin closing off easy options", // 56 [cite: 30]
    "Create friction among allies or loved ones", // 57 [cite: 30]
    "Show the antagonist or opposing force gaining ground", // 58 [cite: 30]
    "Revisit the protagonist's flaw under pressure", // 59 [cite: 30]
    "Let consequences become harder to avoid", // 60 [cite: 30]
    "Place strain on the B story", // 61 [cite: 30]
    "Make the protagonist choose poorly, blindly or fearfully", // 62 [cite: 30]
    "Escalate the emotional cost", // 63 [cite: 30]
    "Remove safety, certainty or comfort", // 64 [cite: 30]
    "Increase the pace of problems", // 65 [cite: 32]
    "Make the protagonist feel trapped", // 66 [cite: 32]
    "Allow a brief hope, clue or possible solution", // 67 [cite: 32]
    "Undermine that hope or complicate it further", // 68 [cite: 32]
    "Bring plot strands together toward crisis", // 69 [cite: 32]
    "Position the story for collapse", // 70 [cite: 32]
    "Deliver the lowest point; include a loss, revelation or symbolic death", // 71 [cite: 34]
    "Let the protagonist feel the weight of failure", // 72 [cite: 36]
    "Strip away pretence, ego or illusion", // 73 [cite: 36]
    "Let them reflect on what went wrong", // 74 [cite: 36]
    "Reconnect the emotional crisis to the theme", // 75 [cite: 36]
    "Show what they stand to lose if they do not change", // 76 [cite: 36]
    "Allow the B story to offer insight, challenge or comfort", // 77 [cite: 36]
    "Give the protagonist a moment of truth", // 78 [cite: 36]
    "Let them realise what they truly need, not just what they want", // 79 [cite: 36]
    "Prepare the breakthrough", // 80 [cite: 36]
    "Give the protagonist a new understanding or plan; combine A and B story lessons", // 81 [cite: 38]
    "Start the final push with clarity and purpose", // 82 [cite: 40]
    "Gather allies, tools, courage or knowledge", // 83 [cite: 40]
    "Put the new plan into action", // 84 [cite: 40]
    "Show the protagonist acting differently than before", // 85 [cite: 40]
    "Create fresh resistance from the opposition", // 86 [cite: 42]
    "Force the protagonist to apply what they have learned", // 87 [cite: 42]
    "Build momentum through increasingly difficult actions", // 88 [cite: 42]
    "Give supporting characters meaningful roles", // 89 [cite: 42]
    "Let the emotional and plot stakes collide", // 90 [cite: 42]
    "Present the biggest challenge yet", // 91 [cite: 42]
    "Let the protagonist nearly fail again, but differently", // 92 [cite: 42]
    "Show that growth now matters in action, not just thought", // 93 [cite: 42]
    "Drive toward the climax", // 94 [cite: 42]
    "Deliver the central confrontation", // 95 [cite: 42]
    "Resolve the external plot", // 96 [cite: 42]
    "Resolve the emotional arc", // 97 [cite: 42]
    "Show the cost, the gain and what has changed", // 98 [cite: 42]
    "Tie up remaining major threads without overexplaining", // 99 [cite: 42]
    "End with an image, moment or line that reflects change; contrast with opening image" // 100 [cite: 44]
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

    const microIdx = Math.min(99, Math.floor((state.total / state.goal) * 100));

    document.getElementById('lvlName').innerText = curB.name;
    document.getElementById('bossName').innerText = `You are battling the ${nxtB.name.toUpperCase()} boss!`;
    document.getElementById('bossHPBar').style.width = hp + "%";
    document.getElementById('bossHPText').innerText = `HP: ${Math.floor(hp)}%`;
    
    document.getElementById('loreBox').innerText = curB.lore;
    document.getElementById('tipsBox').innerText = `STEP ${microIdx + 1}/100: ${MICRO_TIPS[microIdx]}`;

    const s = document.getElementById('bossSprite');
    s.style.animationDuration = `${Math.max(0.1, hp / 100)}s`;
    
    // Shape Morphing Logic
    if (progress < 25) {
        s.style.borderRadius = "0%"; // Square [cite: 8]
    } else if (progress < 50) {
        s.style.borderRadius = "50% 0% 50% 0%"; // Diamond-ish [cite: 20]
    } else if (progress < 75) {
        s.style.borderRadius = "50%"; // Circle [cite: 28]
    } else {
        s.style.borderRadius = "30% 70% 70% 30% / 30% 30% 70% 70%"; // Blob/Polygon [cite: 34, 44]
    }
    
    s.style.transform = `rotate(${progress * 3.6}deg)`; 
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
