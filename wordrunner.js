console.log("Wordrunner Script Loading...");

let wrState = JSON.parse(localStorage.getItem('wordRunnerData')) || {
    level: 0,
    sprintsWon: 0
};

let sprint = {
    active: false,
    duration: 0,
    remaining: 0,
    target: 0,
    isCustom: false,
    addToDraftPunk: false,
    intervalId: null
};

function wrSave() { localStorage.setItem('wordRunnerData', JSON.stringify(wrState)); }

function countWords(text) {
    if (!text.trim()) return 0;
    return text.trim().split(/\s+/).length;
}

function formatTime(s) {
    return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

window.startSprint = function() {
    sprint.isCustom = document.getElementById('customToggle').checked;
    sprint.addToDraftPunk = document.getElementById('dpToggle').checked;

    if (sprint.isCustom) {
        sprint.duration = parseInt(document.getElementById('durationSelect').value) * 60;
        sprint.target = parseInt(document.getElementById('customTarget').value) || 0;
        if (sprint.target <= 0) { alert('Please set a word target.'); return; }
    } else {
        const boss = WR_BOSSES[wrState.level];
        sprint.duration = boss.duration * 60;
        sprint.target = boss.target;
    }

    sprint.remaining = sprint.duration;
    sprint.active = true;

    document.getElementById('sprintText').value = '';
    document.getElementById('sprintTargetDisplay').innerText = sprint.target.toLocaleString();
    document.getElementById('sprintWordCount').innerText = '0';
    document.getElementById('sprintBar').style.width = '0%';
    document.getElementById('timerDisplay').innerText = formatTime(sprint.remaining);
    document.getElementById('challengeSetup').classList.add('hidden');
    document.getElementById('activeSprint').classList.remove('hidden');

    sprint.intervalId = setInterval(tick, 1000);
};

function tick() {
    sprint.remaining--;
    document.getElementById('timerDisplay').innerText = formatTime(sprint.remaining);

    if (sprint.remaining <= 0) {
        clearInterval(sprint.intervalId);
        sprint.active = false;
        endSprint(countWords(document.getElementById('sprintText').value) >= sprint.target);
    }
}

window.onSprintInput = function() {
    if (!sprint.active) return;
    const words = countWords(document.getElementById('sprintText').value);
    document.getElementById('sprintWordCount').innerText = words;
    document.getElementById('sprintBar').style.width = Math.min(100, (words / sprint.target) * 100) + '%';

    if (sprint.target > 0 && words >= sprint.target) {
        clearInterval(sprint.intervalId);
        sprint.active = false;
        endSprint(true);
    }
};

function endSprint(won) {
    const words = countWords(document.getElementById('sprintText').value);

    if (sprint.addToDraftPunk && words > 0) {
        const dpState = JSON.parse(localStorage.getItem('draftPunkData'));
        if (dpState && dpState.active) {
            dpState.total += words;
            dpState.logs.push({ date: new Date().toLocaleDateString(), total: dpState.total });
            localStorage.setItem('draftPunkData', JSON.stringify(dpState));
        }
    }

    document.getElementById('challengeSetup').classList.remove('hidden');
    document.getElementById('activeSprint').classList.add('hidden');

    if (won) {
        const defeatedLevel = wrState.level;
        wrState.sprintsWon++;
        if (!sprint.isCustom && wrState.level < WR_BOSSES.length - 1) {
            wrState.level++;
        }
        wrSave();
        updateWRUI();

        const overlay = document.getElementById('wrWinOverlay');
        document.getElementById('wrWinTitle').innerText = sprint.isCustom ? 'SPRINT COMPLETE!' : 'BOSS DEFEATED!';
        document.getElementById('wrDefeatedSprite').src = `bosses/${defeatedLevel + 1}.png`;
        document.getElementById('wrDefeatedSprite').style.display = sprint.isCustom ? 'none' : 'block';
        document.getElementById('wrWinMessage').innerText = sprint.isCustom
            ? `${words.toLocaleString()} words written!`
            : `${WR_BOSSES[defeatedLevel].name} defeated!\nTry again for a new challenge!`;
        overlay.style.display = 'flex';

        const app = document.querySelector('.app');
        app.classList.remove('app-shake');
        void app.offsetWidth;
        app.classList.add('app-shake');
    } else {
        document.getElementById('wrFailWords').innerText = words.toLocaleString();
        document.getElementById('wrFailTarget').innerText = sprint.target.toLocaleString();
        document.getElementById('wrFailOverlay').style.display = 'flex';
        updateWRUI();
    }
}

window.stopSprint = function() {
    if (!sprint.active) return;
    if (!confirm('Abandon this sprint?')) return;
    clearInterval(sprint.intervalId);
    sprint.active = false;
    document.getElementById('challengeSetup').classList.remove('hidden');
    document.getElementById('activeSprint').classList.add('hidden');
};

window.toggleCustom = function() {
    const isCustom = document.getElementById('customToggle').checked;
    document.getElementById('customSprintConfig').classList.toggle('hidden', !isCustom);
    document.getElementById('bossChallenge').classList.toggle('hidden', isCustom);
};

window.closeWinOverlay = function() { document.getElementById('wrWinOverlay').style.display = 'none'; };
window.closeFailOverlay = function() { document.getElementById('wrFailOverlay').style.display = 'none'; };

function updateWRUI() {
    const boss = WR_BOSSES[wrState.level];
    document.getElementById('wrBossName').innerText = boss.name.toUpperCase();
    document.getElementById('wrBossSprite').src = `bosses/${wrState.level + 1}.png`;
    document.getElementById('wrLevelNumber').innerText = wrState.level + 1;
    document.getElementById('wrRankName').innerText = WR_RANKS[wrState.level] || 'WORDRUNNER';
    document.getElementById('wrSprintsWon').innerText = wrState.sprintsWon;
    document.getElementById('challengeDuration').innerText = boss.duration;
    document.getElementById('challengeTarget').innerText = boss.target.toLocaleString();

    const dpState = JSON.parse(localStorage.getItem('draftPunkData'));
    if (dpState && dpState.active) {
        document.getElementById('dpToggleContainer').classList.remove('hidden');
        document.getElementById('dpProjectName').innerText = dpState.title;
    } else {
        document.getElementById('dpToggleContainer').classList.add('hidden');
    }
}

window.onload = function() { updateWRUI(); };
