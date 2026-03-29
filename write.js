(function() {
    const _dp = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
    const _ok = _dp.activeProjectId && _dp.projects && _dp.projects[_dp.activeProjectId] && _dp.projects[_dp.activeProjectId].active;
    if (!_ok) window.location.replace('index.html');
})();

// ── State ─────────────────────────────────────────────────────────────────────
let writingData      = null;
let activeProjectId  = null;

function init() {
    const dpData = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
    activeProjectId  = dpData.activeProjectId;
    const proj       = dpData.projects && dpData.projects[activeProjectId];
    const title      = (proj && proj.title) || 'PROJECT';

    document.getElementById('writeProjectTitle').textContent = title;

    const raw = JSON.parse(localStorage.getItem('writingData') || '{}');
    if (raw.projectId === activeProjectId && Array.isArray(raw.chapters)) {
        writingData = raw;
    } else {
        writingData = { projectId: activeProjectId, chapters: [], lastSyncedWordCount: 0 };
        saveMeta();
    }

    renderAll();
    updateFooter();
}

function saveMeta() {
    localStorage.setItem('writingData', JSON.stringify(writingData));
}

function makeId() {
    return 'ch_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

function escapeAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Chapter management ────────────────────────────────────────────────────────
window.addChapter = function() {
    const num = writingData.chapters.length + 1;
    const ch  = {
        id:        makeId(),
        title:     'Chapter ' + num,
        order:     writingData.chapters.length,
        wordCount: 0,
        content:   '',
        updatedAt: Date.now()
    };
    writingData.chapters.push(ch);
    saveMeta();
    renderAll();
    // Expand and focus the new chapter
    const el = document.getElementById('chap_' + ch.id);
    if (el) el.classList.add('open');
    setTimeout(() => {
        const editor = document.getElementById('cheditor_' + ch.id);
        if (editor) editor.focus();
    }, 50);
};

window.deleteChapter = function(id) {
    const ch = writingData.chapters.find(c => c.id === id);
    if (!ch) return;
    if (!confirm('Delete "' + ch.title + '"? This cannot be undone.')) return;
    writingData.chapters = writingData.chapters.filter(c => c.id !== id);
    writingData.chapters.forEach((c, i) => c.order = i);
    saveMeta();
    if (window.deleteWritingChapterFromCloud) window.deleteWritingChapterFromCloud(id);
    renderAll();
    updateFooter();
};

window.moveChapter = function(id, delta) {
    const idx    = writingData.chapters.findIndex(c => c.id === id);
    const newIdx = idx + delta;
    if (idx === -1 || newIdx < 0 || newIdx >= writingData.chapters.length) return;
    [writingData.chapters[idx], writingData.chapters[newIdx]] =
        [writingData.chapters[newIdx], writingData.chapters[idx]];
    writingData.chapters.forEach((c, i) => c.order = i);
    saveMeta();
    renderAll();
};

window.renameChapter = function(id, newTitle) {
    const ch = writingData.chapters.find(c => c.id === id);
    if (!ch) return;
    ch.title     = newTitle;
    ch.updatedAt = Date.now();
    saveMeta();
    scheduleCloudSave(ch);
};

window.toggleChapter = function(id) {
    const el = document.getElementById('chap_' + id);
    if (el) el.classList.toggle('open');
};

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderAll() {
    const container = document.getElementById('writeChapterList');
    if (!container) return;

    container.innerHTML = writingData.chapters.map(ch => {
        const isFirst = ch.order === 0;
        const isLast  = ch.order === writingData.chapters.length - 1;
        return `
            <div class="write-chapter" id="chap_${ch.id}">
                <div class="write-chapter-header" onclick="toggleChapter('${ch.id}')">
                    <span class="write-ch-arrow">▶</span>
                    <input type="text" class="write-ch-title-input" value="${escapeAttr(ch.title)}"
                        onclick="event.stopPropagation()"
                        onchange="renameChapter('${ch.id}', this.value)"
                        onkeydown="event.stopPropagation()">
                    <span class="write-ch-wc" id="chwc_${ch.id}">${(ch.wordCount || 0).toLocaleString()} WDS</span>
                    <button class="write-ch-btn" onmousedown="event.preventDefault()"
                        onclick="moveChapter('${ch.id}', -1); event.stopPropagation()"
                        ${isFirst ? 'disabled' : ''}>↑</button>
                    <button class="write-ch-btn" onmousedown="event.preventDefault()"
                        onclick="moveChapter('${ch.id}', 1); event.stopPropagation()"
                        ${isLast ? 'disabled' : ''}>↓</button>
                    <button class="write-ch-btn write-ch-del" onmousedown="event.preventDefault()"
                        onclick="deleteChapter('${ch.id}'); event.stopPropagation()">✕</button>
                    <button class="write-ch-btn write-ch-focus" onmousedown="event.preventDefault()"
                        onclick="focusChapter('${ch.id}'); event.stopPropagation()" title="Focus mode">⛶</button>
                </div>
                <div class="write-chapter-body">
                    <div class="write-toolbar">
                        <button class="write-tb-btn" onmousedown="event.preventDefault(); document.execCommand('bold')"      title="Bold"><b>B</b></button>
                        <button class="write-tb-btn" onmousedown="event.preventDefault(); document.execCommand('italic')"    title="Italic"><em>I</em></button>
                        <button class="write-tb-btn" onmousedown="event.preventDefault(); document.execCommand('underline')" title="Underline"><u>U</u></button>
                        <button class="write-tb-btn" onmousedown="event.preventDefault(); applyHeading('${ch.id}')"          title="Scene heading">H2</button>
                        <button class="write-tb-btn write-tb-clear" onmousedown="event.preventDefault(); document.execCommand('removeFormat')" title="Clear formatting">✕</button>
                    </div>
                    <div class="write-area"
                         contenteditable="true"
                         id="cheditor_${ch.id}"
                         spellcheck="true"
                         oninput="onEditorInput('${ch.id}')"
                         onfocus="onEditorFocus('${ch.id}')"></div>
                </div>
            </div>`;
    }).join('');

    // Set content separately to avoid template-literal HTML injection issues
    writingData.chapters.forEach(ch => {
        const editor = document.getElementById('cheditor_' + ch.id);
        if (editor) editor.innerHTML = ch.content || '';
    });
}

// ── Editor events ─────────────────────────────────────────────────────────────
window.onEditorInput = function(id) {
    const editor = document.getElementById('cheditor_' + id);
    if (!editor) return;

    const content = editor.innerHTML;
    const wc      = countWords(content);
    const ch      = writingData.chapters.find(c => c.id === id);
    if (ch) { ch.content = content; ch.wordCount = wc; ch.updatedAt = Date.now(); }

    const wcEl = document.getElementById('chwc_' + id);
    if (wcEl) wcEl.textContent = wc.toLocaleString() + ' WDS';

    saveMeta();
    updateFooter();
    setSaveStatus('saving');
    scheduleCloudSave(ch);

    // Keep focus bar word count live
    if (window._focusedChapterId === id) {
        const fcWc = document.getElementById('focusWc');
        if (fcWc) fcWc.textContent = wc.toLocaleString() + ' WDS';
    }
};

window.onEditorFocus = function(id) {
    const el = document.getElementById('chap_' + id);
    if (el && !el.classList.contains('open')) el.classList.add('open');
};

window.applyHeading = function(id) {
    const editor = document.getElementById('cheditor_' + id);
    if (!editor) return;
    editor.focus();
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const node  = sel.anchorNode;
    const block = node ? (node.nodeType === 3 ? node.parentElement : node) : null;
    const inH   = block && block.closest('h2, h3');
    document.execCommand('formatBlock', false, inH ? 'p' : 'h2');
};

// ── Word counting ─────────────────────────────────────────────────────────────
function countWords(html) {
    if (!html) return 0;
    const text = html
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&[a-z]+;/gi, ' ')
        .trim();
    return text ? text.split(/\s+/).filter(w => w.length > 0).length : 0;
}

// ── Footer ────────────────────────────────────────────────────────────────────
function updateFooter() {
    const total      = writingData.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
    const lastSynced = writingData.lastSyncedWordCount || 0;
    const delta      = total - lastSynced;

    const totalEl = document.getElementById('writeTotalWords');
    if (totalEl) totalEl.textContent = 'TOTAL: ' + total.toLocaleString() + ' WORDS';

    const btn = document.getElementById('syncWordsBtn');
    if (btn) {
        if (delta > 0) {
            btn.textContent = 'SYNC ' + delta.toLocaleString() + ' NEW WORDS TO TRACKER';
            btn.disabled    = false;
            btn.style.opacity = '';
        } else {
            btn.textContent   = 'ALL WORDS SYNCED';
            btn.disabled      = true;
            btn.style.opacity = '0.4';
        }
    }
}

// ── Sync to tracker ───────────────────────────────────────────────────────────
window.syncToTracker = function() {
    const total = writingData.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
    const delta = total - (writingData.lastSyncedWordCount || 0);
    if (delta <= 0) return;
    if (!confirm('Add ' + delta.toLocaleString() + ' words to your Draft Punk tracker?')) return;

    const dpData = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
    if (!dpData.activeProjectId || !dpData.projects) { alert('No active project found.'); return; }
    const proj = dpData.projects[dpData.activeProjectId];
    if (!proj) { alert('No active project found.'); return; }

    proj.total          = (proj.total          || 0) + delta;
    proj.wordsThisWeek  = (proj.wordsThisWeek  || 0) + delta;
    proj.wordsThisMonth = (proj.wordsThisMonth || 0) + delta;
    proj.wordsThisYear  = (proj.wordsThisYear  || 0) + delta;
    proj.logs           = proj.logs || [];
    proj.logs.push({ date: new Date().toLocaleDateString(), total: proj.total });
    dpData.projects[dpData.activeProjectId] = proj;
    localStorage.setItem('draftPunkData', JSON.stringify(dpData)); // triggers cloud sync

    writingData.lastSyncedWordCount = total;
    saveMeta();
    updateFooter();
    alert('✓ ' + delta.toLocaleString() + ' words added to your tracker!');
};

// ── Focus mode ────────────────────────────────────────────────────────────────
window._focusedChapterId = null;

window.focusChapter = function(id) {
    const ch = writingData.chapters.find(c => c.id === id);
    if (!ch) return;

    const chEl = document.getElementById('chap_' + id);
    if (chEl) {
        chEl.classList.add('open');
        chEl.classList.add('write-focus-target');
    }

    document.body.classList.add('write-focus');
    window._focusedChapterId = id;

    const titleEl = document.getElementById('focusChapterTitle');
    const wcEl    = document.getElementById('focusWc');
    if (titleEl) titleEl.textContent = ch.title.toUpperCase();
    if (wcEl)    wcEl.textContent    = (ch.wordCount || 0).toLocaleString() + ' WDS';

    setTimeout(() => {
        const editor = document.getElementById('cheditor_' + id);
        if (editor) editor.focus();
    }, 50);
};

window.exitFocus = function() {
    document.body.classList.remove('write-focus');
    document.querySelectorAll('.write-focus-target').forEach(el => el.classList.remove('write-focus-target'));
    window._focusedChapterId = null;
};

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && document.body.classList.contains('write-focus')) exitFocus();
});

// ── Export story as RTF ───────────────────────────────────────────────────────
window.exportStory = function() {
    if (!writingData || !writingData.chapters.length) {
        alert('No chapters to export.');
        return;
    }

    const dpData = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
    const proj   = dpData.projects && dpData.projects[activeProjectId];
    const title  = (proj && proj.title) || 'MY STORY';

    const rtf      = buildRtf(title, writingData.chapters);
    const blob     = new Blob([rtf], { type: 'application/rtf' });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    a.href         = url;
    a.download     = title.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.rtf';
    a.click();
    URL.revokeObjectURL(url);
};

function buildRtf(storyTitle, chapters) {
    const parts = [];
    parts.push('{\\rtf1\\ansi\\ansicpg1252\\deff0');
    parts.push('{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Courier New;}}');
    parts.push('\\f0\\fs24\\sa240\\sl360\\slmult1');
    parts.push('{\\f1\\fs36\\b ' + rtfEscape(storyTitle.toUpperCase()) + '}\\par\\par');

    chapters.forEach(ch => {
        parts.push('{\\f1\\fs28\\b ' + rtfEscape(ch.title.toUpperCase()) + '}\\par\\par');
        parts.push(htmlToRtf(ch.content));
        parts.push('\\par\\par');
    });

    parts.push('}');
    return parts.join('\n');
}

function rtfEscape(text) {
    return text.split('').map(c => {
        const code = c.charCodeAt(0);
        if (code > 127) return "\\'" + code.toString(16).padStart(2, '0');
        if (c === '\\') return '\\\\';
        if (c === '{')  return '\\{';
        if (c === '}')  return '\\}';
        return c;
    }).join('');
}

function htmlToRtf(html) {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html;
    return Array.from(div.childNodes).map(nodeToRtf).join('');
}

function nodeToRtf(node) {
    if (node.nodeType === 3) return rtfEscape(node.textContent); // text node
    if (node.nodeType !== 1) return '';                           // not an element

    const tag   = node.tagName.toLowerCase();
    const inner = Array.from(node.childNodes).map(nodeToRtf).join('');

    switch (tag) {
        case 'b': case 'strong': return '{\\b '  + inner + '}';
        case 'i': case 'em':     return '{\\i '  + inner + '}';
        case 'u':                return '{\\ul ' + inner + '}';
        case 'h2':               return '{\\b\\fs28 ' + inner + '}\\par';
        case 'h3':               return '{\\b\\fs26 ' + inner + '}\\par';
        case 'br':               return '\\par ';
        case 'p':                return '\\fi720 ' + inner + '\\par ';
        case 'div':              return '\\fi720 ' + inner + '\\par ';
        default:                 return inner;
    }
}

// ── Save status indicator ─────────────────────────────────────────────────────
let saveStatusTimer = null;
function setSaveStatus(state) {
    const el = document.getElementById('writeSaveStatus');
    if (!el) return;
    clearTimeout(saveStatusTimer);
    el.textContent = state === 'saving' ? 'SAVING...' : 'SAVED';
    if (state === 'saved') {
        saveStatusTimer = setTimeout(() => { el.textContent = ''; }, 2000);
    }
}

// ── Cloud sync ────────────────────────────────────────────────────────────────
const cloudTimers = {};
function scheduleCloudSave(ch) {
    if (!ch) return;
    clearTimeout(cloudTimers[ch.id]);
    cloudTimers[ch.id] = setTimeout(async () => {
        if (window.pushWritingChapterToCloud) {
            try {
                await window.pushWritingChapterToCloud({
                    id: ch.id, title: ch.title, content: ch.content,
                    order: ch.order, wordCount: ch.wordCount,
                    projectId: activeProjectId, updatedAt: ch.updatedAt
                });
                setSaveStatus('saved');
            } catch (e) { setSaveStatus('saved'); } // saved locally at least
        } else {
            setSaveStatus('saved');
        }
    }, 2000);
}

// Pull from cloud on sign-in if no local chapters yet
document.addEventListener('dpAuthChanged', async function(e) {
    if (!e.detail.user || writingData.chapters.length > 0) return;
    if (!window.pullWritingFromCloud) return;
    const cloudChapters = await window.pullWritingFromCloud(activeProjectId);
    if (cloudChapters && cloudChapters.length > 0) {
        writingData.chapters = cloudChapters;
        saveMeta();
        renderAll();
        updateFooter();
    }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
