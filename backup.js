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

window.exportData = function() {
    const data = {
        version: 1,
        exported: new Date().toISOString(),
        draftPunkData:  JSON.parse(localStorage.getItem('draftPunkData')  || 'null'),
        beatNotesData:  JSON.parse(localStorage.getItem('beatNotesData')  || 'null'),
        charactersData: JSON.parse(localStorage.getItem('charactersData') || 'null'),
        wordRunnerData: JSON.parse(localStorage.getItem('wordRunnerData') || 'null'),
        writingData:    JSON.parse(localStorage.getItem('writingData')    || 'null'),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `draftpunk-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
};

window.triggerImport = function() {
    document.getElementById('importFileInput').click();
};

window.importData = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);

            if (!data.version) {
                alert('Invalid backup file.');
                return;
            }

            if (!confirm('This will replace all current data with the backup. Continue?')) {
                event.target.value = '';
                return;
            }

            if (data.draftPunkData)  localStorage.setItem('draftPunkData',  JSON.stringify(data.draftPunkData));
            if (data.beatNotesData)  localStorage.setItem('beatNotesData',  JSON.stringify(data.beatNotesData));
            if (data.charactersData) localStorage.setItem('charactersData', JSON.stringify(data.charactersData));
            if (data.wordRunnerData) localStorage.setItem('wordRunnerData', JSON.stringify(data.wordRunnerData));
            if (data.writingData)    localStorage.setItem('writingData',    JSON.stringify(data.writingData));

            location.reload();
        } catch (err) {
            alert('Could not read file — make sure it is a valid Draft Punk backup.');
            event.target.value = '';
        }
    };
    reader.readAsText(file);
};
