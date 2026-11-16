// ── Writer streak + streak freezes ───────────────────────────────────────────
// One streak per writer: a day counts if words were added to ANY project. This
// sits alongside each project's own streak (and its XP bonus), which is left
// exactly as it was.
//
// Streak freezes:
//   • earned: 1 for every 5 days in a row (5, 10, 15…), and 1 for writing more
//     than 1,500 words in a day (all projects together)
//   • held:   at most 3
//   • used:   automatically. If days were missed and there are enough freezes
//             to cover every missed day, they're used and the streak survives.
//             If not, the streak resets and the freezes are kept.
//
// Stored in localStorage 'dpStreak' (synced like the other data keys):
//   { v, start, last, days: {date: words}, frozen: [date], freezes,
//     milestone, best }
//   start/last  first and last day covered (written or frozen) of the current
//               streak, 'YYYY-MM-DD' in the writer's local time
//   days        words added per day, recent days only (for the week row and
//               the 1,500-word rule)
//   frozen      days covered by a freeze, recent only
//   milestone   5-day steps already rewarded in the current streak
//
// SAFETY: nothing here writes on page load. A device with out-of-date data
// that saved on load would look "newer" than the cloud and overwrite newer
// writing from another device. So the streak shown on load is worked out
// from what's stored (freezes applied in memory only), and it is only saved
// by record(), which runs when the writer actually adds words.
(function (root) {
    'use strict';

    const MAX_FREEZES = 3;
    const BIG_DAY = 1500;        // more than this many words in a day earns a freeze
    const STEP = 5;              // every 5 days in a row earns a freeze
    const KEEP_DAYS = 60;        // history kept for days/frozen

    function pad(n) { return String(n).padStart(2, '0'); }
    function keyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
    function todayKey(now) { return keyOf(now || new Date()); }
    // Date-key arithmetic in UTC so daylight saving can't skew it
    function toUTC(k) { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); }
    function fromUTC(t) { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
    function addDays(k, n) { return fromUTC(toUTC(k) + n * 86400000); }
    function diffDays(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }   // b - a

    function blank() { return { v: 1, start: null, last: null, days: {}, frozen: [], freezes: 0, milestone: 0, best: 0 }; }

    // First run: start from the best project streak that is still alive, so
    // nobody loses a streak they already have. No freezes for past streaks.
    function seed(projects, today) {
        const s = blank();
        const yesterday = addDays(today, -1);
        let bestLen = 0, bestLast = null;
        Object.values(projects || {}).forEach(p => {
            if (!p || !p.lastWritingDate) return;
            if (p.lastWritingDate !== today && p.lastWritingDate !== yesterday) return;
            const len = Math.max(1, p.currentStreak || 1);
            if (len > bestLen || (len === bestLen && p.lastWritingDate === today)) { bestLen = len; bestLast = p.lastWritingDate; }
        });
        if (bestLen) {
            s.last = bestLast;
            s.start = addDays(bestLast, -(bestLen - 1));
            for (let i = 0; i < Math.min(bestLen, KEEP_DAYS); i++) {
                const d = addDays(bestLast, -i);
                s.days[d] = s.days[d] || 0;
            }
            s.milestone = Math.floor(bestLen / STEP);
            s.best = bestLen;
        }
        return s;
    }

    function clone(s) { return JSON.parse(JSON.stringify(s)); }

    function normalise(stored, projects, today) {
        if (!stored || typeof stored !== 'object' || stored.v !== 1) return seed(projects, today);
        const s = clone(stored);
        s.days = s.days || {}; s.frozen = s.frozen || [];
        s.freezes = Math.max(0, Math.min(MAX_FREEZES, s.freezes || 0));
        s.milestone = s.milestone || 0; s.best = s.best || 0;
        return s;
    }

    // Bring the streak up to date for `today`: cover missed days with freezes
    // if there are enough, otherwise end the streak. Returns what happened.
    function rollover(s, today) {
        const out = { frozeDays: [], broke: false };
        if (!s.last) return out;
        const gap = diffDays(s.last, today) - 1;          // whole days missed before today
        if (gap <= 0) return out;
        if (s.freezes >= gap) {
            for (let i = 1; i <= gap; i++) {
                const d = addDays(s.last, i);
                s.frozen.push(d); out.frozeDays.push(d);
            }
            s.freezes -= gap;
            s.last = addDays(today, -1);
        } else {
            out.broke = true;
            out.lostLength = length(s);
            s.start = null; s.last = null; s.milestone = 0;
        }
        return out;
    }

    function length(s) { return s.start && s.last ? diffDays(s.start, s.last) + 1 : 0; }

    function prune(s, today) {
        const cutoff = addDays(today, -KEEP_DAYS);
        Object.keys(s.days).forEach(d => { if (d < cutoff) delete s.days[d]; });
        s.frozen = [...new Set(s.frozen)].filter(d => d >= cutoff).sort();
    }

    // What to show right now. Pure: never changes the stored streak.
    function view(stored, projects, now) {
        const today = todayKey(now);
        const s = normalise(stored, projects, today);
        const roll = rollover(s, today);
        const len = length(s);
        const doneToday = s.last === today;
        const week = [];
        for (let i = 6; i >= 0; i--) {
            const d = addDays(today, -i);
            let status = 'missed';
            if (s.days[d] !== undefined) status = 'written';
            else if (s.frozen.includes(d)) status = 'frozen';
            else if (d === today) status = 'today';
            week.push({ date: d, status, weekday: new Date(toUTC(d)).getUTCDay() });
        }
        return {
            today, length: len, doneToday,
            atRisk: len > 0 && !doneToday,
            freezes: s.freezes, maxFreezes: MAX_FREEZES,
            best: Math.max(s.best || 0, len),
            frozeDays: roll.frozeDays,                // freezes used since last saved
            broke: roll.broke, lostLength: roll.lostLength || 0,
            wordsToday: s.days[today] || 0,
            week
        };
    }

    // Words were just added (any project). Returns the new state to save and
    // what happened, for toasts.
    function record(stored, projects, words, now) {
        const today = todayKey(now);
        const s = normalise(stored, projects, today);
        const ev = { frozeDays: [], broke: false, earned: [], streak: 0 };
        if (!(words > 0)) { ev.streak = length(s); return { state: s, events: ev }; }

        const roll = rollover(s, today);
        ev.frozeDays = roll.frozeDays; ev.broke = roll.broke;

        const before = s.days[today] || 0;
        s.days[today] = before + words;
        if (s.last !== today) {
            if (s.last === addDays(today, -1)) s.last = today;
            else { s.start = today; s.last = today; s.milestone = 0; }
        }
        const len = length(s);
        s.best = Math.max(s.best || 0, len);

        const steps = Math.floor(len / STEP);
        if (steps > s.milestone) {
            for (let i = s.milestone + 1; i <= steps; i++) ev.earned.push({ reason: 'streak', days: i * STEP });
            s.milestone = steps;
        }
        if (before <= BIG_DAY && s.days[today] > BIG_DAY) ev.earned.push({ reason: 'bigday', words: s.days[today] });

        // Apply earnings up to the cap; anything over the cap is lost
        ev.earned.forEach(e => {
            e.kept = s.freezes < MAX_FREEZES;
            if (e.kept) s.freezes++;
        });
        prune(s, today);
        ev.streak = len;
        return { state: s, events: ev };
    }

    // ── Browser helpers ──────────────────────────────────────────────────────
    function load() { try { return JSON.parse(localStorage.getItem('dpStreak') || 'null'); } catch (e) { return null; } }
    function projectsNow() {
        try { return (JSON.parse(localStorage.getItem('draftPunkData') || '{}').projects) || {}; } catch (e) { return {}; }
    }

    const api = {
        MAX_FREEZES, BIG_DAY, STEP,
        view, record, seed, rollover, length, addDays, diffDays, todayKey,
        // Current view from localStorage (read-only)
        current(now) { return view(load(), projectsNow(), now); },
        // Call after words are added. `projects` = the projects object as it is
        // now (only used the first time, to carry over an existing streak).
        // Saves dpStreak and returns the events.
        recordWords(words, projects, now) {
            const r = record(load(), projects || projectsNow(), words, now);
            localStorage.setItem('dpStreak', JSON.stringify(r.state));
            return r.events;
        }
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.DPStreak = api;
})(this);
