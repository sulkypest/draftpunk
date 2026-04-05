(function() { const _dp = JSON.parse(localStorage.getItem('draftPunkData') || '{}'); const _ok = _dp.activeProjectId && _dp.projects && _dp.projects[_dp.activeProjectId] && _dp.projects[_dp.activeProjectId].active; if (!_ok) window.location.replace('index.html'); })();

// ── State ─────────────────────────────────────────────────────────────────────
const _dpInit       = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
const activeProjectId = _dpInit.activeProjectId;

let allNotesData = JSON.parse(localStorage.getItem('notesData') || '{}');
let notes = activeProjectId ? (allNotesData[activeProjectId] || []) : [];

function save() {
    if (!activeProjectId) return;
    const all = JSON.parse(localStorage.getItem('notesData') || '{}');
    all[activeProjectId] = notes;
    localStorage.setItem('notesData', JSON.stringify(all));
}

function makeId() {
    return 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
    const grid = document.getElementById('notesGrid');
    if (!grid) return;

    if (notes.length === 0) {
        grid.innerHTML = '<div style="opacity:0.3;font-size:0.75rem;letter-spacing:1px;text-align:center;padding:40px 0;">NO NOTES YET — HIT + NEW NOTE TO START</div>';
        return;
    }

    grid.innerHTML = notes.map(note => `
        <div class="sticky-note" id="note-${note.id}">
            <div class="sticky-note-toolbar">
                <input
                    type="text"
                    class="sticky-note-title"
                    placeholder="TITLE"
                    value="${escAttr(note.title)}"
                    oninput="updateTitle('${note.id}', this.value)">
                <button class="sticky-note-del" onclick="deleteNote('${note.id}')">✕</button>
            </div>
            <textarea
                class="sticky-note-body"
                placeholder="Write anything..."
                oninput="updateBody('${note.id}', this.value)"
            >${escText(note.body)}</textarea>
        </div>
    `).join('');
}

function escAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escText(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Actions ───────────────────────────────────────────────────────────────────
window.addNote = function() {
    const note = { id: makeId(), title: '', body: '', createdAt: Date.now() };
    notes.unshift(note);
    save();
    render();
    const titleEl = document.querySelector(`#note-${note.id} .sticky-note-title`);
    if (titleEl) titleEl.focus();
};

window.deleteNote = function(id) {
    if (!confirm('Delete this note?')) return;
    notes = notes.filter(n => n.id !== id);
    save();
    render();
};

window.updateTitle = function(id, value) {
    const note = notes.find(n => n.id === id);
    if (note) { note.title = value; save(); }
};

window.updateBody = function(id, value) {
    const note = notes.find(n => n.id === id);
    if (note) { note.body = value; save(); }
};

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
    const dpData = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
    const proj   = dpData.projects && dpData.projects[activeProjectId];
    const titleEl = document.getElementById('notesProjectTitle');
    if (titleEl && proj && proj.title) titleEl.textContent = proj.title.toUpperCase();
    render();
});
