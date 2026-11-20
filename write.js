(function() {
    const _dp = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
    const _ok = _dp.activeProjectId && _dp.projects && _dp.projects[_dp.activeProjectId] && _dp.projects[_dp.activeProjectId].active;
    if (!_ok) window.location.replace('index.html');
})();

// ── State ─────────────────────────────────────────────────────────────────────
let currentFontSize  = localStorage.getItem('writeFontSize') || 'md';
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
        // Do NOT call saveMeta() here — writing the empty state would destroy any
        // existing chapter data stored under a different projectId in localStorage.
        // Let dpAuthChanged pull the correct chapters from Firestore instead.
        writingData = { projectId: activeProjectId, chapters: [] };
    }

    reconcileSyncLedger();
    renderAll();
    updateFooter();

    // Intercept paste on any write-area — strip all formatting, insert plain text
    const list = document.getElementById('writeChapterList');
    if (list) {
        list.addEventListener('paste', function(e) {
            if (!e.target.classList.contains('write-area')) return;
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text/plain');
            if (window.DPEvidence) window.DPEvidence.notePaste(e.target.id.replace('cheditor_', ''), text);
            document.execCommand('insertText', false, text);
        }, true);
        list.addEventListener('beforeinput', onEditorBeforeInput, true);
    }
}

function saveMeta() {
    const json = JSON.stringify(writingData);
    try {
        localStorage.setItem('writingData', json);
    } catch (e) {
        // Browser storage is full. The chapter text matters most: free the
        // Writing Record's local copy (backed up to the cloud for signed-in
        // writers) and try again. Either way, carry on so the cloud save
        // still happens.
        if (window.DPEvidence) window.DPEvidence.dropLocal();
        try { localStorage.setItem('writingData', json); }
        catch (e2) { console.error('Local save failed (storage full):', e2); setSaveStatus && setSaveStatus('local-only'); }
    }
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
    if (window.DPVersions) window.DPVersions.saveDeleted(id, ch.content || '', activeProjectId);
    writingData.chapters = writingData.chapters.filter(c => c.id !== id);
    writingData.chapters.forEach((c, i) => c.order = i);
    saveMeta();
    // Its counted words leave the ledger (the tracker total itself is unchanged)
    if (ch.syncedWords) {
        const dpData = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
        const proj   = dpData.projects && dpData.projects[activeProjectId];
        if (proj && proj.writeWords !== undefined) {
            proj.writeWords = Math.max(0, proj.writeWords - ch.syncedWords);
            localStorage.setItem('draftPunkData', JSON.stringify(dpData));
        }
    }
    if (window.deleteWritingChapterFromCloud) window.deleteWritingChapterFromCloud(id);
    if (window.DPEvidence) window.DPEvidence.removeChapter(id);
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

window.promptMoveChapter = function(id) {
    const total = writingData.chapters.length;
    const ch    = writingData.chapters.find(c => c.id === id);
    if (!ch) return;
    const input = prompt(`Move "${ch.title}" to position (1–${total}):`, ch.order + 1);
    if (input === null) return;
    const newPos = parseInt(input);
    if (isNaN(newPos) || newPos < 1 || newPos > total) return;
    const fromIdx = writingData.chapters.findIndex(c => c.id === id);
    const toIdx   = newPos - 1;
    if (fromIdx === toIdx) return;
    const [removed] = writingData.chapters.splice(fromIdx, 1);
    writingData.chapters.splice(toIdx, 0, removed);
    writingData.chapters.forEach((c, i) => c.order = i);
    saveMeta();
    renderAll();
};

// ── Counted-words ledger ──────────────────────────────────────────────────────
// Each chapter's syncedWords is how many of its words are already on the
// tracker. Both SYNC routes (per chapter, and the footer button for all
// chapters) use it, so the same words can never be counted twice.
// proj.writeWords (synced to the cloud with the project) is the total of those
// figures, and is used to repair chapter figures that arrive stale from another
// device.
function unsyncedWords(ch) {
    return Math.max(0, (ch.wordCount || 0) - (ch.syncedWords || 0));
}

// Bring chapter syncedWords up to the project's recorded total. Only ever
// raises chapter figures (so nothing already counted is offered again) and only
// writes the chapter list locally — it never changes the project or its totals.
function reconcileSyncLedger() {
    if (!writingData || !writingData.chapters.length) return;
    const dpData = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
    const proj   = dpData.projects && dpData.projects[activeProjectId];
    if (!proj) return;

    const synced = writingData.chapters.reduce((s, c) => s + (c.syncedWords || 0), 0);
    let target;
    if (proj.writeWords !== undefined) {
        target = proj.writeWords;
    } else if (synced === 0) {
        // Never synced from Write: the old footer button treated words already
        // on the tracker as covering the Write page, so keep that baseline.
        const written = writingData.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
        target = Math.min(proj.total || 0, written);
    } else {
        return;
    }
    let remaining = target - synced;
    if (remaining <= 0) return;
    writingData.chapters
        .slice().sort((a, b) => (a.order || 0) - (b.order || 0))
        .forEach(ch => {
            if (remaining <= 0) return;
            const add = Math.min(unsyncedWords(ch), remaining);
            if (add > 0) { ch.syncedWords = (ch.syncedWords || 0) + add; remaining -= add; }
        });
    saveMeta();
}

function syncChaptersToTracker(ids) {
    const chapters = writingData.chapters.filter(c => ids.includes(c.id) && unsyncedWords(c) > 0);
    const delta    = chapters.reduce((s, c) => s + unsyncedWords(c), 0);
    if (delta <= 0) {
        if (ids.length === 1) {
            const ch = writingData.chapters.find(c => c.id === ids[0]);
            showWriteToast(null, 'ALREADY SYNCED', ch ? ch.title.toUpperCase() : '');
        }
        return;
    }
    const label = ids.length === 1 && chapters.length === 1 ? ` from "${chapters[0].title}"` : '';
    if (!confirm(`Add ${delta.toLocaleString()} words${label} to your tracker?`)) return;

    const dpData = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
    if (!dpData.activeProjectId || !dpData.projects) { alert('No active project found.'); return; }
    const proj = dpData.projects[dpData.activeProjectId];
    if (!proj) { alert('No active project found.'); return; }

    // Writer streak + freezes (all projects together). Recorded before the
    // project itself is updated, so a first-time carry-over of an existing
    // streak isn't counted twice.
    const sev = window.DPStreak ? window.DPStreak.recordWords(delta, JSON.parse(JSON.stringify(dpData.projects))) : null;

    const ev = window.DPTracker.awardWords(proj, delta);

    chapters.forEach(ch => { ch.syncedWords = ch.wordCount || 0; });
    proj.writeWords = writingData.chapters.reduce((s, c) => s + (c.syncedWords || 0), 0);
    proj.updatedAt  = Date.now();
    dpData.projects[dpData.activeProjectId] = proj;
    localStorage.setItem('draftPunkData', JSON.stringify(dpData));

    saveMeta();
    chapters.forEach(ch => pushChapter(ch));
    updateFooter();
    renderAll();
    if (window.updateSidebar) window.updateSidebar();
    if (window.dpStreakRefresh) window.dpStreakRefresh();

    // Show what happened, one toast at a time
    queueToast(null, '✓ SYNCED', `${delta.toLocaleString()} WORDS ADDED`);
    if (ev.streak)  queueToast(null, `🔥 ${ev.streak.days}-DAY STREAK`, `+${ev.streak.bonus} BONUS XP`);
    if (sev) streakToasts(sev).forEach(t => queueToast(null, t[0], t[1]));
    if (ev.session) queueToast(null, ev.session.label, `+${ev.session.bonus} BONUS XP`);
    if (ev.beat)    queueToast(window.getBossImgSrc ? window.getBossImgSrc(ev.beat.idx + 1) : null, 'BEAT DEFEATED', ev.beat.name.toUpperCase());
    ev.buddies.forEach(f => queueToast(`buddies/${f}`, 'NEW BUDDY!', 'CHECK YOUR COLLECTION'));
    if (ev.minion)  queueToast(null, `${ev.minion.emoji} FOE VANQUISHED`, ev.minion.name.toUpperCase());
    if (ev.levelUp) queueToast(`shields/${Math.min(5, Math.ceil(ev.levelUp.level / 5))}.png`, `LEVEL ${ev.levelUp.level}!`, ev.levelUp.rank.toUpperCase());
    // Offer daily reminders (once; only where they can work)
    if (window.dpOfferNotifications) window.dpOfferNotifications();
}

// Toasts for streak freezes used / earned (see streak.js)
function streakToasts(sev) {
    const out = [];
    if (sev.frozeDays && sev.frozeDays.length) out.push(['\u2744\uFE0F STREAK SAVED', `${sev.frozeDays.length > 1 ? sev.frozeDays.length + ' FREEZES' : 'A FREEZE'} COVERED THE DAY${sev.frozeDays.length > 1 ? 'S' : ''} YOU MISSED`]);
    (sev.earned || []).forEach(e => out.push(e.kept
        ? ['\u2744\uFE0F STREAK FREEZE EARNED', e.reason === 'streak' ? `${e.days} DAYS IN A ROW` : 'OVER 1,500 WORDS TODAY']
        : ['\u2744\uFE0F FREEZES FULL', 'YOU ALREADY HOLD THE MAXIMUM OF 3']));
    return out;
}
window.dpStreakToasts = streakToasts;

let _toastQueue = [], _toastBusy = false;
function queueToast(sprite, title, sub) {
    _toastQueue.push([sprite, title, sub]);
    if (_toastBusy) return;
    _toastBusy = true;
    (function next() {
        const t = _toastQueue.shift();
        if (!t) { _toastBusy = false; return; }
        showWriteToast(t[0], t[1], t[2]);
        setTimeout(next, _toastQueue.length ? 2200 : 0);
    })();
}

function pushChapter(ch) {
    if (!window.pushWritingChapterToCloud) return;
    window.pushWritingChapterToCloud({
        id: ch.id, title: ch.title, content: ch.content,
        order: ch.order, wordCount: ch.wordCount, syncedWords: ch.syncedWords || 0,
        projectId: activeProjectId, updatedAt: ch.updatedAt
    });
}

window.renameChapter = function(id, newTitle) {
    const ch = writingData.chapters.find(c => c.id === id);
    if (!ch || ch.title === newTitle) return;
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
        return `
            <div class="write-chapter" id="chap_${ch.id}">
                <div class="write-chapter-header" onclick="toggleChapter('${ch.id}')">
                    <span class="write-ch-arrow">▶</span>
                    <span class="write-ch-pos" onmousedown="event.preventDefault()"
                        onclick="promptMoveChapter('${ch.id}'); event.stopPropagation()"
                        title="Tap to reorder">${ch.order + 1}</span>
                    <input type="text" class="write-ch-title-input" value="${escapeAttr(ch.title)}"
                        onclick="event.stopPropagation()"
                        onchange="renameChapter('${ch.id}', this.value)"
                        onblur="renameChapter('${ch.id}', this.value)"
                        onkeydown="event.stopPropagation()">
                    <span class="write-ch-wc" id="chwc_${ch.id}">${(ch.wordCount || 0).toLocaleString()} WDS</span>
                    <button class="write-ch-btn" onmousedown="event.preventDefault()"
                        onclick="moveChapter('${ch.id}', -1); event.stopPropagation()"
                        ${ch.order === 0 ? 'disabled' : ''}>↑</button>
                    <button class="write-ch-btn" onmousedown="event.preventDefault()"
                        onclick="moveChapter('${ch.id}', 1); event.stopPropagation()"
                        ${ch.order === writingData.chapters.length - 1 ? 'disabled' : ''}>↓</button>
                    <button class="write-ch-btn write-ch-del" onmousedown="event.preventDefault()"
                        onclick="deleteChapter('${ch.id}'); event.stopPropagation()">✕</button>
                    <button class="write-ch-btn write-ch-focus" onmousedown="event.preventDefault()"
                        onclick="focusChapter('${ch.id}'); event.stopPropagation()" title="Focus mode">⛶</button>
                    <button class="write-ch-btn" onmousedown="event.preventDefault()"
                        onclick="shareChapter('${ch.id}'); event.stopPropagation()" title="Share chapter">⤴</button>
                </div>
                <div class="write-chapter-body">
                    <div class="write-toolbar">
                        <div class="write-tb-row write-tb-row-edit">
                            <div class="write-tb-group">
                                <button class="write-tb-btn write-tb-undo" id="undoBtn_${ch.id}" onpointerdown="event.preventDefault()"
                                    onclick="undoChapter('${ch.id}')" title="Undo" aria-label="Undo" disabled>↶</button>
                                <button class="write-tb-btn write-tb-undo" id="redoBtn_${ch.id}" onpointerdown="event.preventDefault()"
                                    onclick="redoChapter('${ch.id}')" title="Redo" aria-label="Redo" disabled>↷</button>
                            </div>
                            <span class="write-tb-sep"></span>
                            <div class="write-tb-group">
                                <button class="write-tb-btn" onpointerdown="event.preventDefault(); document.execCommand('bold')"      title="Bold"><b>B</b></button>
                                <button class="write-tb-btn" onpointerdown="event.preventDefault(); document.execCommand('italic')"    title="Italic"><em>I</em></button>
                                <button class="write-tb-btn" onpointerdown="event.preventDefault(); document.execCommand('underline')" title="Underline"><u>U</u></button>
                                <button class="write-tb-btn" onpointerdown="event.preventDefault(); applyHeading('${ch.id}')"          title="Scene heading">H2</button>
                                <button class="write-tb-btn write-tb-clear" onpointerdown="event.preventDefault(); document.execCommand('removeFormat')" title="Clear formatting" aria-label="Clear formatting">T<sub>x</sub></button>
                            </div>
                        </div>
                        <div class="write-tb-row write-tb-row-view">
                            <div class="write-tb-group write-tb-sizes">
                                <button class="write-fs-btn${currentFontSize==='sm'?' active':''}" onpointerdown="event.preventDefault()" onclick="setFontSize('sm')" title="Small text">A</button>
                                <button class="write-fs-btn${currentFontSize==='md'?' active':''}" onpointerdown="event.preventDefault()" onclick="setFontSize('md')" title="Medium text" style="font-size:0.9rem;">A</button>
                                <button class="write-fs-btn${currentFontSize==='lg'?' active':''}" onpointerdown="event.preventDefault()" onclick="setFontSize('lg')" title="Large text" style="font-size:1.1rem;">A</button>
                            </div>
                            <button class="write-tb-btn write-tb-history" onpointerdown="event.preventDefault()"
                                onclick="openVersionHistory('${ch.id}')" title="Version history">⟲ HISTORY</button>
                        </div>
                    </div>
                    <div class="write-area"
                         contenteditable="true"
                         id="cheditor_${ch.id}"
                         spellcheck="true"
                         oninput="onEditorInput('${ch.id}', event)"
                         onfocus="onEditorFocus('${ch.id}')"
                         onblur="window.DPVersions && DPVersions.sessionEnd('${ch.id}')"></div>
                </div>
            </div>`;
    }).join('');

    // Set content separately; sanitise to strip any imported inline styles
    writingData.chapters.forEach(ch => {
        const editor = document.getElementById('cheditor_' + ch.id);
        if (!editor) return;
        const raw   = ch.content || '';
        const clean = sanitizeHtml(raw);
        editor.innerHTML = clean;
        if (clean !== ch.content) { ch.content = clean; }
        if (window.DPEvidence) {
            try { window.DPEvidence.attach(ch.id, activeProjectId, editor); } catch (err) { console.warn('Writing Record:', err); }
        }
        if (window.DPVersions) {
            try { window.DPVersions.attach(ch.id, activeProjectId, editor.innerHTML); } catch (err) { console.warn('Versions:', err); }
        }
        syncHistoryAfterRender(ch.id, raw, clean);
    });
    // Drop history for chapters that no longer exist
    Object.keys(undoHistories).forEach(id => {
        if (!writingData.chapters.some(c => c.id === id)) delete undoHistories[id];
    });
}

// ── Undo / redo ───────────────────────────────────────────────────────────────
// Each chapter keeps its own history in memory (never written to storage).
// The browser's built-in undo is unreliable here: phones offer no undo control
// for contenteditable, and renderAll() replaces the editors, which wipes the
// native undo stack. Restoring a state goes through the normal save path.
const UNDO_MAX_STEPS   = 100;   // per chapter
const UNDO_IDLE_MS     = 1000;  // a pause in typing starts a new undo step
const UNDO_MAX_STEP_MS = 4000;  // long uninterrupted bursts are split up
const UNDO_BIG_CHANGE  = 30;    // characters; larger single changes get their own step
const undoHistories    = {};

function newHistory(html) {
    return {
        stack: [{ html: html, caret: null, caretBefore: null, sealed: true }],
        index: 0,
        lastInputAt: 0,
        stepStartedAt: 0,
        lastCategory: null,
        forceNext: false,
        pendingBoundary: false,
        lastSelBefore: null
    };
}

// After renderAll() rebuilds an editor, keep its history if the content is the
// state we already know about; otherwise (e.g. newer content arrived from the
// cloud) start a fresh history so undo can never resurrect stale text.
function syncHistoryAfterRender(id, raw, clean) {
    const h = undoHistories[id];
    if (h && h.stack[h.index].html === raw) {
        h.stack[h.index].html = clean;
        h.forceNext = true;
    } else if (!h || h.stack[h.index].html !== clean) {
        undoHistories[id] = newHistory(clean);
    }
    updateUndoButtons(id);
}

function updateUndoButtons(id) {
    const h = undoHistories[id];
    const u = document.getElementById('undoBtn_' + id);
    const r = document.getElementById('redoBtn_' + id);
    if (u) u.disabled = !h || h.index <= 0;
    if (r) r.disabled = !h || h.index >= h.stack.length - 1;
}

// Caret position as a plain-text character offset within the editor
function getCaretOffset(editor, useStart) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return null;
    const pre = document.createRange();
    pre.selectNodeContents(editor);
    if (useStart) pre.setEnd(range.startContainer, range.startOffset);
    else          pre.setEnd(range.endContainer, range.endOffset);
    return pre.toString().length;
}

function rangeAtOffset(editor, offset) {
    const range  = document.createRange();
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let remaining = offset, node, last = null;
    while ((node = walker.nextNode())) {
        last = node;
        if (remaining <= node.length) {
            range.setStart(node, remaining);
            range.collapse(true);
            return range;
        }
        remaining -= node.length;
    }
    if (last) range.setStart(last, last.length);
    else      range.setStart(editor, editor.childNodes.length);
    range.collapse(true);
    return range;
}

function placeCaret(editor, offset) {
    if (offset == null) return;
    const range = rangeAtOffset(editor, offset);
    // Only move the selection if the writer is in this editor — on phones,
    // setting a selection elsewhere can pop the keyboard up unexpectedly.
    if (document.activeElement === editor) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
    // Bring the restored spot into view so the writer can see what changed
    let rect = range.getBoundingClientRect();
    if (!rect || (rect.top === 0 && rect.bottom === 0)) {
        const el = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
        if (el && el.getBoundingClientRect) rect = el.getBoundingClientRect();
    }
    if (!rect) return;
    const scroller = editor.scrollHeight > editor.clientHeight + 1 ? editor : null;
    if (scroller) {
        const box = scroller.getBoundingClientRect();
        if (rect.top < box.top + 20 || rect.bottom > box.bottom - 20) {
            scroller.scrollTop += rect.top - box.top - box.height / 3;
        }
    } else {
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        if (rect.top < 80 || rect.bottom > vh - 40) {
            window.scrollBy(0, rect.top - vh / 3);
        }
    }
}

function inputCategory(type) {
    if (!type) return 'other';
    if (type.startsWith('delete')) return 'delete';
    if (type === 'insertText' || type === 'insertCompositionText') return 'type';
    return type;
}

// Called before the browser applies a change (not fired for execCommand)
function onEditorBeforeInput(e) {
    const editor = e.target.closest && e.target.closest('.write-area');
    if (!editor) return;
    const id = editor.id.replace('cheditor_', '');
    const type = e.inputType || '';

    // Route the browser's own undo/redo (Edit menu, iOS shake, keyboard
    // shortcuts that slip past keydown) through our history instead
    if (type === 'historyUndo' || type === 'historyRedo') {
        e.preventDefault();
        if (type === 'historyUndo') undoChapter(id); else redoChapter(id);
        return;
    }

    const h = undoHistories[id];
    if (!h) return;
    const sel = window.getSelection();
    const hasSelection = sel && sel.rangeCount && !sel.getRangeAt(0).collapsed;
    h.lastSelBefore = getCaretOffset(editor, true);
    if (hasSelection ||
        type === 'deleteByCut' || type === 'deleteByDrag' ||
        type === 'insertFromPaste' || type === 'insertFromDrop' ||
        type === 'insertReplacementText' || type.startsWith('format') ||
        type.startsWith('deleteWord') || type.startsWith('deleteSoftLine') ||
        type.startsWith('deleteHardLine') || type === 'deleteEntireSoftLine') {
        h.pendingBoundary = true;
    }

    // A line break the writer didn't ask for (e.g. some phone keyboards send one
    // for Return) becomes a new paragraph so it gets its indent. Shift+Enter on
    // a physical keyboard still gives a deliberate soft line break.
    if (type === 'insertLineBreak' && Date.now() - lastShiftEnterAt > 500) {
        e.preventDefault();
        document.execCommand('insertParagraph');
    }
}

let lastShiftEnterAt = 0;
document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.shiftKey) lastShiftEnterAt = Date.now();
}, true);

function recordHistory(id, editor, html, inputType) {
    let h = undoHistories[id];
    if (!h) { h = undoHistories[id] = newHistory(html); updateUndoButtons(id); return; }

    const now      = Date.now();
    const cur      = h.stack[h.index];
    if (cur.html === html) return;
    const category = inputCategory(inputType);
    const big      = Math.abs(html.length - cur.html.length) > UNDO_BIG_CHANGE;
    const boundary = h.pendingBoundary || big || (category !== 'type' && category !== 'delete');
    const caret    = getCaretOffset(editor, false);

    const startNew = cur.sealed || h.forceNext || boundary ||
                     category !== h.lastCategory ||
                     now - h.lastInputAt > UNDO_IDLE_MS ||
                     now - h.stepStartedAt > UNDO_MAX_STEP_MS;

    if (startNew) {
        h.stack.length = h.index + 1;            // a new edit discards any redo steps
        h.stack.push({
            html: html,
            caret: caret,
            caretBefore: h.lastSelBefore != null ? h.lastSelBefore : cur.caret,
            sealed: boundary                     // big/structural changes stay a single step
        });
        h.index = h.stack.length - 1;
        h.stepStartedAt = now;
        if (h.stack.length > UNDO_MAX_STEPS) {
            h.stack.shift();
            h.stack[0].sealed = true;
            h.index--;
        }
    } else {
        cur.html  = html;
        cur.caret = caret;
    }

    h.lastInputAt     = now;
    h.lastCategory    = category;
    h.forceNext       = false;
    h.pendingBoundary = false;
    h.lastSelBefore   = null;
    updateUndoButtons(id);
}

function restoreHistoryStep(id, newIndex, caretOffset) {
    const h      = undoHistories[id];
    const editor = document.getElementById('cheditor_' + id);
    if (!h || !editor) return;
    h.index     = newIndex;
    h.forceNext = true;                          // next keystroke starts a fresh step
    editor.innerHTML = h.stack[newIndex].html;
    if (window.DPEvidence) window.DPEvidence.resync(id, editor);   // restored text isn't new writing
    if (window.DPVersions) window.DPVersions.resync(id, editor.innerHTML);
    commitEditorContent(id);
    placeCaret(editor, caretOffset);
    updateUndoButtons(id);
}

window.undoChapter = function(id) {
    const h = undoHistories[id];
    if (!h || h.index <= 0) return;
    const from = h.stack[h.index];
    restoreHistoryStep(id, h.index - 1,
        from.caretBefore != null ? from.caretBefore : h.stack[h.index - 1].caret);
};

window.redoChapter = function(id) {
    const h = undoHistories[id];
    if (!h || h.index >= h.stack.length - 1) return;
    restoreHistoryStep(id, h.index + 1, h.stack[h.index + 1].caret);
};

// ── Editor events ─────────────────────────────────────────────────────────────
window.onEditorInput = function(id, e) {
    const editor = document.getElementById('cheditor_' + id);
    if (!editor) return;
    recordHistory(id, editor, editor.innerHTML, e && e.inputType);
    if (window.DPEvidence) {
        try { window.DPEvidence.recordInput(id, activeProjectId, editor, e && e.inputType); }
        catch (err) { console.warn('Writing Record:', err); }
    }
    if (window.DPVersions) {
        try { window.DPVersions.onInput(id, editor.innerHTML); }
        catch (err) { console.warn('Versions:', err); }
    }
    commitEditorContent(id);
};

// Save the editor's current content: word counts, local storage, cloud
function commitEditorContent(id) {
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
    const sel  = window.getSelection();
    const node = sel && sel.rangeCount ? sel.anchorNode : null;
    const block = node ? (node.nodeType === 3 ? node.parentElement : node) : null;
    const inH   = block && block.closest('h2, h3');
    document.execCommand('formatBlock', false, inH ? 'p' : 'h2');
};

// ── HTML sanitiser — strips inline styles, non-standard tags, keeps structure ─
const ALLOWED_TAGS = new Set(['b','strong','i','em','u','h2','h3','p','br','div']);

function sanitizeHtml(html) {
    if (!html) return '';
    const root = document.createElement('div');
    root.innerHTML = html;
    let dirty = true;
    while (dirty) {
        dirty = false;
        root.querySelectorAll('*').forEach(el => {
            // Strip all attributes from every element
            Array.from(el.attributes).forEach(a => el.removeAttribute(a.name));
            // Unwrap tags that aren't in the allowed set
            if (!ALLOWED_TAGS.has(el.tagName.toLowerCase())) {
                el.replaceWith(...Array.from(el.childNodes));
                dirty = true;
            }
        });
    }
    return root.innerHTML;
}

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
    const total   = writingData.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
    const delta   = writingData.chapters.reduce((s, c) => s + unsyncedWords(c), 0);

    const totalEl = document.getElementById('writeTotalWords');
    if (totalEl) totalEl.textContent = 'TOTAL: ' + total.toLocaleString() + ' WORDS';

    // One button saves to the cloud and adds any new words to the tracker,
    // so it stays available even when there are no new words to add.
    const btn = document.getElementById('syncWordsBtn');
    if (btn) {
        btn.textContent = 'SYNC AND SAVE';
        btn.title       = delta > 0
            ? delta.toLocaleString() + ' new words to add to your tracker'
            : 'All words are on your tracker';
    }
}

// ── Sync to tracker ───────────────────────────────────────────────────────────
window.syncToTracker = function() {
    syncChaptersToTracker(writingData.chapters.map(c => c.id));
};

// Footer button: save every chapter now, then add any new words to the
// tracker (the tracker step still asks first, as before).
window.syncAndSave = function() {
    saveAllNow();
    const fresh = writingData.chapters.reduce((s, c) => s + unsyncedWords(c), 0);
    if (fresh <= 0) {
        showWriteToast(null, '✓ SAVED', 'ALL WORDS ARE ON YOUR TRACKER');
        return;
    }
    syncChaptersToTracker(writingData.chapters.map(c => c.id));
};

// ── Write screen toast notifications ─────────────────────────────────────────
function showWriteToast(spriteSrc, title, subtitle) {
    const el       = document.createElement('div');
    el.className   = 'write-toast';
    el.innerHTML   = (spriteSrc ? `<img src="${spriteSrc}" class="write-toast-sprite">` : '') +
                     `<div><div class="write-toast-title">${title}</div>` +
                     `<div class="write-toast-sub">${subtitle}</div></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 350);
    }, 4000);
}

// ── Chapter sharing ────────────────────────────────────────────────────────────
let _sharingChapterId = null;

window.shareChapter = async function(id) {
    const user = window.getCurrentUser && window.getCurrentUser();
    if (!user) { alert('Sign in to share chapters.'); return; }

    const ch = writingData.chapters.find(c => c.id === id);
    if (!ch) return;

    _sharingChapterId = id;
    document.getElementById('shareChapterName').textContent = ch.title.toUpperCase();
    document.getElementById('shareMsg').textContent = '';

    const select = document.getElementById('shareFriendSelect');
    select.innerHTML = '<option value="">LOADING...</option>';
    document.getElementById('shareOverlay').style.display = 'flex';

    const groupSelect = document.getElementById('shareGroupSelect');
    groupSelect.innerHTML = '<option value="">LOADING...</option>';
    const [friends, activeShares, groups] = await Promise.all([
        window.getFriends(),
        window.getMySharesForChapter(id),
        window.getMyGroups ? window.getMyGroups() : []
    ]);
    _shareGroups = Array.isArray(groups) ? groups : [];
    const groupShared = new Set((activeShares || []).filter(s => s.groupId).map(s => s.groupId));
    const groupChoices = _shareGroups.filter(g => !groupShared.has(g.id) && (g.members || []).length > 1);
    groupSelect.innerHTML = !_shareGroups.length
        ? '<option value="">NOT IN ANY GROUPS YET</option>'
        : groupChoices.length
            ? '<option value="">— SELECT GROUP —</option>' + groupChoices.map(g => `<option value="${escapeAttr(g.id)}">${escapeAttr(g.name)} (${(g.members || []).length - 1} ${((g.members || []).length - 1) === 1 ? 'PERSON' : 'PEOPLE'})</option>`).join('')
            : '<option value="">ALREADY SHARED WITH YOUR GROUPS</option>';

    // Show active shares with revoke buttons
    const activeSection = document.getElementById('activeSharesSection');
    const activeList    = document.getElementById('activeSharesList');
    if (activeShares && activeShares.length > 0) {
        activeSection.style.display = 'block';
        activeList.innerHTML = activeShares.map(s => `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                <span style="flex:1;font-size:0.8rem;letter-spacing:1px;">${s.groupId ? 'GROUP: ' + escapeAttr(s.groupName || '?') + ' (' + (s.sharedWith || []).length + ')' : escapeAttr(s.sharedWithUsernames && s.sharedWithUsernames[0] || '?')}</span>
                <button data-id="${escapeAttr(s.id)}" onclick="revokeShare(this.dataset.id)"
                    style="font-size:0.65rem;padding:4px 8px;background:#333;letter-spacing:1px;white-space:nowrap;">
                    ✕ REVOKE
                </button>
            </div>`).join('');
    } else {
        activeSection.style.display = 'none';
    }

    // Populate friend picker (exclude already-shared friends)
    const sharedUids = new Set((activeShares || []).filter(s => !s.groupId).map(s => s.sharedWith && s.sharedWith[0]));
    if (!friends || friends.error || friends.length === 0) {
        select.innerHTML = '<option value="">NO FRIENDS YET</option>';
        return;
    }
    const available = friends.filter(f => !sharedUids.has(f.uid));
    if (available.length === 0) {
        select.innerHTML = '<option value="">ALL FRIENDS ALREADY HAVE ACCESS</option>';
    } else {
        select.innerHTML = '<option value="">— SELECT FRIEND —</option>' +
            available.map(f => `<option value="${escapeAttr(f.uid)}">${escapeAttr(f.username)}</option>`).join('');
    }
};

window.revokeShare = async function(shareId) {
    const result = await window.deleteShare(shareId);
    if (result && result.success) {
        // Refresh the overlay with the same chapter
        window.shareChapter(_sharingChapterId);
    } else {
        document.getElementById('shareMsg').style.color = '#ff4500';
        document.getElementById('shareMsg').textContent = 'COULD NOT REVOKE';
    }
};

window.closeShareOverlay = function() {
    document.getElementById('shareOverlay').style.display = 'none';
    _sharingChapterId = null;
};

let _shareGroups = [];
// Choosing a friend clears the group choice, and vice versa
window.shareChoice = function(which) {
    const other = document.getElementById(which === 'friend' ? 'shareGroupSelect' : 'shareFriendSelect');
    if (other) other.value = '';
};

window.confirmShare = async function() {
    const select = document.getElementById('shareFriendSelect');
    const msg    = document.getElementById('shareMsg');
    const uid    = select.value;
    const gid    = document.getElementById('shareGroupSelect').value;
    if (!uid && !gid) { msg.style.color = '#ff4500'; msg.textContent = 'CHOOSE A FRIEND OR A GROUP'; return; }
    if (gid) return confirmGroupShare(gid);

    const ch = writingData.chapters.find(c => c.id === _sharingChapterId);
    if (!ch) return;

    const dpData = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
    const proj   = dpData.projects && dpData.projects[activeProjectId];

    msg.style.color = 'var(--text-dim)';
    msg.textContent = 'SHARING...';

    const result = await window.createShare({
        projectId:           activeProjectId,
        projectTitle:        (proj && proj.title) || 'UNTITLED',
        chapterId:           ch.id,
        chapterTitle:        ch.title,
        content:             ch.content,
        wordCount:           ch.wordCount || 0,
        sharedWithUid:       uid,
        sharedWithUsername:  select.options[select.selectedIndex].text
    });

    if (result && result.success) {
        msg.style.color = 'var(--neon)';
        msg.textContent = 'SHARED!';
        setTimeout(window.closeShareOverlay, 1200);
    } else {
        msg.style.color = '#ff4500';
        msg.textContent = (result && result.error) || 'COULD NOT SHARE';
    }
};

async function confirmGroupShare(gid) {
    const msg   = document.getElementById('shareMsg');
    const group = _shareGroups.find(g => g.id === gid);
    const ch    = writingData.chapters.find(c => c.id === _sharingChapterId);
    if (!group || !ch) return;
    const n = (group.members || []).length - 1;
    if (!confirm(`Share "${ch.title}" with all ${n} ${n === 1 ? 'person' : 'people'} in "${group.name}"?\n\nPeople who join the group later won't see it unless you share it again.`)) return;
    const dpData = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
    const proj   = dpData.projects && dpData.projects[activeProjectId];
    msg.style.color = 'var(--text-dim)';
    msg.textContent = 'SHARING...';
    const result = await window.createGroupShare({
        projectId: activeProjectId, projectTitle: (proj && proj.title) || 'UNTITLED',
        chapterId: ch.id, chapterTitle: ch.title, content: ch.content, wordCount: ch.wordCount || 0, group
    });
    if (result && result.success) {
        msg.style.color = 'var(--neon)';
        msg.textContent = 'SHARED WITH THE GROUP!';
        setTimeout(window.closeShareOverlay, 1200);
    } else {
        msg.style.color = '#ff4500';
        msg.textContent = (result && result.error) || 'COULD NOT SHARE';
    }
}

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
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveAllNow();
    }
    // Undo / redo shortcuts inside a chapter use the app's own history
    const editor = e.target && e.target.closest && e.target.closest('.write-area');
    if (editor && (e.metaKey || e.ctrlKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        const id  = editor.id.replace('cheditor_', '');
        if (key === 'z' && !e.shiftKey) { e.preventDefault(); undoChapter(id); }
        else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redoChapter(id); }
    }
});

function saveAllNow() {
    saveMeta();
    setSaveStatus('saving');
    const promises = writingData.chapters.map(ch => {
        if (window.pushWritingChapterToCloud) return window.pushWritingChapterToCloud({ ...ch, projectId: activeProjectId });
        return Promise.resolve();
    });
    Promise.all(promises).then(() => setSaveStatus('saved')).catch(() => setSaveStatus('saved'));
}
window.saveAllNow = saveAllNow;

// ── Export story as RTF ───────────────────────────────────────────────────────
// ── Restore a chapter from version history ──────────────────────────────────
// The current text is saved as a version first (and that save must succeed)
// before anything is replaced, so a restore can always be undone. The restore
// is also a single undo step.
window.restoreChapterVersion = async function(id, html) {
    const ch     = writingData.chapters.find(c => c.id === id);
    const editor = document.getElementById('cheditor_' + id);
    if (!ch || !editor) return false;
    let saved = null;
    try { saved = await window.DPVersions.saveBeforeRestore(id, editor.innerHTML); } catch (e) { saved = null; }
    if (!saved || !saved.stored) {
        alert('Sorry — your current text couldn\'t be saved as a version first, so nothing was changed.');
        return false;
    }
    editor.innerHTML = sanitizeHtml(html);
    recordHistory(id, editor, editor.innerHTML, 'restore');
    if (window.DPEvidence) window.DPEvidence.resync(id, editor);
    window.DPVersions.resync(id, editor.innerHTML);
    commitEditorContent(id);
    updateUndoButtons(id);
    showWriteToast(null, 'VERSION RESTORED', 'YOUR PREVIOUS TEXT IS IN HISTORY');
    return true;
};

// Export lives in export.js; it reads chapters through this getter only.
window.getExportChapters = function() {
    return writingData && Array.isArray(writingData.chapters) ? writingData.chapters : [];
};

// ── Save status indicator ─────────────────────────────────────────────────────
let saveStatusTimer = null;
function setSaveStatus(state) {
    const el = document.getElementById('writeSaveStatus');
    if (!el) return;
    clearTimeout(saveStatusTimer);
    if (state === 'saving') {
        el.textContent = 'SAVING...';
        el.style.color = '';
    } else if (state === 'saved') {
        el.textContent = 'SAVED';
        el.style.color = '';
        saveStatusTimer = setTimeout(() => { el.textContent = ''; }, 2000);
    } else if (state === 'local-only') {
        el.textContent = 'SAVED LOCALLY — cloud sync failed';
        el.style.color = 'var(--color-warning, #c0392b)';
    }
}

// ── Cloud sync ────────────────────────────────────────────────────────────────
const cloudTimers = {};
const pendingCloudSaves = new Set();

function scheduleCloudSave(ch) {
    if (!ch) return;
    pendingCloudSaves.add(ch.id);
    clearTimeout(cloudTimers[ch.id]);
    cloudTimers[ch.id] = setTimeout(async () => {
        if (window.pushWritingChapterToCloud) {
            try {
                await window.pushWritingChapterToCloud({
                    id: ch.id, title: ch.title, content: ch.content,
                    order: ch.order, wordCount: ch.wordCount, syncedWords: ch.syncedWords || 0,
                    projectId: activeProjectId, updatedAt: ch.updatedAt
                });
                setSaveStatus('saved');
            } catch (e) {
                console.warn('Chapter cloud save failed:', e);
                setSaveStatus('local-only');
            }
        } else {
            setSaveStatus('saved');
        }
        pendingCloudSaves.delete(ch.id);
    }, 800);
}

// Flush any unsaved chapters immediately when the page closes
window.addEventListener('beforeunload', () => {
    if (!window.pushWritingChapterToCloud || pendingCloudSaves.size === 0) return;
    pendingCloudSaves.forEach(id => {
        clearTimeout(cloudTimers[id]);
        const ch = writingData && writingData.chapters.find(c => c.id === id);
        if (ch) window.pushWritingChapterToCloud({
            id: ch.id, title: ch.title, content: ch.content,
            order: ch.order, wordCount: ch.wordCount, syncedWords: ch.syncedWords || 0,
            projectId: activeProjectId, updatedAt: ch.updatedAt
        });
    });
});

// On sign-in: compare local vs cloud timestamps and use the newer version
document.addEventListener('dpAuthChanged', async function(e) {
    if (e.detail.user && window.pullEvidenceFromCloud && window.DPEvidence) {
        window.pullEvidenceFromCloud(activeProjectId)
            .then(docs => { if (docs) window.DPEvidence.mergeFromCloud(docs); })
            .catch(err => console.warn('Writing Record pull failed:', err));
    }
    if (!e.detail.user || !window.pullWritingFromCloud) return;
    const cloudChapters = await window.pullWritingFromCloud(activeProjectId);
    if (!cloudChapters || cloudChapters.length === 0) {
        // Nothing in cloud — push whatever we have locally
        if (writingData.chapters.length > 0) {
            writingData.chapters.forEach(ch => {
                if (window.pushWritingChapterToCloud) window.pushWritingChapterToCloud({ ...ch, projectId: activeProjectId });
            });
        }
        return;
    }
    const cloudMax = Math.max(...cloudChapters.map(c => c.updatedAt || 0));
    const localMax = writingData.chapters.length
        ? Math.max(...writingData.chapters.map(c => c.updatedAt || 0))
        : 0;
    if (cloudMax > localMax) {
        writingData.chapters = cloudChapters;
        saveMeta();
        reconcileSyncLedger();
        renderAll();
        updateFooter();
        setSaveStatus('saved');
    } else {
        // Local is newer — push all chapters to cloud to ensure it's current
        writingData.chapters.forEach(ch => {
            if (window.pushWritingChapterToCloud) window.pushWritingChapterToCloud({ ...ch, projectId: activeProjectId });
        });
    }
});

// ── Font size ─────────────────────────────────────────────────────────────────
const FONT_SIZES = { sm: ['0.82rem', '1.6'], md: ['1.05rem', '1.7'], lg: ['1.5rem', '1.8'] };

function applyWriteAreaFontSize() {
    const [fs, lh] = FONT_SIZES[currentFontSize] || FONT_SIZES.md;
    let styleEl = document.getElementById('writeFontSizeStyle');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'writeFontSizeStyle';
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = `.write-area { font-size: ${fs} !important; line-height: ${lh} !important; }`;
    ['sm', 'md', 'lg'].forEach(s => {
        const btn = document.getElementById('fsBtn_' + s);
        if (btn) btn.classList.toggle('active', s === currentFontSize);
    });
}

window.setFontSize = function(size) {
    currentFontSize = size;
    localStorage.setItem('writeFontSize', size);
    applyWriteAreaFontSize();
};

// ── Story import ──────────────────────────────────────────────────────────────
window.triggerImportStory = function() {
    document.getElementById('importStoryFile').value = '';
    document.getElementById('importStoryFile').click();
};

window.importStory = function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
        const raw = ev.target.result;
        const ext = file.name.split('.').pop().toLowerCase();
        let text;
        if (ext === 'rtf') {
            text = rtfToPlainText(raw);
        } else if (ext === 'html' || ext === 'htm') {
            const div = document.createElement('div');
            div.innerHTML = raw;
            text = div.innerText;
        } else {
            text = raw;
        }
        const chapters = splitIntoChapters(text);
        const count = chapters.length;
        if (!confirm(`Import "${file.name}"?\n\n${count} chapter${count !== 1 ? 's' : ''} detected.\nChapters will be added to this project.`)) return;
        chapters.forEach((ch, i) => {
            const id = makeId();
            const order = writingData.chapters.length;
            const lines = ch.body.split('\n').filter(l => l.trim());
            const html = lines.map(l => `<p>${escapeHtml(l)}</p>`).join('');
            const wc = countWords(html);
            writingData.chapters.push({
                id, title: ch.title || ('Chapter ' + (order + 1)),
                order, wordCount: wc, content: html, updatedAt: Date.now() + i
            });
            if (window.DPEvidence) window.DPEvidence.recordNewChapter(id, activeProjectId, lines.join(''), 'import');
        });
        writingData.chapters.forEach((c, i) => c.order = i);
        saveMeta();
        renderAll();
        updateFooter();
        if (window.pushWritingChapterToCloud) {
            writingData.chapters.slice(-chapters.length).forEach(ch => window.pushWritingChapterToCloud({ ...ch, projectId: activeProjectId }));
        }
        showWriteToast(null, '✓ IMPORTED', count + ' CHAPTER' + (count !== 1 ? 'S' : '') + ' ADDED');
    };
    reader.readAsText(file, 'utf-8');
};

function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function rtfToPlainText(rtf) {
    let s = rtf;
    // Drop destination groups (font/colour tables, stylesheets, pictures, etc.)
    s = s.replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|pict|header|footer|object)[^{}]*(?:\{[^{}]*\}[^{}]*)*/g, '');
    // Paragraph / line breaks → newline
    s = s.replace(/\\(?:par|pard|sect|page)\b\s?/g, '\n');
    s = s.replace(/\\line\b\s?/g, '\n');
    // Tab
    s = s.replace(/\\tab\b\s?/g, '\t');
    // Hex escapes  \'XX
    s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => {
        try { return decodeURIComponent('%' + h); } catch { return ''; }
    });
    // Unicode  \uN
    s = s.replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(parseInt(n)));
    // Drop all remaining control words and groups
    s = s.replace(/\\[a-zA-Z*]+[-]?\d*\s?/g, '');
    s = s.replace(/[{}]/g, '');
    // Tidy whitespace
    s = s.replace(/[ \t]+/g, ' ');
    s = s.replace(/\n{3,}/g, '\n\n');
    return s.trim();
}

// Split plain text into chapters based on common heading patterns
function splitIntoChapters(text) {
    const CHAPTER_RE = /^(?:chapter|part|scene|act|prologue|epilogue|interlude)\b[^\n]*/i;
    const lines = text.split(/\r?\n/);
    const chapters = [];
    let current = null;

    for (const raw of lines) {
        const line = raw.trim();
        if (CHAPTER_RE.test(line)) {
            if (current) chapters.push(current);
            current = { title: line, body: '' };
        } else {
            if (!current) current = { title: '', body: '' };
            current.body += (current.body ? '\n' : '') + raw;
        }
    }
    if (current) chapters.push(current);

    // If nothing matched, return the whole text as one chapter
    if (chapters.length === 1 && !chapters[0].title) {
        chapters[0].title = '';
    }
    return chapters.filter(c => c.body.trim() || c.title);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => { init(); applyWriteAreaFontSize(); });
