(function() { const _dp = JSON.parse(localStorage.getItem('draftPunkData') || '{}'); const _ok = _dp.activeProjectId && _dp.projects && _dp.projects[_dp.activeProjectId] && _dp.projects[_dp.activeProjectId].active; if (!_ok) window.location.replace('index.html'); })();
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
    } else if (sprint.remaining <= 5) {
        if (window.SFX) SFX.tick();
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
            // Add to Draft Punk project inventory
            const dpState = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
            const _projId = dpState.activeProjectId;
            const _proj   = _projId && dpState.projects && dpState.projects[_projId];
            if (_proj && !_proj.inventory.includes(rescuedBuddy)) {
                _proj.inventory.push(rescuedBuddy);
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
                ? `${words.toLocaleString()} words written.`
                : `${words.toLocaleString()} words written.\nAll buddies in this tier already rescued!`;
        document.getElementById('wrAddToWriteBtn').style.display = words > 0 ? '' : 'none';
        document.getElementById('wrWinOverlay').style.display = 'flex';
        if (window.SFX) SFX.sprintWon();

        const app = document.querySelector('.app');
        app.classList.remove('app-shake');
        void app.offsetWidth;
        app.classList.add('app-shake');
    } else {
        document.getElementById('wrFailWords').innerText = words.toLocaleString();
        document.getElementById('wrFailTarget').innerText = sprint.target.toLocaleString();
        document.getElementById('wrFailOverlay').style.display = 'flex';
        if (window.SFX) SFX.sprintFailed();
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

window.closeWinOverlay  = function() { document.getElementById('wrWinOverlay').style.display  = 'none'; };
window.closeFailOverlay = function() { document.getElementById('wrFailOverlay').style.display = 'none'; };

window.addSprintToWrite = function() {
    const text = document.getElementById('sprintText').value.trim();
    if (!text) { closeWinOverlay(); return; }

    const dpData = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
    const projId = dpData.activeProjectId;
    if (!projId) { closeWinOverlay(); return; }

    const raw         = JSON.parse(localStorage.getItem('writingData') || '{}');
    const writingData = (raw.projectId === projId && Array.isArray(raw.chapters))
        ? raw
        : { projectId: projId, chapters: [] };

    const now     = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();
    const htmlContent = text.split('\n').map(line => {
        const safe = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return safe ? `<p>${safe}</p>` : '<p><br></p>';
    }).join('');

    const wc = countWords(text);
    const ch = {
        id:        'ch_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        title:     'Sprint — ' + dateStr,
        order:     writingData.chapters.length,
        wordCount: wc,
        content:   htmlContent,
        updatedAt: Date.now()
    };

    writingData.chapters.push(ch);
    localStorage.setItem('writingData', JSON.stringify(writingData));
    // Push to cloud immediately — writingData is not in DATA_KEYS so the normal
    // schedulePush path won't do it, and sign-out before visiting Write would lose it.
    if (window.pushWritingChapterToCloud) {
        window.pushWritingChapterToCloud({ ...ch, projectId: projId })
            .catch(e => console.warn('Sprint chapter cloud push failed:', e));
    }

    document.getElementById('wrWinMessage').innerText =
        `${wc.toLocaleString()} words added to WRITE as "${ch.title}".`;
    document.getElementById('wrAddToWriteBtn').style.display = 'none';
};

function updateWRUI() {
    if (window.updateSidebar) window.updateSidebar();

    if (!sprint.active) {
        document.getElementById('wrCaptivityBar').style.width = '100%';
        if (!selectedTierIdx !== null) {
            document.getElementById('wrBuddySprite').style.filter = 'grayscale(100%) brightness(0.4)';
        }
    }

    renderTierGrid();
}

window.onload = function() { updateWRUI(); };
