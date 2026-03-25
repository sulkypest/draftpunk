console.log("Wordrunner Script Loading...");
(function() { const d = JSON.parse(localStorage.getItem('draftPunkData') || '{}'); if (!d.active) window.location.replace('index.html'); })();

let wrState = JSON.parse(localStorage.getItem('wordRunnerData')) || {
    sprintsWon: 0,
    rescued: []
};
// Migrate old format
if (!Array.isArray(wrState.rescued)) wrState.rescued = [];

let sprint = {
    active: false,
    duration: 0,
    remaining: 0,
    target: 0,
    isCustom: false,
    addToDraftPunk: false,
    intervalId: null
};

let selectedTierIdx = null;
let selectedBuddy = null;

function wrSave() { localStorage.setItem('wordRunnerData', JSON.stringify(wrState)); }

function countWords(text) {
    if (!text.trim()) return 0;
    return text.trim().split(/\s+/).length;
}

function formatTime(s) {
    return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

function getWRLevel() {
    const n = wrState.rescued.length;
    if (n < 5)  return 0;
    if (n < 10) return 1;
    if (n < 15) return 2;
    if (n < 20) return 3;
    if (n < 30) return 4;
    if (n < 45) return 5;
    if (n < 65) return 6;
    if (n < 85) return 7;
    return 8;
}

function countRescuedInTier(tier) {
    let count = 0;
    for (let i = tier.buddyRange[0]; i <= tier.buddyRange[1]; i++) {
        if (wrState.rescued.includes(`buddy${i}.png`)) count++;
    }
    return count;
}

function getRandomBuddyForTier(tier) {
    const available = [];
    for (let i = tier.buddyRange[0]; i <= tier.buddyRange[1]; i++) {
        const f = `buddy${i}.png`;
        if (!wrState.rescued.includes(f)) available.push(f);
    }
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
}

function updateBuddyProgress(words) {
    const pct = sprint.target > 0 ? Math.min(1, words / sprint.target) : 0;
    document.getElementById('wrCaptivityBar').style.width = Math.max(0, 100 - pct * 100) + '%';
    const grayscale = Math.round((1 - pct) * 100);
    const brightness = 0.4 + pct * 0.6;
    const glow = Math.round(pct * 20);
    document.getElementById('wrBuddySprite').style.filter =
        `grayscale(${grayscale}%) brightness(${brightness}) drop-shadow(0 0 ${glow}px var(--neon))`;
}

function renderTierGrid() {
    const grid = document.getElementById('tierGrid');
    grid.innerHTML = WR_TIERS.map((tier, i) => {
        const rescued = countRescuedInTier(tier);
        const total = tier.buddyRange[1] - tier.buddyRange[0] + 1;
        const complete = rescued === total;
        const selected = selectedTierIdx === i;
        return `<div class="tier-card${selected ? ' selected' : ''}${complete ? ' complete' : ''}" onclick="selectTier(${i})">
            <div class="tier-duration">${tier.duration}<span style="font-size:0.55rem;opacity:0.7;"> MIN</span></div>
            <div class="tier-label">${tier.label.toUpperCase()}</div>
            <div class="tier-rescued">${rescued}/${total}</div>
        </div>`;
    }).join('');
}

window.selectTier = function(idx) {
    if (sprint.active) return;
    selectedTierIdx = idx;
    const tier = WR_TIERS[idx];
    selectedBuddy = getRandomBuddyForTier(tier);

    const rescued = countRescuedInTier(tier);
    const total = tier.buddyRange[1] - tier.buddyRange[0] + 1;
    const allDone = rescued === total;

    document.getElementById('wrMissionName').innerText = tier.label.toUpperCase();
    document.getElementById('challengeDuration').innerText = tier.duration;
    document.getElementById('challengeTarget').innerText = tier.target.toLocaleString();
    document.getElementById('tierInfo').classList.remove('hidden');
    document.getElementById('tierBuddyStatus').innerText = allDone
        ? `ALL ${total} BUDDIES RESCUED FROM THIS TIER`
        : `${rescued} of ${total} buddies rescued`;

    if (selectedBuddy) {
        document.getElementById('wrBuddySprite').src = `buddies/${selectedBuddy}`;
    }
    document.getElementById('wrBuddySprite').style.filter = 'grayscale(100%) brightness(0.4)';
    document.getElementById('wrCaptivityBar').style.width = '100%';

    const btn = document.getElementById('startBtn');
    btn.disabled = false;
    btn.innerText = 'START SPRINT';

    renderTierGrid();
};

window.startSprint = function() {
    sprint.isCustom = document.getElementById('customToggle').checked;
    sprint.addToDraftPunk = document.getElementById('dpToggle').checked;

    if (sprint.isCustom) {
        sprint.duration = parseInt(document.getElementById('durationSelect').value) * 60;
        sprint.target = parseInt(document.getElementById('customTarget').value) || 0;
        if (sprint.target <= 0) { alert('Please set a word target.'); return; }
    } else {
        if (selectedTierIdx === null) { alert('Please select a mission tier.'); return; }
        const tier = WR_TIERS[selectedTierIdx];
        sprint.duration = tier.duration * 60;
        sprint.target = tier.target;
    }

    sprint.remaining = sprint.duration;
    sprint.active = true;

    document.getElementById('sprintText').value = '';
    document.getElementById('sprintTargetDisplay').innerText = sprint.target.toLocaleString();
    document.getElementById('sprintWordCount').innerText = '0';
    document.getElementById('sprintBar').style.width = '0%';
    document.getElementById('timerDisplay').innerText = formatTime(sprint.remaining);

    updateBuddyProgress(0);

    document.getElementById('challengeSetup').classList.add('hidden');
    document.getElementById('sprintControls').classList.remove('hidden');
    document.getElementById('textareaSection').classList.remove('hidden');
    document.getElementById('abandonBtn').classList.remove('hidden');
    document.getElementById('copyBtn').classList.add('hidden');

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
    updateBuddyProgress(words);

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

    document.getElementById('sprintControls').classList.add('hidden');
    document.getElementById('challengeSetup').classList.remove('hidden');
    document.getElementById('abandonBtn').classList.add('hidden');
    document.getElementById('copyBtn').classList.remove('hidden');

    if (won) {
        wrState.sprintsWon++;

        let rescuedBuddy = null;
        if (!sprint.isCustom && selectedBuddy) {
            rescuedBuddy = selectedBuddy;
            if (!wrState.rescued.includes(rescuedBuddy)) {
                wrState.rescued.push(rescuedBuddy);
            }
            // Add to Draft Punk inventory
            const dpState = JSON.parse(localStorage.getItem('draftPunkData'));
            if (dpState && !dpState.inventory.includes(rescuedBuddy)) {
                dpState.inventory.push(rescuedBuddy);
                localStorage.setItem('draftPunkData', JSON.stringify(dpState));
            }
        }

        wrSave();
        updateWRUI();

        document.getElementById('wrWinTitle').innerText = sprint.isCustom ? 'SPRINT COMPLETE!' : 'BUDDY RESCUED!';
        document.getElementById('wrRescuedSprite').src = rescuedBuddy ? `buddies/${rescuedBuddy}` : '';
        document.getElementById('wrRescuedSprite').style.display = rescuedBuddy ? 'block' : 'none';
        document.getElementById('wrWinMessage').innerText = sprint.isCustom
            ? `${words.toLocaleString()} words written!`
            : rescuedBuddy
                ? `${words.toLocaleString()} words written.\nTry again for a new rescue mission!`
                : `${words.toLocaleString()} words written.\nAll buddies in this tier already rescued!`;
        document.getElementById('wrWinOverlay').style.display = 'flex';

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

    // Pick a fresh buddy preview for next sprint
    if (!sprint.isCustom && selectedTierIdx !== null) {
        selectedBuddy = getRandomBuddyForTier(WR_TIERS[selectedTierIdx]);
        renderTierGrid();
    }
}

window.copySprintText = function() {
    const text = document.getElementById('sprintText').value;
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('copyBtn');
        const original = btn.innerText;
        btn.innerText = 'COPIED!';
        setTimeout(() => { btn.innerText = original; }, 2000);
    });
};

window.stopSprint = function() {
    if (!sprint.active) return;
    if (!confirm('Abandon this sprint?')) return;
    clearInterval(sprint.intervalId);
    sprint.active = false;
    document.getElementById('sprintControls').classList.add('hidden');
    document.getElementById('challengeSetup').classList.remove('hidden');
    document.getElementById('abandonBtn').classList.add('hidden');
    document.getElementById('copyBtn').classList.remove('hidden');
    updateWRUI();
};

window.toggleCustom = function() {
    const isCustom = document.getElementById('customToggle').checked;
    document.getElementById('customSprintConfig').classList.toggle('hidden', !isCustom);
    document.getElementById('tierGridWrapper').classList.toggle('hidden', isCustom);
    document.getElementById('tierInfo').classList.toggle('hidden', isCustom || selectedTierIdx === null);

    const btn = document.getElementById('startBtn');
    if (isCustom) {
        btn.disabled = false;
        btn.innerText = 'START SPRINT';
        document.getElementById('wrMissionName').innerText = 'CUSTOM SPRINT';
        document.getElementById('wrBuddySprite').style.filter = 'grayscale(100%) brightness(0.4)';
    } else {
        if (selectedTierIdx === null) {
            btn.disabled = true;
            btn.innerText = 'SELECT A MISSION TO START';
        }
    }
};

window.closeWinOverlay = function() { document.getElementById('wrWinOverlay').style.display = 'none'; };
window.closeFailOverlay = function() { document.getElementById('wrFailOverlay').style.display = 'none'; };

function updateWRUI() {
    const level = getWRLevel();
    document.getElementById('wrLevelNumber').innerText = level + 1;
    document.getElementById('wrRankName').innerText = WR_RANKS[level] || 'MASTER RESCUER';
    document.getElementById('wrSprintsWon').innerText = wrState.rescued.length;

    if (!sprint.active) {
        document.getElementById('wrCaptivityBar').style.width = '100%';
        if (!selectedTierIdx !== null) {
            document.getElementById('wrBuddySprite').style.filter = 'grayscale(100%) brightness(0.4)';
        }
    }

    const dpState = JSON.parse(localStorage.getItem('draftPunkData'));
    if (dpState && dpState.active) {
        document.getElementById('dpToggleContainer').classList.remove('hidden');
        document.getElementById('dpProjectName').innerText = dpState.title;
    } else {
        document.getElementById('dpToggleContainer').classList.add('hidden');
    }

    renderTierGrid();
}

window.onload = function() { updateWRUI(); };
