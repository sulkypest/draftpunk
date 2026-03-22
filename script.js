// Adding the Tips from the PDF to the Beats
const STC_BEATS = [
    { pct: 0, name: "Opening Image", lore: "The 'Before' snapshot. Establish the hero's world.", tips: "TIP: Show, don't tell the hero's frustration. What is the one thing they can't change yet?" },
    { pct: 1, name: "Theme Stated", lore: "A character mentions the lesson the hero needs.", tips: "TIP: Keep this subtle. It shouldn't sound like a sermon, just a casual observation." },
    { pct: 10, name: "Setup", lore: "Explore the hero’s world and the 'A Story' cast.", tips: "TIP: Every character introduced here must represent a piece of the world that will eventually change." },
    { pct: 12, name: "The Catalyst", lore: "The telegram, the knock at the door, the change.", tips: "TIP: This must be an external event. The hero shouldn't choose this; it happens TO them." },
    { pct: 20, name: "The Debate", lore: "The hero hesitates. Can I do this? Is it safe?", tips: "TIP: Use this to show the stakes. If they don't go, what exactly do they lose?" },
    { pct: 25, name: "Break into Two", lore: "The hero chooses to enter the 'upside-down' world.", tips: "TIP: This is a proactive step. The hero must physically leave their comfort zone here." },
    { pct: 30, name: "B Story", lore: "Introduce the 'helper' or love interest.", tips: "TIP: This character should be the opposite of the 'A Story' characters in terms of philosophy." },
    { pct: 35, name: "Fun & Games", lore: "The hero explores the new world. Promise of the premise.", tips: "TIP: Give the reader what they bought the book for. If it's a detective story, show them sleuthing." },
    { pct: 50, name: "The Midpoint", lore: "Stakes are raised. A false victory or defeat.", tips: "TIP: Move from 'wanting' to 'needing.' The clock starts ticking louder here." },
    { pct: 65, name: "Bad Guys Close In", lore: "Internal or external pressure mounts.", tips: "TIP: This is where the hero's internal flaws start causing external disasters." },
    { pct: 75, name: "All Is Lost", lore: "The 'whiff of death.' Total defeat.", tips: "TIP: Remove the hero's support system. They must feel completely alone." },
    { pct: 80, name: "Dark Night", lore: "The hero wallows and finally realizes the theme.", tips: "TIP: This is the lowest point. Let them fail before they can truly learn." },
    { pct: 85, name: "Break into Three", lore: "The hero chooses to act one last time.", tips: "TIP: Combine the A and B stories. The lesson learned in B solves the problem in A." },
    { pct: 90, name: "The Finale", lore: "The hero executes the plan. Old flaws gone.", tips: "TIP: This isn't just a fight; it's a proof of change. Show how they handle things differently now." },
    { pct: 100, name: "Final Image", lore: "The 'After' snapshot. The changed world.", tips: "TIP: Mirror the Opening Image. Show the growth through visual contrast." }
];

// ... (PROMPTS array remains same)

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
    document.querySelector('.intel-btn').innerText = cont.classList.contains('hidden') ? "VIEW TACTICAL LORE ▾" : "HIDE TACTICAL LORE ▴";
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
    
    // Update Lore and Tips (hidden by default in the toggleable container)
    document.getElementById('loreBox').innerText = curB.lore;
    document.getElementById('tipsBox').innerText = curB.tips;

    // ... (Boss Sprite and Progress Bar logic same as previous version)
}
