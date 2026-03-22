let chart;
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, genre: "urbanFantasy", goal: 80000, total: 0, 
    logs: [], lastLevel: -1, deadline: "" 
};

const STC_BEATS = [
    { pct: 0, name: "Opening Image", lore: "The 'Before' snapshot. Establish the hero's world and the 'stasis monster' keeping them there." },
    { pct: 1, name: "Theme Stated", lore: "A secondary character mentions the life lesson the hero must learn. The hero ignores it." },
    { pct: 10, name: "Setup", lore: "Explore the hero’s world and introduce 'A Story' characters. Show what they stand to lose." },
    { pct: 12, name: "The Catalyst", lore: "The telegram, the knock at the door, the change. The world as it was is now gone." },
    { pct: 20, name: "The Debate", lore: "The hero hesitates. Can I do this? Is it safe? This is the last chance to go back." },
    { pct: 25, name: "Break into Two", lore: "The hero makes a choice. They leave the old world and enter the 'upside-down' world of Act 2." },
    { pct: 30, name: "B Story", lore: "Introduce the 'helper' or love interest. This story carries the theme of the book." },
    { pct: 35, name: "Fun & Games", lore: "The 'promise of the premise.' The hero explores the new world. Stakes are still relatively low." },
    { pct: 50, name: "The Midpoint", lore: "Stakes are raised. A false victory or false defeat. No more playing around." },
    { pct: 65, name: "Bad Guys Close In", lore: "Internal or external pressure mounts. The hero's flaws begin to crumble their progress." },
    { pct: 75, name: "All Is Lost", lore: "The 'whiff of death.' Someone dies or the goal seems impossible. Total defeat." },
    { pct: 80, name: "Dark Night", lore: "The hero wallows. They finally realize the theme stated at the beginning. The epiphany." },
    { pct: 85, name: "Break into Three", lore: "The hero realizes how to solve the problem and chooses to act one last time." },
    { pct: 90, name: "The Finale", lore: "The hero executes the plan. The old flaws are gone. A and B stories wrap up." },
    { pct: 100, name: "Final Image", lore: "The 'After' snapshot. Show how much the world has changed since the start." }
];

const PROMPTS = [
    "A character suddenly refuses to do what they were told.", "Introduce a physical sensation: a smell, a chill, or a noise.",
    "Someone is watching from a distance—who and why?", "A piece of equipment or a weapon fails at the worst moment.",
    "The environment becomes hostile: a leak, a storm, or a blackout.", "A secret is accidentally blurted out in mid-argument.",
    "A ticking clock: they have exactly 3 minutes to decide.", "A character finds a lost object that changes their perspective.",
    "An unexpected visitor knocks or intercepts a message.", "Total silence: Why has a normally loud character stopped talking?",
    "Worst-case scenario: Whatever they feared most happens now.", "A secondary character reveals a hidden agenda or a lie.",
    "The protagonist must make a sacrifice to move forward.", "A sudden change in the power dynamic: the leader is now the follower.",
    "Flashback: 10 words or less of a memory that hurts.", "Someone offers a bribe that is almost too good to pass up.",
    "The 'safe' path is suddenly blocked or destroyed.", "A character is forced to work with their enemy to survive.",
    "A message arrives, but it’s intended for someone else.", "The protagonist realizes they were wrong about a 'fact' since page 1.",
    "A physical injury slows them down—how do they compensate?", "An old promise is called in at an inconvenient time.",
    "The weather changes the stakes of the current scene.", "A character discovers a hidden door, literal or metaphorical.",
    "Someone says 'No' when they were expected to say 'Yes'.", "A character discovers they are being followed by someone they trust.",
    "An object in the room is not what it seems.", "A character is forced to tell the truth for one minute.",
    "A sudden, unexplained disappearance of a key item.", "The protagonist's greatest strength becomes their greatest weakness.",
    "An animal enters the scene and disrupts the tension.", "A character receives a gift they didn't want.",
    "The lights go out. Write the next 100 words using only sound.", "A character realizes they are in the wrong place at the wrong time.",
    "A long-held grudge is finally settled—violently or verbally.", "A character is forced to make a choice between two equally bad options.",
    "A sudden shift in the protagonist's motivation.", "A character discovers a hidden talent they didn't know they had.",
    "A character is forced to face their greatest fear.", "A sudden, unexpected act of kindness from an enemy.",
    "A character realizes they have been betrayed by their closest ally.", "A character is forced to leave everything behind.",
    "A sudden, unexplained change in the laws of physics or reality.", "A character finds a letter they were never meant to read.",
    "An old friend reappears with a dangerous request.", "The protagonist is forced to hide in plain sight.",
    "A character's secret habit is discovered by the wrong person.", "A sudden, overwhelming feeling of déjà vu.",
    "The protagonist is forced to take a leap of faith.", "A character realizes they are not the hero of this story.",
    "A sudden, violent outburst from a normally calm character.", "The protagonist finds a map that leads to nowhere."
];

window.closeOverlay = () => document.getElementById('levelOverlay').classList.add('hidden');
window.onload = () => { if (state.active) showGame(); };

window.startQuest = () => {
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
    document.getElementById('setup').classList.add('hidden');
    document.getElementById('game').classList.remove('hidden');
    initGraph();
    updateUI();
}

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
    document.getElementById('bossName').innerText = `VS: ${nxtB.name}`;
    document.getElementById('bossHPBar').style.width = hp + "%";
    document.getElementById('bossHPText').innerText = `HP: ${Math.floor(hp)}%`;
    document.getElementById('loreBox').innerText = curB.lore;

    const s = document.getElementById('bossSprite');
    const animSpeed = Math.max(0.1, hp / 100);
    s.style.animationDuration = `${animSpeed}s`;
    s.style.transform = `rotate(${curIdx * 24}deg)`;
    s.style.borderRadius = `${(curIdx / 15) * 50}%`;
    if (hp < 30) {
        s.style.marginLeft = `${(Math.random() - 0.5) * 10}px`;
    }

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
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { beginAtZero: true, grid: { color: '#222' } } } }
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
