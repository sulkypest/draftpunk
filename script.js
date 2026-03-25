console.log("Draft Punk Script Loading...");

let deferredPrompt = null;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;

window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    document.querySelectorAll('.install-btn').forEach(b => b.classList.remove('hidden'));
});

window.addEventListener('appinstalled', () => {
    document.querySelectorAll('.install-btn').forEach(b => b.classList.add('hidden'));
});

window.installApp = function() {
    if (isIOS) {
        document.getElementById('iosInstallOverlay').style.display = 'flex';
    } else if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(() => {
            deferredPrompt = null;
            document.querySelectorAll('.install-btn').forEach(b => b.classList.add('hidden'));
        });
    }
};

window.closeIOSInstall = function() {
    document.getElementById('iosInstallOverlay').style.display = 'none';
};

let chart;
let state = JSON.parse(localStorage.getItem('draftPunkData')) || {
    active: false, title: "", goal: 80000, total: 0, genre: "urbanFantasy",
    logs: [], lastLevel: 0, deadline: "", inventory: [] 
};

const GENRE_STYLES = {
    urbanFantasy: "#0ff", sciFi: "#0fa", fantasy: "#ffd700", horror: "#ff0000",
    cyberpunk: "#f0f", crimeNoir: "#708090", romance: "#ff69b4", thriller: "#ffa500", western: "#cd7f32"
};

function save() { localStorage.setItem('draftPunkData', JSON.stringify(state)); }

window.start = function() {
    state.title = document.getElementById('titleIn').value || "PROJECT";
    state.goal = parseInt(document.getElementById('goalIn').value) || 80000;
    state.deadline = document.getElementById('deadlineIn').value;
    state.genre = document.getElementById('genreIn').value;
    state.active = true;
    state.total = 0;
    state.logs = [{ date: new Date().toLocaleDateString(), total: 0 }];
    save();
    location.reload(); 
};

window.addWords = function() {
    const val = parseInt(document.getElementById('wordIn').value) || 0;
    if (val <= 0) return;
    
    state.total += val;
    state.logs.push({ date: new Date().toLocaleDateString(), total: state.total });
    const progress = (state.total / state.goal) * 100;

    const newIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    if (newIdx > state.lastLevel) {
        state.lastLevel = newIdx;
        document.getElementById('bossBeatTitle').innerText = BOSS_BEATS[newIdx].name;
        document.getElementById('defeatedBossSprite').src = `bosses/${newIdx}.png`;
        document.getElementById('levelOverlay').style.display = 'flex';

        const app = document.querySelector('.app');
        app.classList.remove('app-shake');
        void app.offsetWidth;
        app.classList.add('app-shake');
    }

    if (Math.floor(state.total / 5000) > Math.floor((state.total - val) / 5000)) {
        const totalBuddiesAvailable = 100; 
        const buddyID = Math.floor(Math.random() * totalBuddiesAvailable) + 1;
        const buddyFile = `buddy${buddyID}.png`;

        if (!state.inventory.includes(buddyFile)) {
            state.inventory.push(buddyFile);
            const overlayImg = document.getElementById('newBuddySprite');
            if (overlayImg) {
                overlayImg.src = `buddies/${buddyFile}`;
            }
            document.getElementById('buddyOverlay').style.display = 'flex';
        }
    }

    // TRIGGER SHAKE ANIMATION
    const sprite = document.getElementById('bossSprite');
    sprite.classList.remove('hit-shake');
    void sprite.offsetWidth; // Force reflow to restart animation
    sprite.classList.add('hit-shake');

    save(); updateUI(); updateGraph();
    document.getElementById('wordIn').value = "";
};

function updateUI() {
    const color = GENRE_STYLES[state.genre] || "#0ff";
    document.documentElement.style.setProperty('--neon', color);
    
    const progress = (state.total / state.goal) * 100;
    const curIdx = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    const curB = BOSS_BEATS[curIdx] || BOSS_BEATS[0];
    const nxtB = BOSS_BEATS[curIdx+1] || {pct: 100, name: "The End"};
    
    const beatSpan = nxtB.pct - curB.pct;
    const progressInBeat = progress - curB.pct;
    const hp = Math.max(0, 100 - (progressInBeat / (beatSpan || 1) * 100));

    document.getElementById('wipDisplay').innerText = state.title;
    document.getElementById('lvlName').innerText = `BEAT ${curIdx + 1}: ${curB.name.toUpperCase()}`;
    document.getElementById('bossName').innerText = nxtB.name.toUpperCase();
    document.getElementById('bossHPBar').style.width = hp + "%";
    document.getElementById('hpBar').style.width = Math.min(100, progress) + "%";
    document.getElementById('hpText').innerText = state.total.toLocaleString() + " / " + state.goal.toLocaleString();
    
    document.getElementById('loreBox').innerText = curB.lore;
    document.getElementById('tipsBox').innerText = MICRO_TIPS[Math.min(100, Math.floor(progress))];
    
    document.getElementById('sideLevelNumber').innerText = curIdx + 1;
    document.getElementById('sideRankName').innerText = RANKS[curIdx] || "AUTHOR";
    
    document.getElementById('buddyCountDisplay').innerText = state.inventory.length;
    
    document.getElementById('buddyGallery').innerHTML = state.inventory.map(i =>
        `<img src="buddies/${i}" class="buddy-relic" onclick="showBuddyZoom('buddies/${i}')">`
    ).join('');

    const sprite = document.getElementById('bossSprite');
    
    // SHRINK LOGIC: Scales between 1.0 (100% HP) and 0.3 (0% HP)
    const scaleFactor = 0.3 + (hp / 100) * 0.7;
    sprite.style.transform = `scale(${scaleFactor})`;

    // Load static image for the current boss
    sprite.src = `bosses/${curIdx + 1}.png`;
    sprite.onerror = () => sprite.style.visibility = 'hidden';
    sprite.onload = () => sprite.style.visibility = 'visible';

    if (state.deadline) {
        const diff = new Date(state.deadline) - new Date();
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
        document.getElementById('daysLeftDisplay').innerText = days > 0 ? days : "0";
    }
}

function initGraph() {
    const ctx = document.getElementById('velocityChart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: state.logs.map(l => l.date),
            datasets: [{ 
                data: state.logs.map(l => l.total), 
                borderColor: GENRE_STYLES[state.genre], 
                tension: 0.2, 
                fill: false 
            }]
        },
        options: { 
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { ticks: { color: '#444' } } }
        }
    });
}

function updateGraph() { if(chart) { chart.data.labels = state.logs.map(l => l.date); chart.data.datasets[0].data = state.logs.map(l => l.total); chart.update(); } }
window.toggleIntel = function() { document.getElementById('intelContainer').classList.toggle('hidden'); };
window.showGrenade = function() {
    document.getElementById('inspireText').innerText = GRENADES[Math.floor(Math.random() * GRENADES.length)];
    document.getElementById('grenadeOverlay').style.display = 'flex';
};
window.closeGrenade = function() { document.getElementById('grenadeOverlay').style.display = 'none'; };
window.closeOverlay = function() { document.getElementById('levelOverlay').style.display = 'none'; };
window.closeBuddyOverlay = function() { document.getElementById('buddyOverlay').style.display = 'none'; };
window.showBuddyZoom = function(src) {
    document.getElementById('buddyZoomSprite').src = src;
    document.getElementById('buddyZoomOverlay').style.display = 'flex';
};
window.closeBuddyZoom = function() { document.getElementById('buddyZoomOverlay').style.display = 'none'; };
window.resetGame = function() { if(confirm("Clear all data?")) { localStorage.clear(); location.reload(); }};
window.onload = function() {
    if (isIOS && !isStandalone) {
        document.querySelectorAll('.install-btn').forEach(b => b.classList.remove('hidden'));
    }

    if (state.active) {
        document.getElementById('setup').style.display = 'none';
        document.getElementById('mainDashboard').classList.remove('hidden');
        updateUI(); 
        initGraph();
    } else {
        document.getElementById('setup').style.display = 'block';
        document.getElementById('mainDashboard').classList.add('hidden');
    }
};
