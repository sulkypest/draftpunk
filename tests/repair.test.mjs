import test from 'node:test';
import assert from 'node:assert';
import { repairNovember2026 } from '../repair-nov2026.js';

const nov16 = new Date(2026, 10, 16, 12);
const proj = (o) => ({ createdAt: new Date(2026, 10, 3).getTime(), logs: [{ date: '03/11/2026', total: 0 }, { date: 'x', total: 4200 }],
                       total: 4200, wordsThisMonth: 300, lastMonthReset: '2026-11', title: 'T', ...o });

test('November project: monthly count becomes its total; nothing else changes', () => {
    const dp = { activeProjectId: 'a', projects: { a: proj() } };
    const before = JSON.parse(JSON.stringify(dp));
    assert.strictEqual(repairNovember2026(dp, nov16), 1);
    assert.strictEqual(dp.projects.a.wordsThisMonth, 4200);
    const strip = o => { const c = JSON.parse(JSON.stringify(o)); delete c.projects.a.wordsThisMonth; return c; };
    assert.deepStrictEqual(strip(dp), strip(before));
});

test('running again changes nothing', () => {
    const dp = { projects: { a: proj() } };
    repairNovember2026(dp, nov16);
    const snap = JSON.stringify(dp);
    assert.strictEqual(repairNovember2026(dp, nov16), 0);
    assert.strictEqual(JSON.stringify(dp), snap);
});

test('older projects, converted old-format projects and correct counts are left alone', () => {
    const dp = { projects: {
        old:       proj({ createdAt: new Date(2026, 8, 1).getTime(), total: 90000 }),
        converted: proj({ logs: [{ date: 'x', total: 12000 }], total: 15000 }),
        fine:      proj({ wordsThisMonth: 4200 }),
        nolog:     proj({ logs: [] })
    } };
    const snap = JSON.stringify(dp);
    assert.strictEqual(repairNovember2026(dp, nov16), 0);
    assert.strictEqual(JSON.stringify(dp), snap);
});

test('a counter left on the wrong month key is set to November', () => {
    const dp = { projects: { a: proj({ lastMonthReset: '2026-12', wordsThisMonth: 0 }) } };
    assert.strictEqual(repairNovember2026(dp, nov16), 1);
    assert.strictEqual(dp.projects.a.lastMonthReset, '2026-11');
    assert.strictEqual(dp.projects.a.wordsThisMonth, 4200);
});

test('does nothing outside November 2026', () => {
    for (const d of [new Date(2026, 11, 1, 0, 5), new Date(2026, 9, 31, 23), new Date(2027, 10, 5)]) {
        const dp = { projects: { a: proj() } };
        assert.strictEqual(repairNovember2026(dp, d), 0);
    }
});
