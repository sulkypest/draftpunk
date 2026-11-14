// ── Shared word-award routine ────────────────────────────────────────────────
// The single place where words are added to a project's tracker. Used by the
// dashboard's ADD WORDS box and by both SYNC buttons on the Write page, so every
// route applies the same rules: period counters, streak, session bonus, boss
// beats, buddies, minions and level-ups.
//
// awardWords() changes the project object it is given and returns a list of
// what happened, so each page can show it in its own way. It never saves —
// the caller does that.
//
// Needs data.js (BOSS_BEATS, MINIONS, RANKS) loaded first.
(function () {
    function pad(n) { return String(n).padStart(2, '0'); }
    function weekKey() {
        const d = new Date();
        const day = d.getDay() || 7;
        d.setDate(d.getDate() + 4 - day);
        const yr = new Date(d.getFullYear(), 0, 1);
        return d.getFullYear() + '-W' + Math.ceil(((d - yr) / 86400000 + 1) / 7);
    }
    function monthKey()     { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
    function yearKey()      { return '' + new Date().getFullYear(); }
    function todayKey()     { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
    function yesterdayKey() { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

    const TOTAL_BUDDIES = 100;

    function writerLevel(xp) { return Math.floor((1 + Math.sqrt(1 + 8 * (xp || 0) / 1000)) / 2); }

    // Zero the weekly/monthly/yearly counters when a new period has started.
    // Returns true if anything changed.
    function applyPeriodResets(p) {
        let changed = false;
        if (p.lastWeekReset  !== weekKey())  { p.wordsThisWeek  = 0; p.lastWeekReset  = weekKey();  changed = true; }
        if (p.lastMonthReset !== monthKey()) { p.wordsThisMonth = 0; p.lastMonthReset = monthKey(); changed = true; }
        if (p.lastYearReset  !== yearKey())  { p.wordsThisYear  = 0; p.lastYearReset  = yearKey();  changed = true; }
        return changed;
    }

    // Pick a buddy the writer doesn't have yet (previously a random pick that
    // happened to be a duplicate meant no buddy at all).
    function rollNewBuddy(inventory) {
        const missing = [];
        for (let i = 1; i <= TOTAL_BUDDIES; i++) {
            const f = `buddy${i}.png`;
            if (!inventory.includes(f)) missing.push(f);
        }
        return missing.length ? missing[Math.floor(Math.random() * missing.length)] : null;
    }

    function awardWords(p, words) {
        const events = { words: words, streak: null, session: null, beat: null, buddies: [], levelUp: null, minion: null };
        if (!p || !(words > 0)) return events;

        applyPeriodResets(p);
        p.inventory = p.inventory || [];
        p.logs      = p.logs || [];
        const prevLevel = writerLevel(p.xp);
        const oldTotal  = p.total || 0;

        // Base: 1 XP per word
        p.xp             = (p.xp || 0) + words;
        p.total          = oldTotal + words;
        p.wordsThisWeek  = (p.wordsThisWeek  || 0) + words;
        p.wordsThisMonth = (p.wordsThisMonth || 0) + words;
        p.wordsThisYear  = (p.wordsThisYear  || 0) + words;
        p.logs.push({ date: new Date().toLocaleDateString(), total: p.total });

        // Daily streak
        const today = todayKey();
        if (p.lastWritingDate !== today) {
            p.currentStreak = (p.lastWritingDate === yesterdayKey()) ? (p.currentStreak || 0) + 1 : 1;
            p.lastWritingDate = today;
            if (p.currentStreak > 1) {
                const bonus = p.currentStreak * 10;
                p.xp += bonus;
                events.streak = { days: p.currentStreak, bonus: bonus };
            }
        }

        // Session size bonus
        if (words >= 5000)      { p.xp += 500; events.session = { label: 'MEGA SESSION', bonus: 500 }; }
        else if (words >= 2000) { p.xp += 250; events.session = { label: 'LONG SESSION', bonus: 250 }; }

        // Boss beats (XP for every beat crossed)
        const goal     = p.goal || 80000;
        const progress = (p.total / goal) * 100;
        const beatIdx  = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
        const lastLevel = (p.lastLevel ?? -1);
        if (beatIdx > lastLevel) {
            p.xp += 500 * (beatIdx - lastLevel);
            p.lastLevel = beatIdx;
            events.beat = { idx: beatIdx, name: BOSS_BEATS[beatIdx].name };
        }

        // Buddies: one per 5,000-word threshold crossed
        const oldT = Math.floor(oldTotal / 5000);
        const newT = Math.floor(p.total / 5000);
        for (let t = oldT + 1; t <= newT; t++) {
            const file = rollNewBuddy(p.inventory);
            if (!file) break;
            p.inventory.push(file);
            p.xp += 200;
            events.buddies.push(file);
        }

        // Writer level-up (after all XP for this award)
        const newLevel = writerLevel(p.xp);
        if (newLevel > prevLevel) {
            events.levelUp = { level: newLevel, rank: (typeof RANKS !== 'undefined' && RANKS[newLevel - 1]) || 'AUTHOR' };
        }

        // Minions
        if (typeof MINIONS !== 'undefined') {
            const mIdx = MINIONS.findLastIndex(m => progress >= m.pct);
            if (mIdx > (p.lastMinionIdx ?? -1)) {
                p.lastMinionIdx = mIdx;
                events.minion = { idx: mIdx, ...MINIONS[mIdx] };
            }
        }

        return events;
    }

    window.DPTracker = {
        awardWords: awardWords,
        applyPeriodResets: applyPeriodResets,
        rollNewBuddy: rollNewBuddy,
        writerLevel: writerLevel
    };
})();
