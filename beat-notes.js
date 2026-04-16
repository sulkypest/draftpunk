(function() {
    const _dp = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
    const _ok = _dp.activeProjectId && _dp.projects && _dp.projects[_dp.activeProjectId] && _dp.projects[_dp.activeProjectId].active;
    if (!_ok) window.location.replace('index.html');
})();

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

// ── Data ──────────────────────────────────────────────────────────────────────
const _dpInit       = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
const activeProjectId = _dpInit.activeProjectId;

let allBeatData = JSON.parse(localStorage.getItem('beatNotesData')) || {};

// Migrate old flat format (beat name keys at top level)
if (activeProjectId && !allBeatData[activeProjectId]) {
    const isFlatFormat = BEATS.some(b => allBeatData[b.name] !== undefined);
    if (isFlatFormat) {
        allBeatData = { [activeProjectId]: allBeatData };
        localStorage.setItem('beatNotesData', JSON.stringify(allBeatData));
    }
}

let beatData = activeProjectId ? (allBeatData[activeProjectId] || {}) : {};

// Migrate old format: string → array of sections
function migrateBeat(val) {
    if (typeof val === 'string') {
        return [{ id: Date.now(), title: 'Notes', text: val }];
    }
    if (!Array.isArray(val)) return [];
    return val;
}

BEATS.forEach(b => {
    if (beatData[b.name] !== undefined) {
        beatData[b.name] = migrateBeat(beatData[b.name]);
    } else {
        beatData[b.name] = [];
    }
});

function save() {
    if (!activeProjectId) return;
    const all = JSON.parse(localStorage.getItem('beatNotesData')) || {};
    all[activeProjectId] = beatData;
    localStorage.setItem('beatNotesData', JSON.stringify(all));
}

function updateFillRate() {
    const filled = BEATS.filter(b =>
        beatData[b.name] && beatData[b.name].some(s => s.text && s.text.trim())
    ).length;
    const el = document.getElementById('beatFillRate');
    if (el) el.innerText = filled + ' / ' + BEATS.length + ' BEATS FILLED';
}

// ── Toggle accordion ──────────────────────────────────────────────────────────
window.toggleBeat = function(idx) {
    const body  = document.getElementById(`beat-body-${idx}`);
    const arrow = document.getElementById(`beat-arrow-${idx}`);
    const isOpen = !body.classList.contains('hidden');
    body.classList.toggle('hidden', isOpen);
    arrow.innerText = isOpen ? '▶' : '▼';
};

// ── Render sections for one beat ──────────────────────────────────────────────
function renderSections(beatIdx) {
    const beat     = BEATS[beatIdx];
    const sections = beatData[beat.name];
    const container = document.getElementById(`beat-sections-${beatIdx}`);
    if (!container) return;

    container.innerHTML = sections.map((sec, sIdx) => `
        <div class="beat-section" id="beat-sec-${beatIdx}-${sIdx}">
            <div class="beat-section-header">
                <input
                    class="beat-section-title"
                    type="text"
                    value="${escHtml(sec.title || '')}"
                    placeholder="SECTION TITLE"
                    oninput="onSectionTitle(${beatIdx}, ${sIdx}, this.value)"
                >
                <button class="beat-section-del" onclick="deleteSection(${beatIdx}, ${sIdx})" title="Delete section">✕</button>
            </div>
            <textarea
                class="sprint-textarea beat-section-text"
                placeholder="Notes for this section..."
                oninput="onSectionText(${beatIdx}, ${sIdx}, this.value)"
            >${escHtml(sec.text || '')}</textarea>
        </div>
    `).join('');
}

function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Section callbacks ─────────────────────────────────────────────────────────
window.onSectionTitle = function(beatIdx, sIdx, val) {
    beatData[BEATS[beatIdx].name][sIdx].title = val;
    save();
};

window.onSectionText = function(beatIdx, sIdx, val) {
    beatData[BEATS[beatIdx].name][sIdx].text = val;
    save();
    updateFillRate();
};

window.addSection = function(beatIdx) {
    const beat = BEATS[beatIdx];
    beatData[beat.name].push({ id: Date.now(), title: '', text: '' });
    save();
    renderSections(beatIdx);
    // Open accordion if closed
    const body = document.getElementById(`beat-body-${beatIdx}`);
    if (body && body.classList.contains('hidden')) {
        body.classList.remove('hidden');
        const arrow = document.getElementById(`beat-arrow-${beatIdx}`);
        if (arrow) arrow.innerText = '▼';
    }
    // Focus the new title input
    const sections = beatData[beat.name];
    const lastIdx  = sections.length - 1;
    setTimeout(() => {
        const el = document.querySelector(`#beat-sec-${beatIdx}-${lastIdx} .beat-section-title`);
        if (el) el.focus();
    }, 50);
};

window.deleteSection = function(beatIdx, sIdx) {
    const beat = BEATS[beatIdx];
    if (beatData[beat.name].length > 0) {
        beatData[beat.name].splice(sIdx, 1);
        save();
        renderSections(beatIdx);
        updateFillRate();
    }
};

// ── Export as RTF ─────────────────────────────────────────────────────────────
function rtfEsc(text) {
    return (text || '').split('').map(c => {
        const code = c.charCodeAt(0);
        if (code > 127) return "\\'" + code.toString(16).padStart(2, '0');
        if (c === '\\') return '\\\\';
        if (c === '{')  return '\\{';
        if (c === '}')  return '\\}';
        if (c === '\n') return '\\par ';
        return c;
    }).join('');
}

window.exportBeats = function() {
    const dpData  = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
    const activeId = dpData.activeProjectId;
    const proj    = activeId && dpData.projects && dpData.projects[activeId];
    const title   = (proj && proj.title) || 'MY PROJECT';

    const parts = [];
    parts.push('{\\rtf1\\ansi\\ansicpg1252\\deff0');
    parts.push('{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Courier New;}}');
    parts.push('\\f0\\fs24\\sa200\\sl360\\slmult1');
    parts.push('{\\f1\\fs32\\b ' + rtfEsc('BEAT NOTES — ' + title.toUpperCase()) + '}\\par\\par');

    BEATS.forEach((beat, i) => {
        parts.push('{\\f1\\fs26\\b ' + rtfEsc((i + 1) + '. ' + beat.name.toUpperCase()) + '}\\par');
        parts.push('{\\i\\fs20 ' + rtfEsc(beat.lore) + '}\\par');
        const sections = beatData[beat.name] || [];
        if (sections.length === 0) {
            parts.push('{\\i\\fs20 —}\\par\\par');
        } else {
            sections.forEach(sec => {
                if (sec.title) parts.push('{\\f1\\fs22\\b ' + rtfEsc(sec.title.toUpperCase()) + '}\\par');
                parts.push(sec.text ? rtfEsc(sec.text) + '\\par\\par' : '{\\i\\fs20 —}\\par\\par');
            });
        }
    });

    parts.push('}');

    const blob = new Blob([parts.join('\n')], { type: 'application/rtf' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = title.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_beats.rtf';
    a.click();
    URL.revokeObjectURL(url);
};

// ── Init ──────────────────────────────────────────────────────────────────────
window.onload = function() {
    const dpState = JSON.parse(localStorage.getItem('draftPunkData'));
    const projId  = dpState && dpState.activeProjectId;
    const proj    = projId && dpState.projects && dpState.projects[projId];
    if (proj && proj.title) {
        document.getElementById('projectTitle').innerText = proj.title.toUpperCase();
    }

    document.getElementById('beatContainer').innerHTML = BEATS.map((beat, i) => {
        const sectionCount = (beatData[beat.name] || []).length;
        const hasSections  = sectionCount > 0;
        return `
        <div class="accordion">
            <div class="accordion-header" onclick="toggleBeat(${i})">
                <div style="display:flex;align-items:center;gap:10px;">
                    <span class="accordion-number">${i + 1}</span>
                    <span class="accordion-title">${beat.name.toUpperCase()}</span>
                </div>
                <div style="display:flex;align-items:center;gap:10px;">
                    ${hasSections ? `<span style="font-size:0.6rem;color:var(--text-dim);letter-spacing:1px;">${sectionCount} SECTION${sectionCount !== 1 ? 'S' : ''}</span>` : ''}
                    <span id="beat-arrow-${i}">▶</span>
                </div>
            </div>
            <div class="accordion-body hidden" id="beat-body-${i}">
                <div class="beat-lore">${beat.lore}</div>
                <div id="beat-sections-${i}"></div>
                <button class="beat-add-section" onclick="addSection(${i})">+ ADD SECTION</button>
            </div>
        </div>`;
    }).join('');

    BEATS.forEach((_, i) => renderSections(i));
    updateFillRate();
};
