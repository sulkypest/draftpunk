const CHAR_FIELDS = [
    { key: 'age',         label: 'AGE',                  type: 'input',    wide: false },
    { key: 'role',        label: 'ROLE',                 type: 'input',    wide: false },
    { key: 'occupation',  label: 'OCCUPATION / HOBBIES', type: 'input',    wide: true  },
    { key: 'personality', label: 'PERSONALITY',          type: 'textarea', wide: true  },
    { key: 'appearance',  label: 'PHYSICAL APPEARANCE',  type: 'textarea', wide: true  },
    { key: 'backstory',   label: 'BACKSTORY',            type: 'textarea', wide: true  },
    { key: 'motivation',  label: 'MOTIVATION & DESIRES', type: 'textarea', wide: true  },
    { key: 'likes',       label: 'LIKES / DISLIKES',     type: 'textarea', wide: true  },
    { key: 'plotRole',    label: 'PLOT ROLE',            type: 'textarea', wide: true  },
];

let charData = JSON.parse(localStorage.getItem('charactersData')) || { chars: [] };

function save() {
    localStorage.setItem('charactersData', JSON.stringify(charData));
}

function esc(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderChar(char, idx) {
    const fields = CHAR_FIELDS.map(f => {
        const val = esc(char[f.key] || '');
        const input = f.type === 'textarea'
            ? `<textarea class="sprint-textarea" style="min-height:80px;" placeholder="${f.label}..." oninput="updateField('${char.id}','${f.key}',this.value)">${val}</textarea>`
            : `<input type="text" value="${val}" placeholder="${f.label}..." oninput="updateField('${char.id}','${f.key}',this.value)">`;
        return `<div class="char-field${f.wide ? ' char-field-wide' : ''}">\n<label>${f.label}</label>\n${input}\n</div>`;
    }).join('');

    return `
        <div class="accordion" id="char-${char.id}">
            <div class="accordion-header">
                <div style="display:flex;align-items:center;gap:10px;flex:1;cursor:pointer;" onclick="toggleChar('${char.id}')">
                    <span class="accordion-number">${idx + 1}</span>
                    <span class="accordion-title" id="char-title-${char.id}">${esc(char.name) || 'NEW CHARACTER'}</span>
                </div>
                <button onclick="deleteChar('${char.id}')" style="background:#333;font-size:0.6rem;padding:4px 8px;margin-right:10px;">DELETE</button>
                <span id="char-arrow-${char.id}" style="cursor:pointer;" onclick="toggleChar('${char.id}')">▶</span>
            </div>
            <div class="accordion-body hidden" id="char-body-${char.id}">
                <div class="char-field char-field-wide">
                    <label>NAME</label>
                    <input type="text" value="${esc(char.name)}" placeholder="Character name..." oninput="updateField('${char.id}','name',this.value)">
                </div>
                <div class="char-fields-grid">
                    ${fields}
                </div>
            </div>
        </div>`;
}

function renderAll() {
    document.getElementById('charContainer').innerHTML =
        charData.chars.length
            ? charData.chars.map((c, i) => renderChar(c, i)).join('')
            : '<div style="opacity:0.4;text-align:center;padding:30px;font-size:0.8rem;">NO CHARACTERS YET — HIT + ADD CHARACTER</div>';
}

window.addChar = function() {
    const c = { id: Date.now().toString(), name: '' };
    CHAR_FIELDS.forEach(f => c[f.key] = '');
    charData.chars.push(c);
    save();
    renderAll();
    toggleChar(c.id);
    document.getElementById(`char-${c.id}`).scrollIntoView({ behavior: 'smooth' });
};

window.deleteChar = function(id) {
    if (!confirm('Delete this character?')) return;
    charData.chars = charData.chars.filter(c => c.id !== id);
    save();
    renderAll();
};

window.toggleChar = function(id) {
    const body = document.getElementById(`char-body-${id}`);
    const arrow = document.getElementById(`char-arrow-${id}`);
    const isOpen = !body.classList.contains('hidden');
    body.classList.toggle('hidden', isOpen);
    arrow.innerText = isOpen ? '▶' : '▼';
};

window.updateField = function(id, key, value) {
    const char = charData.chars.find(c => c.id === id);
    if (!char) return;
    char[key] = value;
    if (key === 'name') {
        document.getElementById(`char-title-${id}`).innerText = value || 'NEW CHARACTER';
    }
    save();
};

window.onload = function() {
    const dpState = JSON.parse(localStorage.getItem('draftPunkData'));
    if (dpState && dpState.title) {
        document.getElementById('projectTitle').innerText = dpState.title.toUpperCase();
    }
    renderAll();
};
