// ── Draft Punk Sound Engine v3 ────────────────────────────────────────────────
console.log('[SFX] sounds.js v3 loaded');
const SFX = (function () {
    // Create context at module load — safest approach
    let ctx = null;
    try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        console.log('[SFX] AudioContext created, state:', ctx.state);
    } catch(e) {
        console.warn('[SFX] AudioContext failed:', e);
    }

    // Resume on any user interaction
    function tryResume() {
        if (ctx && ctx.state === 'suspended') {
            ctx.resume().then(() => console.log('[SFX] context resumed'));
        }
    }
    document.addEventListener('click',    tryResume);
    document.addEventListener('touchend', tryResume);
    document.addEventListener('keydown',  tryResume);

    function tone(c, freq, type, vol, t0, t1) {
        const osc  = c.createOscillator();
        const gain = c.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t1);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(t0);
        osc.stop(t1 + 0.05);
    }

    function noiseBurst(c, vol, t0, t1) {
        const sr  = c.sampleRate;
        const len = Math.max(1, Math.floor(sr * (t1 - t0)));
        const buf = c.createBuffer(1, len, sr);
        const d   = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        const src  = c.createBufferSource();
        const gain = c.createGain();
        src.buffer = buf;
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t1);
        src.connect(gain);
        gain.connect(c.destination);
        src.start(t0);
        src.stop(t1 + 0.05);
    }

    function play(name, fn) {
        if (!ctx) { console.warn('[SFX] no context'); return; }
        console.log('[SFX] playing:', name, '| state:', ctx.state);
        tryResume();
        try {
            // Use 0.2s offset — enough for resume() to complete on all browsers
            const t = ctx.currentTime + 0.2;
            fn(ctx, t);
        } catch(e) {
            console.warn('[SFX] play error:', e);
        }
    }

    // ── Sounds ────────────────────────────────────────────────────────────────

    function intro() {
        play('intro', (c, t) => {
            const osc = c.createOscillator();
            const g   = c.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(55, t);
            osc.frequency.linearRampToValueAtTime(110, t + 1.0);
            g.gain.setValueAtTime(0.001, t);
            g.gain.linearRampToValueAtTime(0.35, t + 0.7);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
            osc.connect(g); g.connect(c.destination);
            osc.start(t); osc.stop(t + 1.5);
            [220, 277, 330, 440].forEach((f, i) => {
                tone(c, f,   'square',   0.25, t + 0.6 + i*0.1, t + 1.0 + i*0.1);
                tone(c, f/2, 'sawtooth', 0.12, t + 0.6 + i*0.1, t + 1.0 + i*0.1);
            });
            tone(c, 110, 'sawtooth', 0.45, t + 1.1, t + 1.7);
            tone(c, 220, 'square',   0.3,  t + 1.1, t + 1.5);
            tone(c, 440, 'square',   0.2,  t + 1.1, t + 1.3);
            noiseBurst(c, 0.35, t + 1.1, t + 1.3);
        });
    }

    function addWords() {
        play('addWords', (c, t) => {
            tone(c, 330, 'square', 0.3,  t,        t + 0.1);
            tone(c, 550, 'square', 0.2,  t + 0.06, t + 0.14);
        });
    }

    function bossHit() {
        play('bossHit', (c, t) => {
            tone(c, 80,  'sawtooth', 0.4,  t,        t + 0.22);
            tone(c, 140, 'square',   0.25, t + 0.02, t + 0.16);
            noiseBurst(c, 0.25, t, t + 0.12);
        });
    }

    function bossDefeated() {
        play('bossDefeated', (c, t) => {
            [330, 392, 440, 523, 659].forEach((f, i) => {
                tone(c, f,   'square',   0.3,  t + i*0.12, t + i*0.12 + 0.22);
                tone(c, f/2, 'sawtooth', 0.15, t + i*0.12, t + i*0.12 + 0.22);
            });
            tone(c, 880, 'square',   0.35, t + 0.7, t + 1.2);
            tone(c, 440, 'sawtooth', 0.18, t + 0.7, t + 1.2);
            noiseBurst(c, 0.3, t + 0.7, t + 0.9);
        });
    }

    function levelUp() {
        play('levelUp', (c, t) => {
            [261, 329, 392, 523, 659, 784, 1046].forEach((f, i) => {
                tone(c, f,   'square',   0.3,  t + i*0.09, t + i*0.09 + 0.2);
                tone(c, f/2, 'sawtooth', 0.15, t + i*0.09, t + i*0.09 + 0.2);
            });
            tone(c, 1046, 'square',   0.35, t + 0.74, t + 1.3);
            tone(c, 523,  'sawtooth', 0.18, t + 0.74, t + 1.3);
        });
    }

    function buddyRescued() {
        play('buddyRescued', (c, t) => {
            [523, 659, 784, 659, 784, 1046].forEach((f, i) => {
                tone(c, f, 'triangle', 0.35, t + i*0.1, t + i*0.1 + 0.18);
            });
        });
    }

    function sprintWon() {
        play('sprintWon', (c, t) => {
            [440, 554, 659, 880].forEach((f, i) => {
                tone(c, f,   'square',   0.3,  t + i*0.1, t + i*0.1 + 0.18);
                tone(c, f/2, 'sawtooth', 0.12, t + i*0.1, t + i*0.1 + 0.18);
            });
            tone(c, 880, 'square', 0.35, t + 0.5, t + 0.9);
            noiseBurst(c, 0.25, t + 0.5, t + 0.65);
        });
    }

    function sprintFailed() {
        play('sprintFailed', (c, t) => {
            const osc  = c.createOscillator();
            const gain = c.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(440, t);
            osc.frequency.exponentialRampToValueAtTime(60, t + 0.8);
            gain.gain.setValueAtTime(0.4, t);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
            osc.connect(gain); gain.connect(c.destination);
            osc.start(t); osc.stop(t + 0.85);
        });
    }

    function tick() {
        play('tick', (c, t) => {
            tone(c, 1200, 'square', 0.25, t, t + 0.07);
        });
    }

    function minionDefeated() {
        play('minionDefeated', (c, t) => {
            tone(c, 220, 'square', 0.25, t,        t + 0.08);
            tone(c, 440, 'square', 0.18, t + 0.05, t + 0.12);
            tone(c, 880, 'square', 0.12, t + 0.09, t + 0.15);
        });
    }

    return { intro, addWords, bossHit, bossDefeated, levelUp, buddyRescued, sprintWon, sprintFailed, tick, minionDefeated };
})();
