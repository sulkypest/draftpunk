(function() { const _dp = JSON.parse(localStorage.getItem('draftPunkData') || '{}'); const _ok = _dp.activeProjectId && _dp.projects && _dp.projects[_dp.activeProjectId] && _dp.projects[_dp.activeProjectId].active; if (!_ok) window.location.replace('index.html'); })();
const BEATS = [
    { name: "Opening Image",    lore: "A snapshot of the 'before' world." },
    { name: "Theme Stated",     lore: "Someone hints at the life lesson needed." },
    { name: "Setup",            lore: "Exploring the hero's world and flaws." },
    { name: "Catalyst",         lore: "The life-changing telegram or explosion." },
    { name: "Debate",           lore: "The last chance to turn back." },
    { name: "Break into Two",   lore: "Leaving the old world behind." },
    { name: "B Story",          lore: "The love interest or helper appears." },
    { name: "Fun and Games",    lore: "The 'promise of the premise' in action." },
    { name: "Midpoint",         lore: "The stakes are raised or the clock starts." },
    { name: "Bad Guys Close In",lore: "The opposition gets serious." },
    { name: "All Is Lost",      lore: "The 'whiff of death' moment." },
    { name: "Dark Night",       lore: "The hero hits rock bottom." },
    { name: "Break into Three", lore: "The 'Aha!' moment and the new plan." },
    { name: "Finale",           lore: "The final battle and transformation." },
    { name: "Final Image",      lore: "The 'after' world — completely changed." },
];

let beatData = JSON.parse(localStorage.getItem('beatNotesData')) || {};

function save() {
    localStorage.setItem('beatNotesData', JSON.stringify(beatData));
}

window.toggleBeat = function(idx) {
    const body = document.getElementById(`beat-body-${idx}`);
    const arrow = document.getElementById(`beat-arrow-${idx}`);
    const isOpen = !body.classList.contains('hidden');
    body.classList.toggle('hidden', isOpen);
    arrow.innerText = isOpen ? '▶' : '▼';
};

window.onBeatInput = function(idx) {
    beatData[BEATS[idx].name] = document.getElementById(`beat-text-${idx}`).value;
    save();
};

window.onload = function() {
    const dpState = JSON.parse(localStorage.getItem('draftPunkData'));
    if (dpState && dpState.title) {
        document.getElementById('projectTitle').innerText = dpState.title.toUpperCase();
    }

    document.getElementById('beatContainer').innerHTML = BEATS.map((beat, i) => `
        <div class="accordion">
            <div class="accordion-header" onclick="toggleBeat(${i})">
                <div style="display:flex;align-items:center;gap:10px;">
                    <span class="accordion-number">${i + 1}</span>
                    <span class="accordion-title">${beat.name.toUpperCase()}</span>
                </div>
                <span id="beat-arrow-${i}">▶</span>
            </div>
            <div class="accordion-body hidden" id="beat-body-${i}">
                <div class="beat-lore">${beat.lore}</div>
                <textarea
                    id="beat-text-${i}"
                    class="sprint-textarea"
                    style="min-height:120px;"
                    placeholder="Your notes for this beat..."
                    oninput="onBeatInput(${i})"
                >${beatData[beat.name] || ''}</textarea>
            </div>
        </div>
    `).join('');
};
