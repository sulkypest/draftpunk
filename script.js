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

// FULL 100 MICROBEATS (Based on 800-word increments for 80k goal)
const MICRO_TIPS = [
    "Introduce the hero in their 'Before' state.", "Show a hint of their internal flaw.", "The environment should feel lived-in.", "Introduce a secondary character early.", "Hint at a desire that's just out of reach.", "Something small goes wrong in the routine.", "A reminder of the hero's past.", "The atmosphere shifts slightly.", "A moment of quiet reflection before the storm.", "A secondary character challenges the hero.",
    "THEME STATED: A minor character says the truth.", "The hero ignores the truth just stated.", "The world is closing in.", "The Catalyst is looming.", "CATALYST: The world changes forever.", "Reaction to the Catalyst.", "The first moment of shock.", "The hero tries to go back to 'normal'.", "The hero realizes normal is gone.", "DEBATE: Should I stay or should I go?",
    "Weighing the risks.", "A friend offers bad advice.", "The hero prepares for the journey.", "Last look at the old world.", "BREAK INTO TWO: Crossing the threshold.", "Arrival in the 'New World'.", "B STORY: A new relationship begins.", "The rules of this world are different.", "First interaction with a New World local.", "A moment of wonder or terror.",
    "FUN & GAMES: Exploring the premise.", "A small victory in the new world.", "The hero shows off a skill.", "The first setback in the new world.", "A moment of humor amidst tension.", "The B-story deepens.", "A new tool or weapon is found.", "The stakes feel manageable but fun.", "The primary antagonist is glimpsed.", "A quiet bonding moment with an ally.",
    "The hero feels overconfident.", "Things start to get more serious.", "The first 'real' injury or loss.", "The path forward becomes narrow.", "Preparation for the Midpoint battle.", "The calm before the storm.", "A secret is whispered.", "The hero doubts their allies.", "The B-story relationship is tested.", "MIDPOINT: A massive shift in stakes.",
    "The hero moves from 'reacting' to 'acting'.", "The ticking clock starts.", "The antagonist makes a move.", "A safe haven is destroyed.", "BAD GUYS CLOSE IN: The pressure mounts.", "Internal conflict ripples through the group.", "The hero makes a difficult choice.", "The B-story is pushed to the side.", "A betrayal is suspected.", "The main goal feels impossible.",
    "The antagonist is one step ahead.", "Resources are running low.", "A character reveals a hidden agenda.", "The hero is physically exhausted.", "The environment becomes hostile.", "Loss of a valuable asset.", "The group begins to fracture.", "An desperate gamble fails.", "The hero is cornered.", "ALL IS LOST: A crushing defeat.",
    "The 'Whiff of Death'.", "DARK NIGHT: Mourning the loss.", "The hero faces their flaw alone.", "A moment of total hopelessness.", "The B-story character offers a new path.", "The hero synthesizes old and new knowledge.", "The actual solution is found.", "Preparation for the final push.", "Gathering the remaining allies.", "BREAK INTO THREE: The plan is set.",
    "The hero marches toward the finale.", "Entering the antagonist's lair.", "FINALE: The first phase of the plan.", "The 'high tower' is breached.", "The antagonist reveals a final trick.", "An ally makes a sacrifice.", "The hero faces the antagonist alone.", "The internal flaw is finally overcome.", "The final blow is struck.", "The antagonist is defeated.",
    "The immediate aftermath.", "Checking on the survivors.", "The B-story is resolved.", "A moment of shared triumph.", "The New World begins to settle.", "The hero reflects on the journey.", "Packing up the tools.", "A look toward the future.", "FINAL IMAGE: The new normal is set.", "THE END."
];

const PROMPTS = ["A secret is blurted out.", "Something breaks.", "An unexpected visitor.", "A sudden change in weather.", "A deadline is moved up.", "A lie is revealed.", "A minor character turns hostile.", "A piece of technology fails.", "A ghost from the past appears."];

function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }

window.start = () => {
    state.title = document.getElementById('titleIn').value || "PROJECT";
    state.goal = parseInt(document.getElementById('goalIn').value) || 80000;
    state.deadline = document.getElementById('deadlineIn').value;
    state.active = true;
    state.total = 0;
    state.logs = [{ date: new Date().toLocaleDateString(), total: 0 }];
    save();
    location.reload(); 
};

window.addWords = () => {
    const val = parseInt(document.getElementById('wordIn').value) || 0;
    if (val <= 0) return;
    const oldTotal = state.total;
    state.total += val;
    state.logs.push({ date: new Date().toLocaleDateString(), total: state.total });

    if (Math.floor(state.total / 5000) > Math.floor(oldTotal / 5000)) {
        const buddyNum = Math.floor(Math.random() * 20) + 1;
        state.inventory.push(`buddy${buddyNum}.png`);
        document.getElementById('newBuddyImg').src = `buddies/buddy${buddyNum}.png`;
        document.getElementById('buddyOverlay').style.display = 'flex';
    }

    const progress = (state.total / state.goal * 100);
    const curIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    if (curIdx > state.lastLevel) {
        state.lastLevel = curIdx;
        document.getElementById('rankTitle').innerText = RANKS[curIdx];
        document.getElementById('levelOverlay').style.display = 'flex';
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
    document.getElementById('bossName').innerText = nxtB.name.toUpperCase();
    document.getElementById('bossHPBar').style.width = hp + "%";
    document.getElementById('bossHPText').innerText = `HP: ${Math.floor(hp)}%`;
    document.getElementById('hpBar').style.width = Math.min(100, progress) + "%";
    document.getElementById('hpText').innerText = `${state.total.toLocaleString()} / ${state.goal.toLocaleString()} WORDS`;
    
    // MICROBEAT LOGIC: Update based on 1% wordcount increments
    document.getElementById('loreBox').innerText = curB.lore;
    const microIdx = Math.min(99, Math.floor(progress));
    document.getElementById('tipsBox').innerText = `Microbeat ${microIdx + 1}: ${MICRO_TIPS[microIdx]}`;

    document.getElementById('bossSprite').src = `bosses/${curIdx+1}${hp <= 25 ? 'd' : hp <= 50 ? 'c' : hp <= 75 ? 'b' : 'a'}.png`;
    document.getElementById('levelIcon').src = `ranks/lvl${curIdx+1}.png`;
    document.getElementById('sideRankDisplay').innerText = `LVL ${curIdx+1}`;
    document.getElementById('sideRankName').innerText = RANKS[curIdx];
    document.getElementById('buddyCountDisplay').innerText = state.inventory.length;

    if (state.deadline) {
        const diff = new Date(state.deadline) - new Date();
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
        document.getElementById('daysLeftDisplay').innerText = days > 0 ? days : "0";
    }

    const gallery = document.getElementById('buddyGallery');
    gallery.innerHTML = state.inventory.map(img => `<img src="buddies/${img}" class="buddy-relic">`).join('');
}

window.showGrenade = () => {
    document.getElementById('inspireText').innerText = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    document.getElementById('grenadeOverlay').style.display = 'flex';
};

window.closeGrenade = () => document.getElementById('grenadeOverlay').style.display = 'none';
window.toggleIntel = () => document.getElementById('intelContainer').classList.toggle('hidden');
window.closeOverlay = () => document.getElementById('levelOverlay').style.display = 'none';
window.closeBuddyOverlay = () => document.getElementById('buddyOverlay').style.display = 'none';
window.resetGame = () => { if(confirm("RESET ALL DATA?")) { localStorage.clear(); location.reload(); } };

function initGraph() {
    const ctx = document.getElementById('velocityChart').getContext('2d');
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: state.logs.map(l => l.date),
            datasets: [{ label: 'Wordcount', data: state.logs.map(l => l.total), borderColor: '#0ff', backgroundColor: 'rgba(0, 255, 255, 0.1)', fill: true, tension: 0.2 }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            scales: {
                y: { grid: { color: '#222' }, ticks: { color: '#666', font: { size: 9 } } },
                x: { grid: { display: false }, ticks: { display: false } } // Hidden ticks to prevent overlap
            },
            plugins: { legend: { display: false } }
        }
    });
}
function updateGraph() { if(chart) { chart.data.labels = state.logs.map(l => l.date); chart.data.datasets[0].data = state.logs.map(l => l.total); chart.update(); } }

window.onload = () => {
    if (state.active) {
        document.getElementById('setup').style.display = 'none';
        document.getElementById('mainDashboard').classList.remove('hidden');
        updateUI(); initGraph();
    }
};
