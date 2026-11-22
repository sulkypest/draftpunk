function closeAllNavMenus() {
    ['draftMenu', 'dataMenu', 'notesMenu'].forEach(function(id) {
        const m = document.getElementById(id);
        if (m) m.classList.remove('open');
    });
}

window.toggleDraftMenu = function() {
    const menu = document.getElementById('draftMenu');
    const wasOpen = menu && menu.classList.contains('open');
    closeAllNavMenus();
    if (!wasOpen && menu) menu.classList.add('open');
};

window.toggleDataMenu = function() {
    const menu = document.getElementById('dataMenu');
    const wasOpen = menu && menu.classList.contains('open');
    closeAllNavMenus();
    if (!wasOpen && menu) menu.classList.add('open');
};

window.toggleNotesMenu = function() {
    const menu = document.getElementById('notesMenu');
    const wasOpen = menu && menu.classList.contains('open');
    closeAllNavMenus();
    if (!wasOpen && menu) menu.classList.add('open');
};

document.addEventListener('click', function(e) {
    if (!e.target.closest('.nav-dropdown')) closeAllNavMenus();
});

// ── Backup ────────────────────────────────────────────────────────────────────
// A file of everything: every project's chapters (this device's copy and, for
// signed-in writers, the cloud's — the newer copy of each chapter), notes,
// characters, beat notes and stats. Reading only: nothing is changed.
const BACKUP_KEYS = ['draftPunkData', 'beatNotesData', 'charactersData', 'wordRunnerData', 'writingData', 'notesData', 'dpStreak'];

window.exportData = async function() {
    const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    const data = { version: 2, app: 'Draft Punk', exported: new Date().toISOString() };
    BACKUP_KEYS.forEach(k => { data[k] = read(k); });

    const chaptersByProject = {};
    const local = data.writingData;
    if (local && local.projectId && Array.isArray(local.chapters)) chaptersByProject[local.projectId] = local.chapters.slice();

    let cloudMissed = false;
    const projectIds = Object.keys((data.draftPunkData && data.draftPunkData.projects) || {});
    if (localStorage.getItem('dpUserId') && window.pullWritingFromCloud) {
        for (const pid of projectIds) {
            let cloud = null;
            try { cloud = await window.pullWritingFromCloud(pid); } catch (e) { cloud = null; }
            if (!cloud) { cloudMissed = true; continue; }
            // Keep the newer copy of each chapter
            const byId = {};
            (chaptersByProject[pid] || []).forEach(c => { if (c && c.id) byId[c.id] = c; });
            cloud.forEach(c => {
                if (!c || !c.id) return;
                if (!byId[c.id] || (c.updatedAt || 0) > (byId[c.id].updatedAt || 0)) byId[c.id] = c;
            });
            chaptersByProject[pid] = Object.values(byId).sort((a, b) => (a.order || 0) - (b.order || 0));
        }
    }
    data.chaptersByProject = chaptersByProject;

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `draftpunk-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    if (cloudMissed) {
        alert('Backup saved, but the cloud couldn\'t be reached, so it holds only the chapters on this device. Try again when you\'re online for a complete backup.');
    }
};

// ── Restore ───────────────────────────────────────────────────────────────────
// Restoring only ever ADDS copies from the backup to the open project (see
// import.js). It never replaces anything already stored.
window.dpRestore = function() {
    if (window.DPImport && document.getElementById('writeChapterList')) window.DPImport.open('backup');
    else location.href = 'write.html?restore=1';
};
// Older pages cached by the browser may still call these
window.triggerImport = window.dpRestore;
window.importData = function(event) { if (event && event.target) event.target.value = ''; window.dpRestore(); };
