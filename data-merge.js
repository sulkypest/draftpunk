// ── Data merge for sync ──────────────────────────────────────────────────────
// Combines this device's copy of a writer's data with the cloud's copy, using
// the copy both last agreed on (the "base") to tell who changed what. Used by
// sync.js for projects, notes, beat notes, characters, Word Runner and the
// streak (chapters have their own merge in chapter-merge.js).
//
//   merge(key, base, local, cloud, preferLocal)
//     → { value, recoveries: [{ key, path, kept, other }] }
//
// Rules, in order:
//   • both sides the same                 → that
//   • only one side changed since base    → the changed side (this is how
//                                           additions AND deletions carry over)
//   • both changed, both are objects      → combine field by field
//   • both changed, lists of items with ids (notes, sections, characters)
//                                         → combine item by item, by id
//   • both changed, other lists (logs, buddies) → keep every entry from both,
//                                           minus entries one side removed
//   • word counts (project total, XP, words per day…) → both sides' added
//                                           words are added together
//   • anything else changed on both sides → the newer side's version is used
//                                           and the other is returned in
//                                           `recoveries`, so it can be kept
//
// With no base (first sync on a device after this was introduced) nothing is
// ever treated as deleted: lists and objects are unioned. A deletion made on
// another device may then come back once; nothing is lost.

(function (root) {
    const ABSENT = undefined;

    function canonical(v) {
        if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
        if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
        return v === undefined ? 'undefined' : JSON.stringify(v);
    }
    const eq = (a, b) => canonical(a) === canonical(b);
    const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));

    // ── Field rules (path = keys from the data key down; * = any) ────────────
    const RULES = [
        [['draftPunkData', 'activeProjectId'],                     'quiet'],
        [['draftPunkData', 'projects', '*', 'total'],              'add'],
        [['draftPunkData', 'projects', '*', 'xp'],                 'add'],
        [['draftPunkData', 'projects', '*', 'writeWords'],         'add'],
        [['draftPunkData', 'projects', '*', 'lastLevel'],          'max'],
        [['draftPunkData', 'projects', '*', 'lastMinionIdx'],      'max'],
        [['draftPunkData', 'projects', '*', 'currentStreak'],      'quiet'],
        [['draftPunkData', 'projects', '*', 'lastWritingDate'],    'quiet'],
        [['draftPunkData', 'projects', '*', 'wordsThisWeek'],      'period:lastWeekReset'],
        [['draftPunkData', 'projects', '*', 'wordsThisMonth'],     'period:lastMonthReset'],
        [['draftPunkData', 'projects', '*', 'wordsThisYear'],      'period:lastYearReset'],
        [['draftPunkData', 'projects', '*', 'lastWeekReset'],      'quiet'],
        [['draftPunkData', 'projects', '*', 'lastMonthReset'],     'quiet'],
        [['draftPunkData', 'projects', '*', 'lastYearReset'],      'quiet'],
        [['dpStreak', 'days', '*'],                                'add'],
        [['dpStreak', 'best'],                                     'max'],
        [['dpStreak', '*'],                                        'quiet'],
        [['wordRunnerData', 'sprintsWon'],                         'add']
    ];
    function ruleFor(path) {
        for (const [pat, rule] of RULES) {
            if (pat.length !== path.length) continue;
            if (pat.every((p, i) => p === '*' || p === String(path[i]))) return rule;
        }
        return null;
    }

    // ── Lists ────────────────────────────────────────────────────────────────
    const hasIds = arr => Array.isArray(arr) && arr.length > 0 && arr.every(x => isObj(x) && x.id != null);
    const idOf = x => String(x.id);

    function mergeIdList(path, b, l, c, preferLocal, rec) {
        const bMap = new Map((Array.isArray(b) ? b : []).filter(x => isObj(x) && x.id != null).map(x => [idOf(x), x]));
        const lMap = new Map(l.map(x => [idOf(x), x]));
        const cMap = new Map(c.map(x => [idOf(x), x]));
        const first = preferLocal ? l : c, second = preferLocal ? c : l;
        const out = [], seen = new Set();
        const take = item => {
            const id = idOf(item);
            if (seen.has(id)) return;
            seen.add(id);
            const v = merge3(path.concat(id), bMap.get(id), lMap.get(id), cMap.get(id), preferLocal, rec, b !== ABSENT);
            if (v !== ABSENT) out.push(v);
        };
        first.forEach(take);
        second.forEach(take);
        return out;
    }

    function mergePlainList(b, l, c, preferLocal) {
        // Every entry either side has, except entries that were in the base
        // and one side has since removed (while the other left them alone).
        const bSet = new Set((Array.isArray(b) ? b : []).map(canonical));
        const lSet = new Set(l.map(canonical)), cSet = new Set(c.map(canonical));
        const first = preferLocal ? l : c, second = preferLocal ? c : l;
        const out = [], seen = new Set();
        [...first, ...second].forEach(x => {
            const k = canonical(x);
            if (seen.has(k)) return;
            seen.add(k);
            const removed = bSet.has(k) && (!lSet.has(k) || !cSet.has(k));
            if (!removed) out.push(clone(x));
        });
        return out;
    }

    // ── Core three-way merge ─────────────────────────────────────────────────
    // hasBase: whether a base exists at all (false = first sync: union only).
    function merge3(path, b, l, c, preferLocal, rec, hasBase) {
        if (eq(l, c)) return clone(l);
        if (hasBase) {
            if (eq(l, b)) return clone(c);        // only the cloud changed
            if (eq(c, b)) return clone(l);        // only this device changed
        }
        // Both changed (or no base to tell). One side missing:
        if (l === ABSENT || c === ABSENT) {
            const present = l === ABSENT ? c : l;
            // No base: never delete. With a base, the other side deleted it but
            // this side changed it: keep the changed version (nothing lost).
            return clone(present);
        }
        const rule = ruleFor(path);
        if (rule === 'add' && typeof l === 'number' && typeof c === 'number') {
            // With a base, a count both sides started from nothing (e.g. a new
            // day's words) starts from 0. Without one, never add (no double counting).
            if (!hasBase) return Math.max(l, c);
            const bb = typeof b === 'number' ? b : 0;
            return bb + (l - bb) + (c - bb);
        }
        if (rule === 'max' && typeof l === 'number' && typeof c === 'number') return Math.max(l, c);
        if (isObj(l) && isObj(c)) {
            const out = {};
            const keys = new Set([...Object.keys(preferLocal ? l : c), ...Object.keys(preferLocal ? c : l)]);
            keys.forEach(k => {
                const v = merge3(path.concat(k), isObj(b) ? b[k] : ABSENT, l[k], c[k], preferLocal, rec, hasBase);
                if (v !== ABSENT) out[k] = v;
            });
            fixPeriods(path, b, l, c, out, preferLocal, hasBase);
            return out;
        }
        if (Array.isArray(l) && Array.isArray(c)) {
            if ((hasIds(l) || l.length === 0) && (hasIds(c) || c.length === 0) && (l.length || c.length)) {
                return mergeIdList(path, hasBase ? b : ABSENT, l, c, preferLocal, rec);
            }
            return mergePlainList(hasBase ? b : ABSENT, l, c, preferLocal);
        }
        // A single value changed differently on both sides
        const kept = preferLocal ? l : c, other = preferLocal ? c : l;
        if (!(rule === 'quiet' || (rule && rule.startsWith('period:')))) {
            rec.push({ path: path.slice(), kept: clone(kept), other: clone(other) });
        }
        return clone(kept);
    }

    // Week/month/year word counts reset when a new period starts, so they can
    // only be added together when both sides are in the same period.
    function fixPeriods(path, b, l, c, out, preferLocal, hasBase) {
        if (!(path.length === 3 && path[0] === 'draftPunkData' && path[1] === 'projects')) return;
        [['wordsThisWeek', 'lastWeekReset'], ['wordsThisMonth', 'lastMonthReset'], ['wordsThisYear', 'lastYearReset']].forEach(([n, r]) => {
            const ln = l[n] || 0, cn = c[n] || 0;
            if (l[r] === c[r]) {
                out[r] = l[r];
                if (ln === cn) { out[n] = ln; return; }
                if (hasBase && isObj(b) && b[r] === l[r]) { const bn = b[n] || 0; out[n] = bn + (ln - bn) + (cn - bn); }
                else if (hasBase && isObj(b)) out[n] = ln + cn;     // both started the new period since the base
                else out[n] = Math.max(ln, cn);
            } else {
                // Different periods: the side in the newer period is current
                const cmp = comparePeriods(l[r], c[r]);
                const pick = cmp > 0 ? l : cmp < 0 ? c : (preferLocal ? l : c);
                out[r] = pick[r]; out[n] = pick[n] || 0;
            }
        });
    }

    // '2026-W9' < '2026-W12', '2026-02' < '2026-11': compare the numbers in order
    function comparePeriods(a, b) {
        const na = String(a || '').match(/\d+/g) || [], nb = String(b || '').match(/\d+/g) || [];
        for (let i = 0; i < Math.max(na.length, nb.length); i++) {
            const d = (Number(na[i]) || 0) - (Number(nb[i]) || 0);
            if (d) return d;
        }
        return 0;
    }

    function merge(key, base, local, cloud, preferLocal) {
        const rec = [];
        const value = merge3([key], base, local, cloud, !!preferLocal, rec, base !== ABSENT);
        return { value, recoveries: rec.map(r => ({ key, ...r })) };
    }

    const api = { merge, canonical, eq };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.DPDataMerge = api;
})(this);
