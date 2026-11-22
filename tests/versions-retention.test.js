'use strict';
// node --test tests/   — version history retention (versions.js toKeep)
const test = require('node:test');
const assert = require('node:assert');

// versions.js is a browser script: give it just enough to load
global.window = {};
global.document = { addEventListener() {} };
window.addEventListener = () => {};
require('../versions.js');
const toKeep = window.DPVersions._toKeep;

const DAY = 86400000, HOUR = 3600000;
const NOW = Date.UTC(2026, 11, 20, 12);
const v = (id, ageMs, extra) => ({ id, t: NOW - ageMs, ...extra });

test('everything from the last 24 hours is kept', () => {
  const list = [v('a', 1 * HOUR), v('b', 2 * HOUR), v('c', 23 * HOUR)];
  assert.deepStrictEqual([...toKeep(list, NOW)].sort(), ['a', 'b', 'c']);
});

test('newest per hour for a week, newest per day up to 30 days', () => {
  const list = [v('new', 1 * HOUR), v('h1', 3 * DAY + 10 * 60000), v('h1b', 3 * DAY + 20 * 60000), v('d10', 10 * DAY), v('d10b', 10 * DAY + HOUR), v('d29', 29 * DAY)];
  const keep = toKeep(list, NOW);
  assert.ok(keep.has('h1') && !keep.has('h1b'));
  assert.ok(keep.has('d10') && !keep.has('d10b'));
  assert.ok(keep.has('d29'));
});

test('ordinary versions older than 30 days are removed', () => {
  const list = [v('new', 1 * HOUR), v('d31', 31 * DAY), v('d60', 60 * DAY, { reason: 'session-end' })];
  const keep = toKeep(list, NOW);
  assert.ok(!keep.has('d31') && !keep.has('d60'));
});

test('named versions, deleted-chapter copies and the newest version are kept at any age', () => {
  const list = [v('only', 90 * DAY), v('named', 200 * DAY, { name: 'Before rewrite', reason: 'named' }), v('del', 120 * DAY, { reason: 'chapter-deleted' })];
  const keep = toKeep(list, NOW);
  assert.ok(keep.has('only'), 'newest version of a chapter is always kept');
  assert.ok(keep.has('named'));
  assert.ok(keep.has('del'));
});
