'use strict';
// node --test tests/   — streak + freeze rules (streak.js)
const test = require('node:test');
const assert = require('node:assert');
const S = require('../streak.js');

const at = (d, h = 12) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd, h, 0); };
// Write `words` on each listed day in order, carrying state through
function run(days, start = null, projects = {}) {
  let st = start, evs = [];
  for (const [d, w] of days) { const r = S.record(st, projects, w, at(d)); st = r.state; evs.push(r.events); }
  return { st, evs };
}

test('streak counts consecutive days across projects; 5 days earns a freeze', () => {
  const { st, evs } = run([['2026-11-01', 100], ['2026-11-02', 100], ['2026-11-03', 50], ['2026-11-04', 10], ['2026-11-05', 10]]);
  assert.strictEqual(S.length(st), 5);
  assert.strictEqual(st.freezes, 1);
  assert.deepStrictEqual(evs[4].earned.map(e => e.reason), ['streak']);
  assert.ok(evs.slice(0, 4).every(e => e.earned.length === 0));
});

test('two syncs on the same day count once for the streak but add up for the 1,500 rule', () => {
  const { st, evs } = run([['2026-11-01', 900], ['2026-11-01', 600], ['2026-11-01', 1]]);
  assert.strictEqual(S.length(st), 1);
  assert.strictEqual(evs[1].earned.length, 0, '1,500 exactly is not "over 1,500"');
  assert.deepStrictEqual(evs[2].earned.map(e => e.reason), ['bigday']);
  const again = S.record(st, {}, 5000, at('2026-11-01'));
  assert.strictEqual(again.events.earned.length, 0, 'only one big-day freeze per day');
});

test('freezes are capped at 3; extra ones are not kept', () => {
  let { st } = run([['2026-11-01', 2000], ['2026-11-02', 2000], ['2026-11-03', 2000]]);
  assert.strictEqual(st.freezes, 3);
  const r = S.record(st, {}, 2000, at('2026-11-04'));
  assert.strictEqual(r.state.freezes, 3);
  assert.strictEqual(r.events.earned[0].kept, false);
});

test('missed days are covered automatically when there are enough freezes', () => {
  let { st } = run([['2026-11-01', 2000], ['2026-11-02', 2000]]);       // 2 freezes, streak 2
  // miss 3rd and 4th, write on 5th
  const v = S.view(st, {}, at('2026-11-05'));
  assert.strictEqual(v.length, 4); assert.strictEqual(v.freezes, 0); assert.deepStrictEqual(v.frozeDays, ['2026-11-03', '2026-11-04']);
  assert.strictEqual(v.atRisk, true);
  const r = S.record(st, {}, 100, at('2026-11-05'));
  assert.strictEqual(S.length(r.state), 5);
  assert.strictEqual(r.state.freezes, 1, 'used 2, then earned 1 for reaching 5 days');
  assert.deepStrictEqual(r.events.frozeDays, ['2026-11-03', '2026-11-04']);
});

test('not enough freezes: streak resets, freezes are kept', () => {
  let { st } = run([['2026-11-01', 2000]]);                               // 1 freeze
  const r = S.record(st, {}, 100, at('2026-11-04'));                     // missed 2 days
  assert.strictEqual(r.events.broke, true);
  assert.strictEqual(S.length(r.state), 1);
  assert.strictEqual(r.state.freezes, 1);
});

test('view never changes the stored streak', () => {
  let { st } = run([['2026-11-01', 2000], ['2026-11-02', 100]]);
  const copy = JSON.stringify(st);
  S.view(st, {}, at('2026-11-06'));
  assert.strictEqual(JSON.stringify(st), copy);
});

test('first run carries over the best live project streak, no back-dated freezes', () => {
  const projects = {
    a: { lastWritingDate: '2026-11-15', currentStreak: 12 },
    b: { lastWritingDate: '2026-11-16', currentStreak: 3 },
    c: { lastWritingDate: '2026-11-01', currentStreak: 40 }   // dead streak, ignored
  };
  const v = S.view(null, projects, at('2026-11-16'));
  assert.strictEqual(v.length, 12); assert.strictEqual(v.doneToday, false); assert.strictEqual(v.freezes, 0);
  const r = S.record(null, projects, 300, at('2026-11-16'));
  assert.strictEqual(S.length(r.state), 13);
  assert.strictEqual(r.events.earned.length, 0, '13 days: next freeze at 15');
  const r2 = S.record(r.state, projects, 300, at('2026-11-17'));
  const r3 = S.record(r2.state, projects, 300, at('2026-11-18'));
  assert.deepStrictEqual(r3.events.earned.map(e => e.days), [15]);
});

test('week row shows written, frozen, missed and today', () => {
  let { st } = run([['2026-11-10', 2000], ['2026-11-12', 100]]);  // 11th covered by freeze
  const v = S.view(st, {}, at('2026-11-14'));
  assert.deepStrictEqual(v.week.map(d => d.date.slice(8) + ':' + d.status),
    ['08:missed', '09:missed', '10:written', '11:frozen', '12:written', '13:missed', '14:today']);
  // The one freeze (big day on the 10th) covered the 11th; none left for the 13th
  assert.strictEqual(v.broke, true);
  assert.strictEqual(v.length, 0);
  assert.strictEqual(v.lostLength, 3);
});

test('midnight and month/DST boundaries', () => {
  const r1 = S.record(null, {}, 100, at('2026-10-24', 23));
  const r2 = S.record(r1.state, {}, 100, at('2026-10-25', 0));   // UK clocks change 25 Oct
  const r3 = S.record(r2.state, {}, 100, at('2026-10-26', 1));
  assert.strictEqual(S.length(r3.state), 3);
  const m = S.record(S.record(null, {}, 1, at('2026-10-31')).state, {}, 1, at('2026-11-01'));
  assert.strictEqual(S.length(m.state), 2);
});

test('old history is trimmed but the streak length is not', () => {
  let st = null;
  for (let i = 0; i < 90; i++) st = S.record(st, {}, 10, at(S.addDays('2026-01-01', i))).state;
  assert.strictEqual(S.length(st), 90);
  assert.ok(Object.keys(st.days).length <= 61);
});
