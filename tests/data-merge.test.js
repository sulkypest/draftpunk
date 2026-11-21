'use strict';
// node --test tests/data-merge.test.js — sync merge for projects, notes etc. (data-merge.js)
const test = require('node:test');
const assert = require('node:assert');
const { merge } = require('../data-merge.js');

const note = (id, body) => ({ id, title: '', body, createdAt: 1 });

test('THE BUG: a note written offline on the iPad survives a newer laptop note', () => {
    const base  = { p1: [note('n1', 'old')] };
    const ipad  = { p1: [note('n1', 'old'), note('n2', 'Note written offline on the iPad')] };
    const cloud = { p1: [note('n1', 'Note edited on the laptop')] };
    const r = merge('notesData', base, ipad, cloud, false);
    assert.deepStrictEqual(r.value.p1.map(n => [n.id, n.body]),
        [['n1', 'Note edited on the laptop'], ['n2', 'Note written offline on the iPad']]);
    assert.strictEqual(r.recoveries.length, 0);
});

test('only one side changed: the change carries over, including deletions', () => {
    const base = { p1: [note('a', 'A'), note('b', 'B')] };
    const local = { p1: [note('a', 'A')] };                  // deleted b here
    const r = merge('notesData', base, local, base, false);
    assert.deepStrictEqual(r.value.p1.map(n => n.id), ['a']);
    const r2 = merge('notesData', base, base, local, true);  // deleted on the other device
    assert.deepStrictEqual(r2.value.p1.map(n => n.id), ['a']);
});

test('same note edited on both: newer kept, other returned as a recovery copy', () => {
    const base = { p1: [note('a', 'A')] };
    const local = { p1: [note('a', 'iPad text')] };
    const cloud = { p1: [note('a', 'laptop text')] };
    const r = merge('notesData', base, local, cloud, false);   // cloud newer
    assert.strictEqual(r.value.p1[0].body, 'laptop text');
    assert.strictEqual(r.recoveries.length, 1);
    assert.strictEqual(r.recoveries[0].other, 'iPad text');
    assert.deepStrictEqual(r.recoveries[0].path, ['notesData', 'p1', 'a', 'body']);
});

test('deleted on one device, edited on the other: the edit is kept', () => {
    const base = { p1: [note('a', 'A')] };
    const r = merge('notesData', base, { p1: [] }, { p1: [note('a', 'edited')] }, true);
    assert.deepStrictEqual(r.value.p1.map(n => n.body), ['edited']);
});

test('no base (first sync after update): nothing is ever deleted', () => {
    const local = { p1: [note('a', 'A')] };
    const cloud = { p1: [note('b', 'B')], p2: [note('c', 'C')] };
    const r = merge('notesData', undefined, local, cloud, false);
    assert.deepStrictEqual(r.value.p1.map(n => n.id).sort(), ['a', 'b']);
    assert.ok(r.value.p2);
});

test('beat note sections (numeric ids) and characters merge by id', () => {
    const base = { p1: { 'Catalyst': [{ id: 1, title: 'x', text: '' }] } };
    const l = { p1: { 'Catalyst': [{ id: 1, title: 'x', text: '' }, { id: 2, title: 'ipad', text: '' }] } };
    const c = { p1: { 'Catalyst': [{ id: 1, title: 'x', text: '' }, { id: 3, title: 'laptop', text: '' }] } };
    const r = merge('beatNotesData', base, l, c, false);
    assert.deepStrictEqual(r.value.p1.Catalyst.map(s => s.id).sort(), [1, 2, 3]);
    const cb = { p1: { chars: [{ id: '1', name: 'A' }] } };
    const r2 = merge('charactersData', cb, { p1: { chars: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }] } },
                     { p1: { chars: [{ id: '1', name: 'A2' }] } }, true);
    assert.deepStrictEqual(r2.value.p1.chars.map(x => [x.id, x.name]), [['1', 'A2'], ['2', 'B']]);
});

const proj = o => ({ active: true, title: 'T', total: 1000, xp: 1000, logs: [], inventory: [], lastLevel: 1,
    wordsThisWeek: 100, lastWeekReset: '2026-W47', wordsThisMonth: 300, lastMonthReset: '2026-11',
    wordsThisYear: 1000, lastYearReset: '2026', ...o });

test('words added to the same project on two devices are both counted', () => {
    const base = { activeProjectId: 'p', projects: { p: proj({}) } };
    const l = { activeProjectId: 'p', projects: { p: proj({ total: 1500, xp: 1500, wordsThisWeek: 600, wordsThisMonth: 800, wordsThisYear: 1500,
        logs: [{ date: '20/11/2026', total: 1500 }] }) } };
    const c = { activeProjectId: 'p', projects: { p: proj({ total: 1200, xp: 1200, wordsThisWeek: 300, wordsThisMonth: 500, wordsThisYear: 1200,
        logs: [{ date: '21/11/2026', total: 1200 }] }) } };
    const r = merge('draftPunkData', base, l, c, false);
    const p = r.value.projects.p;
    assert.strictEqual(p.total, 1700);
    assert.strictEqual(p.xp, 1700);
    assert.strictEqual(p.wordsThisWeek, 800);
    assert.strictEqual(p.wordsThisMonth, 1000);
    assert.strictEqual(p.logs.length, 2);
    assert.strictEqual(r.recoveries.length, 0);
});

test('a project created on each device: both kept', () => {
    const base = { activeProjectId: 'p', projects: { p: proj({}) } };
    const l = { activeProjectId: 'q', projects: { p: proj({}), q: proj({ title: 'Q' }) } };
    const c = { activeProjectId: 'r', projects: { p: proj({}), r: proj({ title: 'R' }) } };
    const r = merge('draftPunkData', base, l, c, true);
    assert.deepStrictEqual(Object.keys(r.value.projects).sort(), ['p', 'q', 'r']);
    assert.strictEqual(r.value.activeProjectId, 'q');
    assert.strictEqual(r.recoveries.length, 0);        // which project is open isn't worth a recovery copy
});

test('week counters: a new week on one side is not added to last week', () => {
    const base = { projects: { p: proj({}) } };
    const l = { projects: { p: proj({ wordsThisWeek: 50, lastWeekReset: '2026-W48' }) } };
    const c = { projects: { p: proj({ wordsThisWeek: 400, lastWeekReset: '2026-W47' }) } };
    const r = merge('draftPunkData', base, l, c, false);
    assert.strictEqual(r.value.projects.p.lastWeekReset, '2026-W48');
    assert.strictEqual(r.value.projects.p.wordsThisWeek, 50);
});

test('week ordering compares numbers, not text (W9 before W12)', () => {
    const base = { projects: { p: proj({ lastWeekReset: '2026-W8' }) } };
    const l = { projects: { p: proj({ wordsThisWeek: 5, lastWeekReset: '2026-W9' }) } };
    const c = { projects: { p: proj({ wordsThisWeek: 7, lastWeekReset: '2026-W12' }) } };
    assert.strictEqual(merge('draftPunkData', base, l, c, true).value.projects.p.lastWeekReset, '2026-W12');
});

test('buddies (plain list) are combined; a buddy removed on one side stays removed', () => {
    const base = { projects: { p: proj({ inventory: ['a.png', 'b.png'] }) } };
    const l = { projects: { p: proj({ inventory: ['a.png', 'c.png'] }) } };
    const c = { projects: { p: proj({ inventory: ['a.png', 'b.png', 'd.png'] }) } };
    const inv = merge('draftPunkData', base, l, c, false).value.projects.p.inventory.sort();
    assert.deepStrictEqual(inv, ['a.png', 'c.png', 'd.png']);
});

test('streak: words per day add up; best is the higher', () => {
    const base = { v: 1, days: { '2026-11-20': 100 }, best: 3, freezes: 1 };
    const l = { v: 1, days: { '2026-11-20': 100, '2026-11-21': 200 }, best: 4, freezes: 1 };
    const c = { v: 1, days: { '2026-11-20': 150, '2026-11-21': 50 }, best: 5, freezes: 2 };
    const r = merge('dpStreak', base, l, c, false);
    assert.deepStrictEqual(r.value.days, { '2026-11-20': 150, '2026-11-21': 250 });
    assert.strictEqual(r.value.best, 5);
    assert.strictEqual(r.recoveries.length, 0);
});

test('no base and counters differ: never double-counted (higher kept)', () => {
    const l = { projects: { p: proj({ total: 1500 }) } }, c = { projects: { p: proj({ total: 1200 }) } };
    assert.strictEqual(merge('draftPunkData', undefined, l, c, false).value.projects.p.total, 1500);
});

test('nothing is ever silently lost: every id from either side survives unless one side deleted an unchanged item', () => {
    const base = { p1: [note('a', 'A'), note('b', 'B'), note('c', 'C')] };
    const l = { p1: [note('a', 'A1'), note('c', 'C'), note('d', 'D')] };         // edit a, delete b, add d
    const c = { p1: [note('a', 'A'), note('b', 'B2'), note('e', 'E')] };         // edit b, delete c, add e
    const r = merge('notesData', base, l, c, true);
    const got = Object.fromEntries(r.value.p1.map(n => [n.id, n.body]));
    assert.deepStrictEqual(got, { a: 'A1', b: 'B2', d: 'D', e: 'E' });            // b kept (edited), c gone (deleted, untouched)
});

test('null and missing values are handled', () => {
    assert.strictEqual(merge('wordRunnerData', null, null, null, true).value, null);
    assert.deepStrictEqual(merge('wordRunnerData', null, null, { sprintsWon: 1, rescued: [] }, true).value, { sprintsWon: 1, rescued: [] });
});
