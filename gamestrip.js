(function () {
    'use strict';

    const SH = 55;            // sprite height px  (110 * 0.5)
    const SW = 55;            // sprite width px
    const VIEWPORT_PCT = 28;  // % of world visible across the full strip width
    const GROUND_MARGIN = 8;  // px from bottom

    let canvas = null;
    let ctx = null;
    let frameT = 0;
    let battleFlash = 0;
    let knownDefeated = new Set();
    let prevProgress = -1;

    const playerImg = new Image();
    const bossImgs = {};

    function loadAssets() {
        playerImg.src = 'partner.png';
        for (let i = 1; i <= 15; i++) {
            const img = new Image();
            img.src = `bosses/${i}.png`;
            bossImgs[i] = img;
        }
    }

    function getProgress() {
        try {
            const d = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
            const proj = d.activeProjectId && d.projects && d.projects[d.activeProjectId];
            if (!proj || !proj.goal) return 0;
            return Math.min(100, (proj.total / proj.goal) * 100);
        } catch (e) { return 0; }
    }

    function getAllObstacles() {
        const all = [];
        if (typeof MINIONS !== 'undefined') {
            MINIONS.forEach(m => all.push({ pct: m.pct, type: 'minion', emoji: m.emoji }));
        }
        if (typeof BOSS_BEATS !== 'undefined') {
            BOSS_BEATS.forEach((b, i) => all.push({ pct: b.pct, type: 'boss', bossIdx: i + 1 }));
        }
        return all.sort((a, b) => a.pct - b.pct);
    }

    function worldToCanvas(worldPct, progress, W) {
        const playerX = W * 0.30;
        const pxPerPct = W / VIEWPORT_PCT;
        return playerX + (worldPct - progress) * pxPerPct;
    }

    function loop() {
        requestAnimationFrame(loop);
        if (!ctx || !canvas) return;
        frameT++;

        const W = canvas.width;
        const H = canvas.height;
        const progress = getProgress();
        const obstacles = getAllObstacles();
        const groundY = H - GROUND_MARGIN;
        const baseY = groundY - SH;

        // Detect newly crossed thresholds
        if (prevProgress >= 0) {
            obstacles.forEach(obs => {
                const key = `${obs.type}_${obs.pct}`;
                if (progress >= obs.pct && prevProgress < obs.pct && !knownDefeated.has(key)) {
                    battleFlash = 50;
                }
                if (progress >= obs.pct) knownDefeated.add(key);
            });
        }
        prevProgress = progress;

        // Background
        ctx.fillStyle = '#080808';
        ctx.fillRect(0, 0, W, H);

        // Ground line
        ctx.strokeStyle = '#1c1c1c';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, groundY);
        ctx.lineTo(W, groundY);
        ctx.stroke();

        // Draw obstacles
        obstacles.forEach(obs => {
            const cx = worldToCanvas(obs.pct, progress, W);
            if (cx < -SW * 2 || cx > W + SW * 2) return;

            const defeated = progress >= obs.pct;
            const idleY = defeated ? 0 : Math.sin(frameT * 0.05 + obs.pct * 0.3) * 3;

            ctx.globalAlpha = defeated ? 0.12 : 1.0;

            if (obs.type === 'boss') {
                const img = bossImgs[obs.bossIdx];
                if (img && img.complete && img.naturalWidth > 0) {
                    ctx.drawImage(img, cx - SW / 2, baseY + idleY, SW, SH);
                }
            } else {
                const emojiSize = Math.round(SH * 0.75);
                ctx.font = `${emojiSize}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillStyle = '#ffffff';
                ctx.fillText(obs.emoji, cx, groundY + idleY);
            }

            ctx.globalAlpha = 1.0;
        });

        // Player — always at 30% x, bobbing when in progress
        const playerX = W * 0.30;
        const walkBob = progress < 100 ? Math.sin(frameT * 0.18) * 3 : 0;
        if (playerImg.complete && playerImg.naturalWidth > 0) {
            ctx.drawImage(playerImg, playerX - SW / 2, baseY + walkBob, SW, SH);
        } else {
            ctx.fillStyle = '#39ff14';
            ctx.fillRect(playerX - SW / 4, baseY + walkBob + SH * 0.5, SW / 2, SH / 2);
        }

        // Battle flash overlay
        if (battleFlash > 0) {
            const t = battleFlash / 50;
            ctx.fillStyle = `rgba(255, 210, 40, ${t * 0.45})`;
            ctx.fillRect(0, 0, W, H);
            if (battleFlash > 28) {
                ctx.globalAlpha = (battleFlash - 28) / 22;
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 11px "Courier New", monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('DEFEATED', W / 2, H / 2);
                ctx.globalAlpha = 1.0;
            }
            battleFlash--;
        }
    }

    function initStrip() {
        const container = document.getElementById('gameStripContainer');
        if (!container || canvas) return;

        canvas = document.createElement('canvas');
        const w = container.clientWidth || 360;
        canvas.width = w;
        canvas.height = 90;
        canvas.style.cssText = 'width:100%;height:90px;display:block;image-rendering:pixelated;cursor:pointer;';
        canvas.addEventListener('click', function () {
            if (window.showBossZoom) window.showBossZoom();
        });
        container.appendChild(canvas);
        ctx = canvas.getContext('2d');

        // Mark existing defeated obstacles so no flash on load
        const progress = getProgress();
        prevProgress = progress;
        getAllObstacles().forEach(obs => {
            if (progress >= obs.pct) knownDefeated.add(`${obs.type}_${obs.pct}`);
        });

        loadAssets();
        loop();

        window.addEventListener('resize', () => {
            if (container && canvas) canvas.width = container.clientWidth || 360;
        });
    }

    // External hook: trigger a battle flash (called from script.js on threshold cross)
    window.triggerBattleFlash = function () { battleFlash = 50; };

    // Delay init until showDashboard fires (data.js must be loaded first)
    const _origShowDash = window.showDashboard;
    window.showDashboard = function () {
        if (_origShowDash) _origShowDash.apply(this, arguments);
        setTimeout(initStrip, 80);
    };
}());
