(function () {
    const RANKS = [
        "Inkslinger","Plot Scout","Draft Punk","Scene Slasher","Chapter Boss",
        "Word Runner","Arc Architect","Prose Pilot","Theme Weaver","Story Sorcerer",
        "Narrative Knight","Manuscript Mage","World Builder","Legendary Author","The Scribe-anator",
        "Grand Chronicler","Ink Reaper","Verse Vandal","Lore Titan","The Eternal Draft",
        "Chaos Weaver","Word Sovereign","Myth Architect","The Final Draft","GODMODE SCRIBE"
    ];

    function getDPState() {
        const dp = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
        const id = dp.activeProjectId;
        return (id && dp.projects && dp.projects[id]) || null;
    }
    function getWriterLevel(xp) {
        return Math.floor((1 + Math.sqrt(1 + 8 * xp / 1000)) / 2);
    }
    function getWriterLevelThreshold(level) {
        const n = level - 1;
        return 1000 * n * (n + 1) / 2;
    }

    window.updateSidebar = function () {
        const dp          = getDPState();
        const xpNow       = (dp && dp.xp)    || 0;
        const total       = (dp && dp.total)  || 0;
        const deadline    = dp && dp.deadline;
        const writerLevel = getWriterLevel(xpNow);
        const xpThis      = getWriterLevelThreshold(writerLevel);
        const xpNext      = getWriterLevelThreshold(writerLevel + 1);
        const xpPct       = Math.min(100, ((xpNow - xpThis) / (xpNext - xpThis)) * 100);
        const shieldTier  = Math.min(5, Math.ceil(writerLevel / 5));
        const rankName    = RANKS[writerLevel - 1] || 'AUTHOR';

        let daysLeft = '--';
        if (deadline) {
            const days = Math.ceil((new Date(deadline) - new Date()) / 864e5);
            daysLeft = days > 0 ? days : '0';
        }

        function setText(id, val) { const el = document.getElementById(id); if (el) el.innerText = String(val); }
        function setSrc(id, val)  { const el = document.getElementById(id); if (el) el.src = val; }
        function setW(id, val)    { const el = document.getElementById(id); if (el) el.style.width = val; }

        // Desktop sidebars
        setSrc('sbShield', `shields/${shieldTier}.png`);
        setText('sbLevel', writerLevel);
        setText('sbRank',  rankName);
        setW('sbXpBar',    xpPct + '%');
        setText('sbXpText', xpNow.toLocaleString() + ' XP');
        setText('sbWords', total.toLocaleString());
        setText('sbDays',  daysLeft);

        // Mobile overlay
        setSrc('mobShield', `shields/${shieldTier}.png`);
        setText('mobLevel', writerLevel);
        setText('mobRank',  rankName);
        setW('mobXpBar',    xpPct + '%');
        setText('mobXpText', xpNow.toLocaleString() + ' XP');
        setText('mobWords', total.toLocaleString());
        setText('mobDays',  daysLeft);
    };

    function buildHTML() {
        if (document.getElementById('globalSideLeft')) return;

        // ── Game bar (injected on every page) ────────────────────────────────
        const gameBar = document.createElement('div');
        gameBar.id = 'gameBar';
        gameBar.className = 'game-bar';

        const strip = document.createElement('div');
        strip.id        = 'gameStrip';
        strip.className = 'game-strip';
        gameBar.appendChild(strip);

        const appNav = document.querySelector('.app-nav');
        if (appNav && appNav.parentNode) {
            appNav.parentNode.insertBefore(gameBar, appNav.nextSibling);
        } else {
            document.body.insertBefore(gameBar, document.body.firstChild);
        }

        // Toggle button — sibling of gameBar so it's never clipped by overflow:hidden
        const toggleBtn = document.createElement('button');
        toggleBtn.id          = 'gameBarToggle';
        toggleBtn.textContent = '▼ GAME';
        toggleBtn.title       = 'Toggle game bar';
        toggleBtn.onclick     = function () { if (window.toggleGameBar) window.toggleGameBar(); };
        gameBar.parentNode.insertBefore(toggleBtn, gameBar.nextSibling);

        // Apply saved hidden state before content renders
        if (localStorage.getItem('gameBarHidden') === '1') {
            gameBar.classList.add('game-bar-hidden');
            toggleBtn.textContent = '▲ GAME';
            document.body.classList.add('game-bar-off');
        }

        // Load game.js dynamically if not already loaded
        if (!document.querySelector('script[src="game.js"]')) {
            const gs = document.createElement('script');
            gs.src = 'game.js';
            document.head.appendChild(gs);
        }

        // ── Left sidebar (fixed, desktop only) ──────────────────────────────
        const left = document.createElement('div');
        left.id        = 'globalSideLeft';
        left.className = 'sb-fixed sb-fixed-left';
        left.innerHTML = `
            <div class="side-box">
                <a href="index.html">
                    <img src="DRAFTPUNK.png" alt="Draft Punk"
                         style="width:100%;max-width:120px;height:auto;display:block;margin:0 auto;image-rendering:pixelated;filter:drop-shadow(0 0 5px var(--neon));">
                </a>
            </div>
            <div class="side-box">
                <a href="https://www.thewritingcommunitychatshow.com/" target="_blank">
                    <img src="partner.png" alt="Partner"
                         style="width:100%;max-width:120px;height:auto;display:block;margin:0 auto;image-rendering:pixelated;">
                </a>
            </div>`;
        document.body.appendChild(left);

        // ── Right sidebar (fixed, desktop only) ─────────────────────────────
        const right = document.createElement('div');
        right.id        = 'globalSideRight';
        right.className = 'sb-fixed sb-fixed-right';
        right.innerHTML = `
            <div class="side-box">
                <div class="sb-label">LEVEL</div>
                <div class="shield-wrap">
                    <img id="sbShield" src="shields/1.png" class="shield-img">
                    <div id="sbLevel" class="shield-num">1</div>
                </div>
                <div id="sbRank" style="font-size:0.75rem;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim);">--</div>
                <div style="margin-top:8px;">
                    <div class="bar-container" style="height:4px;margin-bottom:3px;border-color:var(--border);">
                        <div id="sbXpBar" class="bar-fill" style="width:0%;"></div>
                    </div>
                    <div id="sbXpText" style="font-size:0.55rem;letter-spacing:1px;color:var(--text-dim);text-align:center;"></div>
                </div>
            </div>
            <div class="side-box">
                <div class="sb-label">WORDS</div>
                <div id="sbWords" style="font-size:1.4rem;font-weight:900;line-height:1;margin:5px 0;color:var(--neon);">0</div>
            </div>
            <div class="side-box">
                <div class="sb-label">DEADLINE</div>
                <div id="sbDays" style="font-size:2.5rem;font-weight:900;line-height:1;margin:5px 0;color:var(--neon);">--</div>
                <div style="font-size:0.7rem;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim);">DAYS LEFT</div>
            </div>`;
        document.body.appendChild(right);

        // ── Mobile floating trigger ──────────────────────────────────────────
        const trigger = document.createElement('button');
        trigger.id        = 'mobSideTrigger';
        trigger.innerHTML = '&#9776;';
        trigger.onclick   = function () {
            document.getElementById('mobSideOverlay').classList.add('open');
        };
        document.body.appendChild(trigger);


        // ── Mobile slide-in overlay ──────────────────────────────────────────
        const overlay = document.createElement('div');
        overlay.id = 'mobSideOverlay';
        overlay.innerHTML = `
            <div id="mobSidePanel">
                <button id="mobSideClose" onclick="document.getElementById('mobSideOverlay').classList.remove('open')">✕ CLOSE</button>
                <div style="text-align:center;margin-bottom:20px;">
                    <a href="index.html">
                        <img src="DRAFTPUNK.png" alt="Draft Punk"
                             style="width:70px;height:auto;image-rendering:pixelated;filter:drop-shadow(0 0 5px var(--neon));">
                    </a>
                </div>
                <div class="side-box" style="margin-bottom:12px;">
                    <div class="sb-label">LEVEL</div>
                    <div class="shield-wrap">
                        <img id="mobShield" src="shields/1.png" class="shield-img">
                        <div id="mobLevel" class="shield-num">1</div>
                    </div>
                    <div id="mobRank" style="font-size:0.75rem;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim);">--</div>
                    <div style="margin-top:8px;">
                        <div class="bar-container" style="height:4px;margin-bottom:3px;border-color:var(--border);">
                            <div id="mobXpBar" class="bar-fill" style="width:0%;"></div>
                        </div>
                        <div id="mobXpText" style="font-size:0.55rem;letter-spacing:1px;color:var(--text-dim);text-align:center;"></div>
                    </div>
                </div>
                <div class="side-box" style="margin-bottom:12px;">
                    <div class="sb-label">WORDS WRITTEN</div>
                    <div id="mobWords" style="font-size:2rem;font-weight:900;color:var(--neon);margin:5px 0;">0</div>
                </div>
                <div class="side-box" style="margin-bottom:12px;">
                    <div class="sb-label">DEADLINE</div>
                    <div id="mobDays" style="font-size:3rem;font-weight:900;color:var(--neon);line-height:1;margin:5px 0;">--</div>
                    <div style="font-size:0.7rem;letter-spacing:1px;color:var(--text-dim);">DAYS LEFT</div>
                </div>
                <div class="side-box">
                    <a href="https://www.thewritingcommunitychatshow.com/" target="_blank">
                        <img src="partner.png" alt="Partner"
                             style="width:100%;max-width:120px;height:auto;display:block;margin:0 auto;image-rendering:pixelated;">
                    </a>
                </div>
            </div>`;
        overlay.onclick = function (e) {
            if (e.target === overlay) overlay.classList.remove('open');
        };
        document.body.appendChild(overlay);

        // ── Nav logo circle ──────────────────────────────────────────────────
        const nav = document.querySelector('.app-nav');
        if (nav) {
            if (!nav.querySelector('.nav-logo-circle')) {
                const logoLink = document.createElement('a');
                logoLink.href      = 'index.html';
                logoLink.className = 'nav-logo-circle';
                logoLink.innerHTML = `<img src="DRAFTPUNK.png" alt="Draft Punk">`;
                nav.appendChild(logoLink);
            }
            const writeBtn = nav.querySelector('.nav-center-btn');
            if (writeBtn) writeBtn.style.display = 'none';

            const notesMenu = document.getElementById('notesMenu');
            if (notesMenu && !notesMenu.querySelector('[href="write.html"]')) {
                const writeLink = document.createElement('a');
                writeLink.href      = 'write.html';
                writeLink.className = 'nav-dropdown-item';
                writeLink.textContent = 'WRITE';
                notesMenu.insertBefore(writeLink, notesMenu.firstChild);
            }
        }

        window.updateSidebar();
        document.body.classList.add('sb-ready');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildHTML);
    } else {
        buildHTML();
    }
})();
