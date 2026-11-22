// ── Draft Punk visual effects ────────────────────────────────────────────────
// Comic-book pop-ups ("DEFEATED!", "POW!") and number count-ups, shared by the
// dashboard and the Write page. Display only: nothing here reads or writes
// any saved data.
(function (root) {
    'use strict';

    function reduced() {
        try { return root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
    }

    // Jagged starburst behind the lettering, in the same spirit as the "VS"
    // badge on the stage-map boss art. Points alternate long/short with a
    // little irregularity so it looks hand-cut rather than geometric.
    function burstPath(points) {
        const out = [];
        for (let i = 0; i < points * 2; i++) {
            const a = (Math.PI * i) / points - Math.PI / 2;
            const r = i % 2 === 0 ? 48 - (i % 4 === 0 ? 0 : 4) : 31 + (i % 3) * 2;
            out.push((50 + Math.cos(a) * r).toFixed(1) + ',' + (50 + Math.sin(a) * r * 0.78).toFixed(1));
        }
        return out.join(' ');
    }
    const BURST_BIG   = burstPath(14);
    const BURST_SMALL = burstPath(10);

    // One pop-up at a time per layer, so a burst of events reads as a sequence
    let bigQueue = [], bigBusy = false;

    // text:  the word(s) to show
    // opts.tone: 'red' (bosses), 'green' (minions), 'ink' (level ups etc.)
    // opts.at:   an element to pop over (small pop-up); omit for a big
    //            pop-up in the middle of the screen
    function comic(text, opts) {
        opts = opts || {};
        if (opts.at) return place(text, opts);
        bigQueue.push([text, opts]);
        if (bigBusy) return;
        bigBusy = true;
        (function next() {
            const item = bigQueue.shift();
            if (!item) { bigBusy = false; return; }
            place(item[0], item[1]);
            setTimeout(next, reduced() ? 900 : 1100);
        })();
    }

    function place(text, opts) {
        const tone  = opts.tone || 'red';
        const small = !!opts.at;
        const el = document.createElement('div');
        el.className = 'dp-comic dp-comic-' + tone + (small ? ' dp-comic-small' : '') + (reduced() ? ' dp-comic-still' : '');
        el.setAttribute('aria-hidden', 'true');
        // A slight random tilt so repeated pop-ups don't look stamped out
        const tilt = (small ? -10 : -7) + Math.round(Math.random() * 6);
        el.style.setProperty('--tilt', tilt + 'deg');
        el.innerHTML =
            '<svg class="dp-comic-burst" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="' +
            (small ? BURST_SMALL : BURST_BIG) + '"/></svg>' +
            '<span class="dp-comic-text"></span>';
        el.querySelector('.dp-comic-text').textContent = text;

        if (small) {
            const r = opts.at.getBoundingClientRect();
            el.style.left = (r.left + r.width / 2) + 'px';
            el.style.top  = (r.top - 6) + 'px';
        }
        document.body.appendChild(el);
        setTimeout(() => el.remove(), small ? 1100 : 1500);
    }

    // Counts an element's number up from `from` to `to`
    function countUp(el, from, to, ms, format) {
        if (!el) return;
        const fmt = format || (n => n.toLocaleString());
        if (reduced() || from === to) { el.textContent = fmt(to); return; }
        const t0 = performance.now();
        (function step(now) {
            const k = Math.min(1, (now - t0) / ms);
            const e = 1 - Math.pow(1 - k, 3);   // ease out
            el.textContent = fmt(Math.round(from + (to - from) * e));
            if (k < 1) requestAnimationFrame(step);
        })(t0);
    }

    // Word lists for the pop-ups, kept together so they're easy to change
    const WORDS = {
        boss:    'DEFEATED!',
        victory: 'VICTORY!',
        levelUp: 'LEVEL UP!',
        buddy:   'NEW BUDDY!',
        minion:  ['POW!', 'WHAM!', 'KAPOW!', 'SPLAT!', 'BOOM!']
    };
    function minionWord(i) { return WORDS.minion[Math.abs(i | 0) % WORDS.minion.length]; }

    root.DPFx = { comic: comic, countUp: countUp, reduced: reduced, WORDS: WORDS, minionWord: minionWord };
})(window);

// ── Animated stage-map bosses ────────────────────────────────────────────────
// Each bosses-anim/bossN.webp is a sheet of cells, one row each for idle,
// hurt and die. Every cell is drawn at the SAME scale, so a boss never
// changes size between idling, flinching and falling. A cell is 614x333px:
// the standing boss fills the 256x256 square starting 179px in from the left;
// the extra room either side and below is for the death fall.
// Display only.
(function (root) {
    'use strict';
    const SHEETS = [{"cols":6,"idle":6,"hurt":2,"die":0},{"cols":6,"idle":6,"hurt":2,"die":3},{"cols":6,"idle":6,"hurt":2,"die":3},{"cols":6,"idle":6,"hurt":2,"die":3},{"cols":6,"idle":6,"hurt":2,"die":3},{"cols":6,"idle":6,"hurt":2,"die":2},{"cols":6,"idle":6,"hurt":2,"die":3},{"cols":10,"idle":10,"hurt":3,"die":4},{"cols":10,"idle":10,"hurt":3,"die":4},{"cols":6,"idle":6,"hurt":2,"die":3},{"cols":10,"idle":10,"hurt":2,"die":3},{"cols":10,"idle":10,"hurt":3,"die":4},{"cols":10,"idle":10,"hurt":3,"die":4},{"cols":6,"idle":6,"hurt":2,"die":3},{"cols":10,"idle":10,"hurt":3,"die":4}];
    const CELL_W = 614, CELL_H = 333, SQ = 256, SQ_X = 179;
    // Images are cached hard by the service worker (cache-first), so the
    // version goes in the URL: bump ART_V whenever the boss art changes.
    const ART_V = '3';
    const still = n => `bosses-anim/boss${n}-still.webp?v=${ART_V}`;

    // n: 1-based boss number.
    // opts.full: show the whole cell (room for the death fall; element should
    //   be 614:333 in shape). Otherwise the element is a square showing just
    //   the standing boss, as on the stage map.
    function attach(el, n, opts) {
        const s = SHEETS[n - 1];
        if (!el || !s) return null;
        if (el._dpBoss) el._dpBoss.stop();   // re-used element (pop-ups): one animation at a time
        const full = !!(opts && opts.full);
        el.style.backgroundImage = `url(bosses-anim/boss${n}.webp?v=${ART_V})`;
        el.style.backgroundRepeat = 'no-repeat';
        let row = 0, frame = 0, count = s.idle, onDone = null, timer = null;
        const reduced = root.DPFx && root.DPFx.reduced();
        function draw() {
            const k = (el.clientWidth || (full ? CELL_W : SQ)) / (full ? CELL_W : SQ);
            el.style.backgroundSize = `${s.cols * CELL_W * k}px ${3 * CELL_H * k}px`;
            const x = (frame * CELL_W + (full ? 0 : SQ_X)) * k;
            el.style.backgroundPosition = `${-x}px ${-row * CELL_H * k}px`;
        }
        function play(r, c, done) { row = r; count = Math.max(1, c); frame = 0; onDone = done || null; draw(); }
        function tick() {
            if (!el.isConnected) { clearInterval(timer); return; }
            if (document.hidden) return;
            frame++;
            if (frame >= count) {
                if (onDone) { const d = onDone; onDone = null; frame = count - 1; draw(); d(); return; }
                frame = 0;
            }
            draw();
        }
        draw();
        requestAnimationFrame(draw);   // re-measure once laid out (pop-ups open hidden)
        if (!reduced) timer = setInterval(tick, 110);
        return el._dpBoss = {
            hurt() { if (reduced || !s.hurt) return; play(1, s.hurt, () => play(0, s.idle)); },
            // Plays the death once and holds on the last frame
            die(cb) { if (reduced || !s.die) { if (cb) cb(); return; } play(2, s.die, () => { clearInterval(timer); if (cb) cb(); }); },
            stop() { clearInterval(timer); }
        };
    }
    root.DPBossSprite = { attach: attach, still: still, count: SHEETS.length };
})(window);
