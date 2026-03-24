let chart;
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, title: "", goal: 80000, total: 0, genre: "urbanFantasy",
    logs: [], lastLevel: 0, deadline: "", inventory: [] 
};

const GENRE_STYLES = {
    urbanFantasy: "#0ff", sciFi: "#0fa", fantasy: "#ffd700", horror: "#ff0000",
    cyberpunk: "#f0f", crimeNoir: "#708090", romance: "#ff69b4", thriller: "#ffa500", western: "#cd7f32"
};

const RANKS = ["Scrivener", "Ink-Stained", "Plot-Hound", "Draft-Punk", "Scene-Slasher", "Chapter-Boss", "Word-Runner", "Arc-Architect", "Prose-Pilot", "Theme-Weaver", "Story-Sorcerer", "Narrative-Knight", "Manuscript-Mage", "World-Builder", "The Scribe-anator"];

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
    "A phone rings—it's someone who shouldn't have the number.",
    "A sudden discovery: a hidden compartment or a deleted file.",
    "A character is caught in a blatant lie about their whereabouts.",
    "A power outage hits at the worst possible moment.",
    "An unexpected visitor arrives with a warrant or a warning.",
    "The hero realizes they are being followed by a black sedan.",
    "A secondary character reveals a secret that changes the goal.",
    "The weather turns violent, forcing characters into a tight space.",
    "An anonymous tip arrives via a blood-stained note.",
    "The hero loses a vital item: a key, a weapon, or a piece of ID.",
    "A ghost from the past appears in a smoky bar or crowded street.",
    "An explosion or loud crash occurs nearby, but out of sight.",
    "The hero is offered a bribe they actually desperately need.",
    "The deadline is moved up—they have half the time they thought.",
    "The antagonist sends a 'gift' that is actually a direct threat.",
    "A trusted ally is caught communicating with the enemy.",
    "The protagonist's internal flaw causes a public embarrassment.",
    "A law enforcement officer starts asking too many questions.",
    "Someone collapses or falls ill, demanding immediate attention.",
    "The hero discovers the person they trust most is an impostor.",
    "A weapon is found hidden in the hero's own belongings.",
    "A siren wails in the distance, getting closer every second.",
    "The 'safe house' is revealed to be a trap.",
    "A character suddenly defects to the other side.",
    "An old debt is called in by a dangerous creditor.",
    "A piece of evidence is destroyed right before it can be used.",
    "The hero is framed for a crime they were trying to solve.",
    "A mentor figure reveals they were the cause of the problem.",
    "The hero is drugged or poisoned and must find an antidote.",
    "A romantic interest is kidnapped or held hostage.",
    "A key witness is found dead just as they were about to speak.",
    "The hero discovers a map that leads somewhere unexpected.",
    "A character previously thought dead reappears with a grudge.",
    "The hero's reputation is publicly ruined by a leak.",
    "A massive bribe is offered to the hero's closest friend.",
    "A secret society's symbol is found on a familiar object.",
    "The hero is given 10 minutes to make an impossible choice.",
    "A character starts speaking in a language they shouldn't know.",
    "An ambush occurs in a place the hero thought was neutral ground.",
    "The hero finds a photo of themselves from a time they don't remember.",
    "A secondary character is revealed to be a secret billionaire or royalty.",
    "The hero wakes up in a place they've never been before.",
    "A character's true identity is revealed by a scar or tattoo.",
    "The hero is forced to team up with their worst enemy.",
    "A message is written in blood on the hero's bathroom mirror.",
    "The hero's bank accounts are suddenly drained to zero.",
    "A character hands the hero a heavy briefcase and runs away.",
    "The hero is mistaken for a famous assassin or target.",
    "An item the hero has carried all along begins to glow or vibrate.",
    "A character reveals they are dying and has one final request.",
    "The hero finds a recording of their own voice saying something they don't recall."
];

const MICRO_TIPS = [
    "0%: Hook the reader in the first paragraph with a strong 'Voice'.",
    "1%: Establish the 'Stasis'—what is the hero's boring, daily life?",
    "2%: Show, don't tell, the hero's primary character flaw.",
    "3%: Hint at an internal 'Shame' the hero is hiding.",
    "4%: Introduce a minor antagonist or annoyance in the 'Normal World'.",
    "5%: Give the hero a small 'Win' to make them likable.",
    "6%: Establish the 'Stakes'—what happens if things NEVER change?",
    "7%: Sensory Detail: What does the hero's home smell like?",
    "8%: Introduce the first 'Herald'—someone who hints at change.",
    "9%: Show a moment of the hero's unique expertise.",
    "10%: SETUP: The world feels too small for the hero now.",
    "11%: Contrast the hero's internal desire with their external need.",
    "12%: CATALYST: The world-changing event must be undeniable.",
    "13%: Reaction: The hero must be reeling from the Catalyst.",
    "14%: The 'New Reality' starts to sink in.",
    "15%: The first moment of genuine fear or wonder.",
    "16%: DEBATE: Why is the hero the WRONG person for this job?",
    "17%: Show the hero trying to go back to their old life.",
    "18%: A secondary character argues for the 'Call to Adventure'.",
    "19%: The hero makes a choice based on fear, not courage.",
    "20%: The 'Point of No Return' is sighted.",
    "21%: One last look at the 'Normal World' before it burns.",
    "22%: A symbolic crossing—a bridge, a door, a border.",
    "23%: The hero enters the 'Special World'—everything is different.",
    "24%: The hero fails their first small test in the new world.",
    "25%: BREAK INTO TWO: The journey officially begins.",
    "26%: B-STORY: Introduce the character who represents the theme.",
    "27%: The B-Story character should clash with the hero's ego.",
    "28%: First 'Fish out of Water' moment.",
    "29%: Establish the new 'Rules' of this environment.",
    "30%: FUN & GAMES: The hero enjoys their new power or world.",
    "31%: A scene that delivers on the 'Promise of the Premise'.",
    "32%: The hero makes their first new friend.",
    "33%: A moment of levity before the tension ramps up.",
    "34%: The hero achieves a minor, 'False' success.",
    "35%: The antagonist is revealed to be closer than thought.",
    "36%: Deepen the B-Story relationship.",
    "37%: The hero ignores a warning sign.",
    "38%: A training sequence or a moment of learning.",
    "39%: The 'Bad Guys' start to organize.",
    "40%: A subplot begins to intersect with the main plot.",
    "41%: The hero faces a moral dilemma.",
    "42%: Show the antagonist's perspective or power.",
    "43%: A moment of rest that reveals character depth.",
    "44%: The hero starts to change their mind about the theme.",
    "45%: Tension check: Is the pacing moving too slow?",
    "46%: A secret about the B-Story character is hinted at.",
    "47%: The hero's flaw causes a rift in the team.",
    "48%: The 'False Victory' or 'False Defeat' is looming.",
    "49%: Quiet before the storm.",
    "50%: MIDPOINT: A massive revelation shifts the goal.",
    "51%: The stakes shift from 'Survival' to 'Sacrifice'.",
    "52%: The ticking clock is introduced or accelerated.",
    "53%: The hero takes their first proactive (not reactive) step.",
    "54%: The antagonist strikes back harder than expected.",
    "55%: A secondary character is lost or incapacitated.",
    "56%: The hero has to do something they find 'immoral'.",
    "57%: Internal monologue: The hero realizes they can't go back.",
    "58%: The 'Bad Guys Close In' from within.",
    "59%: Jealousy or doubt ripples through the hero's allies.",
    "60%: The hero's primary weapon or skill fails them.",
    "61%: A moment of extreme physical or emotional isolation.",
    "62%: The antagonist offers a tempting 'Easy Way Out'.",
    "63%: The hero rejects the 'Easy Way' but pays a price.",
    "64%: The B-Story character is in direct danger.",
    "65%: A piece of the hero's 'Mask' is ripped away.",
    "66%: The 'Safe Haven' is destroyed.",
    "67%: A betrayal by a minor character.",
    "68%: The hero is forced to lead when they don't want to.",
    "69%: The 'Plan' starts to fall apart completely.",
    "70%: Total pressure: No time left for second-guessing.",
    "71%: The hero faces their greatest fear.",
    "72%: The 'Bad Guys' win a major battle.",
    "73%: The hero is stripped of all resources.",
    "74%: Darkness: The hero is at their most vulnerable.",
    "75%: ALL IS LOST: The 'Whiff of Death' moment.",
    "76%: A mentor or guide is gone.",
    "77%: DARK NIGHT: The hero admits their flaw out loud.",
    "78%: The hero mourns the life they thought they'd have.",
    "79%: A small spark of hope from the B-Story character.",
    "80%: The 'Aha!' moment—the hero sees the 'Third Way'.",
    "81%: BREAK INTO THREE: Re-gathering the scattered pieces.",
    "82%: The hero apologizes to those they hurt.",
    "83%: A 'Suicide Mission' plan is formed.",
    "84%: The hero finally embraces the Theme.",
    "85%: FINALE: Storming the castle / Facing the truth.",
    "86%: The 'High Tower' obstacle—a physical manifestation of the flaw.",
    "87%: The hero's allies each get a moment to shine.",
    "88%: The hero faces the antagonist's 'final form'.",
    "89%: A sacrifice is required to move forward.",
    "90%: The 'Final Battle' is won through character growth, not just force.",
    "91%: The hero's flaw is finally, fully shed.",
    "92%: The immediate physical aftermath of the climax.",
    "93%: The hero helps a survivor.",
    "94%: A moment of silence to let the ending breathe.",
    "95%: The 'New Normal'—show how the hero has changed.",
    "96%: A callback to the 'Opening Image' showing the difference.",
    "97%: The B-Story payoff: A hug, a word, or a goodbye.",
    "98%: Final Image: A visual metaphor for the story's theme.",
    "99%: The lingering question or the final sense of peace.",
    "100%: THE END: You've finished the draft. Type 'End' and celebrate."
];

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
        document.getElementById('bossBeatTitle').innerText = BOSS_BEATS[newIdx].name;
        document.getElementById('levelOverlay').style.display = 'flex';
    }

    if (Math.floor(state.total / 5000) > Math.floor((state.total - val) / 5000)) {
        state.inventory.push(`buddy${Math.floor(Math.random() * 20) + 1}.png`);
        document.getElementById('buddyOverlay').style.display = 'flex';
    }

    save(); updateUI(); updateGraph();
    document.getElementById('wordIn').value = "";
};

function updateUI() {
    const color = GENRE_STYLES[state.genre] || "#0ff";
    document.documentElement.style.setProperty('--neon', color);
    
    const progress = (state.total / state.goal) * 100;
    const curIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    const curB = BOSS_BEATS[curIdx] || BOSS_BEATS[0];
    const nxtB = BOSS_BEATS[curIdx+1] || {pct: 100, name: "The End"};
    
    const beatSpan = nxtB.pct - curB.pct;
    const progressInBeat = progress - curB.pct;
    const hp = Math.max(0, 100 - (progressInBeat / (beatSpan || 1) * 100));

    document.getElementById('wipDisplay').innerText = state.title;
    document.getElementById('lvlName').innerText = "BEAT " + (curIdx + 1) + ": " + curB.name;
    document.getElementById('bossName').innerText = nxtB.name;
    document.getElementById('bossHPBar').style.width = hp + "%";
    document.getElementById('hpBar').style.width = Math.min(100, progress) + "%";
    document.getElementById('hpText').innerText = state.total.toLocaleString() + " / " + state.goal.toLocaleString();
    
    document.getElementById('loreBox').innerText = curB.lore;
    
    const tipIndex = Math.min(100, Math.floor(progress));
    document.getElementById('tipsBox').innerText = MICRO_TIPS[tipIndex];

    const suffix = hp <= 25 ? 'd' : hp <= 50 ? 'c' : hp <= 75 ? 'b' : 'a';
    document.getElementById('bossSprite').src = `bosses/${curIdx + 1}${suffix}.png`;

    document.getElementById('sideRankName').innerText = (RANKS[curIdx] || "LEGEND").toUpperCase();
    document.getElementById('buddyCountDisplay').innerText = state.inventory.length;
    document.getElementById('buddyGallery').innerHTML = state.inventory.map(i => `<img src="buddies/${i}" class="buddy-relic">`).join('');

    if (state.deadline) {
        const diff = new Date(state.deadline) - new Date();
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
        document.getElementById('daysLeftDisplay').innerText = days > 0 ? days : "0";
    }
}

function initGraph() {
    const ctx = document.getElementById('velocityChart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: state.logs.map(l => l.date),
            datasets: [{ data: state.logs.map(l => l.total), borderColor: GENRE_STYLES[state.genre], tension: 0.2, fill: false }]
        },
        options: { 
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { ticks: { color: '#444' } } }
        }
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
window.closeBuddyOverlay = function() { document.getElementById('buddyOverlay').style.display = 'none'; };
window.resetGame = function() { if(confirm("Clear all data?")) { localStorage.clear(); location.reload(); }};

window.onload = function() {
    if (state.active) {
        document.getElementById('setup').style.display = 'none';
        document.getElementById('mainDashboard').style.display = 'flex';
        updateUI(); 
        initGraph();
    } else {
        document.getElementById('setup').style.display = 'block';
        document.getElementById('mainDashboard').style.display = 'none';
    }
};
