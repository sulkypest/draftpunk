let chart;
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, title: "", genre: "urbanFantasy", goal: 80000, total: 0, 
    logs: [], lastLevel: -1, deadline: "" 
};

const STC_BEATS = [
    { pct: 0, name: "Opening Image", lore: "The 'Before' snapshot. Establish the hero's world and the 'stasis monster'.", tips: "MICROBEAT: Show the protagonist's day-to-day. Contrast this later with the Final Image." },
    { pct: 1, name: "Theme Stated", lore: "A secondary character mentions the life lesson the hero must learn.", tips: "MICROBEAT: The hero should dismiss this advice immediately. They aren't ready to hear it." },
    { pct: 10, name: "Setup", lore: "Explore the hero’s world and introduce the 'A Story' characters.", tips: "MICROBEAT: Plant the seeds of every problem that will blow up in Act 2." },
    { pct: 12, name: "The Catalyst", lore: "The life-changing event that knocks the hero out of their routine.", tips: "MICROBEAT: This must be an external shock. The hero doesn't choose this yet." },
    { pct: 20, name: "The Debate", lore: "The hero hesitates. Can I do this? Is it safe?", tips: "MICROBEAT: Show the fear. This makes the eventual choice to go much more powerful." },
    { pct: 25, name: "Break into Two", lore: "The hero leaves the old world and enters Act 2.", tips: "MICROBEAT: This is a proactive choice. Crossing the threshold into the unknown." },
    { pct: 30, name: "B Story", lore: "Introduce the character who will help the hero learn the theme.", tips: "MICROBEAT: Often a love interest or mentor who sees the world differently than the hero." },
    { pct: 35, name: "Fun & Games", lore: "The 'promise of the premise.' The hero explores the new world.", tips: "MICROBEAT: High energy scenes. This is why the reader picked up the book." },
    { pct: 50, name: "The Midpoint", lore: "Stakes are raised. A false victory or a false defeat.", tips: "MICROBEAT: The 'A' and 'B' stories cross. The hero moves from reacting to acting." },
    { pct: 65, name: "Bad Guys Close In", lore: "The hero's internal flaws begin to cause external disasters.", tips: "MICROBEAT: The pressure mounts. The hero tries to use old habits to solve new problems." },
    { pct: 75, name: "All Is Lost", lore: "The 'whiff of death.' Total defeat.", tips: "MICROBEAT: The hero loses their support system. Everything feels hopeless." },
    { pct: 80, name: "Dark Night", lore: "The hero wallows and finally realizes the lesson (Theme).", tips: "MICROBEAT: The epiphany. The 'aha!' moment where the hero learns how to truly change." },
    { pct: 85, name: "Break into Three", lore: "The hero chooses to act one last time with their new knowledge.", tips: "MICROBEAT: Combining the lesson learned in 'B' to solve the problem in 'A'." },
    { pct: 90, name: "The Finale", lore: "The hero executes the plan. The old flaws are gone.", tips: "MICROBEAT: A multi-step process where the hero proves they have changed." },
    { pct: 100, name: "Final Image", lore: "The 'After' snapshot. Show how much the world has changed.", tips: "MICROBEAT: Visually contrast this with the Opening Image to prove growth." }
];

const PROMPTS = [
    "A character refuses to cooperate.", "Introduce a strange smell or sound.", "Someone is watching from afar.", 
    "A weapon or tool breaks.", "The weather turns hostile.", "A secret is blurted out.", "3-minute ticking clock.", 
    "A lost object is found.", "An unexpected knock at the door.", "Sudden, eerie silence.", "Worst-case scenario happens.",
    "A lie is revealed.", "The hero must make a sacrifice.", "Power dynamic shifts suddenly.", "A painful 5-word flashback.",
    "A bribe is offered.", "The safe path is destroyed.", "Forced to work with an enemy.", "A misdirected message arrives.",
    "A 'fact' is proven false.", "A physical injury slows the pace.", "An old promise is due.", "The weather raises the stakes.",
    "A hidden door is found.", "Someone says 'No' unexpectedly.", "Being followed by a 'friend'.", "An object is a mimic/fake.",
    "Forced truth-telling for a page.", "A key item vanishes.", "Strengths become weaknesses.", "An animal disrupts the scene.",
    "An unwanted gift arrives.", "Lights out: sound-only writing.", "Wrong place, wrong time.", "A grudge is settled.",
    "Choice between two evils.", "Motivation shifts suddenly.", "Hidden talent discovered.", "Facing a core fear.",
    "Kindness from an enemy.", "Betrayal by an ally.", "Leaving everything behind.", "Physics/Reality glitches.",
    "A letter never meant for them.", "Danger request from an old friend.", "Hiding in plain sight.", "Secret habit discovered.",
    "Overwhelming déjà vu.", "A leap of faith.", "Not the hero of this story.", "Calm character snaps.", "A map to nowhere."
];

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
    document.getElementById('bossName').innerText = `You are battling the ${nxtB.name.toUpperCase()} boss!`;
    document.getElementById('bossHPBar').style.width = hp + "%";
    document.getElementById('bossHPText').innerText = `HP: ${Math.floor(hp)}%`;
    document.getElementById('loreBox').innerText = curB.lore;
    document.getElementById('tipsBox').innerText = curB.tips;

    const s = document.getElementById('bossSprite');
    const animSpeed = Math.max(0.1, hp / 100);
    s.style.animationDuration = `${animSpeed}s`;
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
