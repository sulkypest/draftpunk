import { CONFIG } from './data.js';

let chart;
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, genre: "urbanFantasy", goal: 80000, total: 0, 
    gold: 0, xp: 0, logs: [], lastLevel: -1, deadline: "" 
};

const STC_BEATS = [
    { pct: 0, name: "Opening Image", tasks: ["Establish tone/mood", "Show the 'before' world", "Highlight the hero's flaw"] },
    { pct: 1, name: "Theme Stated", tasks: ["Someone mentions the 'lesson'", "Hidden in plain dialogue", "The core philosophical question"] },
    { pct: 10, name: "Setup", tasks: ["Introduce secondary cast", "Show the hero's 'stasis'", "Hint at what's missing"] },
    { pct: 12, name: "The Catalyst", tasks: ["The life-changing event", "Hero's world is upended", "No going back"] },
    { pct: 20, name: "The Debate", tasks: ["Hero doubts themselves", "Gathering supplies/info", "The final 'push' into adventure"] },
    { pct: 25, name: "Break into Two", tasks: ["The hero chooses to act", "Leaving the ordinary world", "Entering the 'upside down'"] },
    { pct: 30, name: "B Story", tasks: ["Introduce the love interest/mentor", "New character represents the theme", "A breather from the A-plot"] },
    { pct: 35, name: "Fun & Games", tasks: ["Deliver on the 'premise'", "Action scenes or romantic banter", "Hero is either winning or failing spectacularly"] },
    { pct: 50, name: "The Midpoint", tasks: ["Stakes are raised", "A false victory or false defeat", "The 'ticking clock' starts"] },
    { pct: 65, name: "Bad Guys Close In", tasks: ["Villain gets the upper hand", "Internal team conflict", "Hero's flaw causes a mistake"] },
    { pct: 75, name: "All Is Lost", tasks: ["The 'Whiff of Death'", "Hero loses a mentor/friend", "Everything seems impossible"] },
    { pct: 80, name: "Dark Night", tasks: ["Hero hits rock bottom", "Mourning the loss", "The 'aha!' moment of truth"] },
    { pct: 85, name: "Break into Three", tasks: ["A new plan is formed", "A-plot and B-plot collide", "Hero fixes their flaw"] },
    { pct: 90, name: "The Finale", tasks: ["The final showdown", "Executing the new plan", "The villain is defeated"] },
    { pct: 100, name: "Final Image", tasks: ["The 'after' world", "Show how the hero changed", "Close the thematic loop"] }
];

// CRITICAL: This must be window.X to be clickable from HTML
window.closeOverlay = function() {
    const ov = document.getElementById('levelOverlay');
    if(ov) ov.classList.add('hidden');
};

window.onload = () => { 
    if (state.active) {
        showGame(); 
        // Force hide overlay on load so it doesn't block the start
        window.closeOverlay();
    }
};

window.startQuest = () => {
    state.genre = document.getElementById('genreIn').value;
    state.goal = parseInt(document.getElementById('goalIn').value) || 80000;
    state.deadline = document.getElementById('deadlineIn').value;
    state.active = true;
    state.total = 0;
    state.lastLevel = 0; // Starts at 0, won't trigger until next beat
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

    if ("vibrate" in navigator) navigator.vibrate(60); 
    document.querySelector('.app').classList.add('shake');
    setTimeout(() => document.querySelector('.app').classList.remove('shake'), 400);

    state.total += val;
    state.xp += val;
    state.gold += Math.floor(val / 5);
    state.logs.push({ date: new Date().toISOString().split('T')[0], total: state.total });
    
    const progress = (state.total / state.goal * 100);
    const currentSTCIndex = STC_BEATS.findLastIndex(b => progress >= b.pct);
    
    // Trigger ONLY if we pass a new threshold and words > 0
    if (currentSTCIndex > state.lastLevel && state.total > 0) {
        state.lastLevel = currentSTCIndex;
        triggerLevelUp(STC_BEATS[currentSTCIndex].name);
    }

    document.getElementById('wordIn').value = "";
    save();
    updateUI();
    updateGraph();
};

function triggerLevelUp(name) {
    if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
    const overlay = document.getElementById('levelOverlay');
    document.getElementById('newLevelName').innerText = name;
    overlay.classList.remove('hidden');
}

function initGraph() {
    const ctx = document.getElementById('velocityChart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: state.logs.map(l => l.date),
            datasets: [
                { label: 'Words', data: state.logs.map(l => l.total), borderColor: '#00ffff', backgroundColor: 'rgba(0, 255, 255, 0.1)', fill: true, tension: 0.3 },
                { label: 'Target', data: getTargetData(), borderColor: 'rgba(255, 215, 0, 0.3)', borderDash: [5,5], pointRadius: 0 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
}

function getTargetData() {
    if (!state.deadline || state.logs.length === 0) return [];
    const start = new Date(state.logs[0].date);
    const end = new Date(state.deadline);
    const totalDays = Math.max(1, (end - start) / 86400000);
    const dailyRate = state.goal / totalDays;

    return state.logs.map(log => {
        const elapsed = (new Date(log.date) - start) / 86400000;
        return Math.floor(elapsed * dailyRate);
    });
}

function updateUI() {
    const progress = (state.total / state.goal) * 100;
    const stcIndex = STC_BEATS.findLastIndex(b => progress >= b.pct);
    const currentSTC = STC_BEATS[stcIndex] || STC_BEATS[0];
    const nextSTC = STC_BEATS[stcIndex + 1] || { pct: 100, name: "THE END" };
    
    const beatRange = (nextSTC.pct - currentSTC.pct) || 1;
    const bossHP = Math.max(0, 100 - ((progress - currentSTC.pct) / beatRange * 100));

    document.getElementById('lvlName').innerText = currentSTC.name;
    document.getElementById('bossName').innerText = nextSTC.name;
    document.getElementById('bossHPBar').style.width = bossHP + "%";
    document.getElementById('bossHPText').innerText = Math.floor(bossHP) + "%";
    document.getElementById('hpBar').style.width = Math.min(100, progress) + "%";
    document.getElementById('hpText').innerText = `${state.total.toLocaleString()} / ${state.goal.toLocaleString()} WORDS`;
    document.getElementById('goldVal').innerText = state.gold;
    document.getElementById('xpVal').innerText = state.xp;

    const sprite = document.getElementById('bossSprite');
    sprite.style.borderRadius = `${stcIndex * 10}%`;
    sprite.style.transform = `scale(${0.5 + (bossHP/200)}) rotate(${stcIndex * 15}deg)`;

    document.getElementById('stcList').innerHTML = currentSTC.tasks
        .map(t => `<div class='check-item'><input type='checkbox'><span>${t}</span></div>`).join('');
}

function updateGraph() { if(chart) { chart.data.labels = state.logs.map(l => l.date); chart.data.datasets[0].data = state.logs.map(l => l.total); chart.data.datasets[1].data = getTargetData(); chart.update(); } }
function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }
window.resetGame = () => { if(confirm("WIPE SYSTEM?")) { localStorage.clear(); location.reload(); }};
