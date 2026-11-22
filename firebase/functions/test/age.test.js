'use strict';
const test = require('node:test');
const assert = require('node:assert');
const lib = require('../lib');

const START = lib.AGE_STEP_START;
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2027-03-10T12:00:00Z');

test('age: whole months, birth month counts as not yet reached', () => {
    assert.strictEqual(lib.ageFromYM(2014, 2, NOW), 13);   // Feb birthday passed
    assert.strictEqual(lib.ageFromYM(2014, 3, NOW), 12);   // March: not yet
    assert.strictEqual(lib.ageFromYM(2014, 4, NOW), 12);
});

test('under-13 deletion: only new sign-ups that answered under 13 at sign-up', () => {
    const created = START + DAY;
    const child = { birthYear: 2016, birthMonth: 6, acceptedAt: created + 60000 };
    assert.strictEqual(lib.underageDeletionDue(created, child, NOW), true);
    // Account from before the age step: never
    assert.strictEqual(lib.underageDeletionDue(START - DAY, { ...child, acceptedAt: START - DAY + 60000 }, NOW), false);
    assert.strictEqual(lib.underageDeletionDue(START - 365 * DAY, { ...child, acceptedAt: created }, NOW), false);
    // Answered long after creating the account: never
    assert.strictEqual(lib.underageDeletionDue(created, { ...child, acceptedAt: created + 3 * DAY }, NOW), false);
    // 13 or over: never
    assert.strictEqual(lib.underageDeletionDue(created, { ...child, birthYear: 2010 }, NOW), false);
    // Missing or odd data: never
    assert.strictEqual(lib.underageDeletionDue(created, null, NOW), false);
    assert.strictEqual(lib.underageDeletionDue(created, { birthYear: '2016', birthMonth: 6, acceptedAt: created }, NOW), false);
    assert.strictEqual(lib.underageDeletionDue(created, { birthYear: 2016, birthMonth: 6 }, NOW), false);
    // Firebase gives creation time as a date string
    assert.strictEqual(lib.underageDeletionDue(new Date(created).toUTCString(), child, NOW), true);
});

test('leaderboard record holds username and counts only', () => {
    const rec = lib.leaderboardRecord({ username: 'ink', totalWords: 5, displayName: 'Real Name', photoURL: 'x', friends: ['a'], draftPunkData: {} });
    assert.deepStrictEqual(Object.keys(rec).sort(), [...lib.LEADERBOARD_FIELDS].sort());
    assert.strictEqual(rec.totalWords, 5);
    assert.strictEqual(rec.wordsThisWeek, 0);
    assert.strictEqual(lib.leaderboardRecord({ totalWords: 5 }), null);
});

test('reports only look up messages and shares, never writing', () => {
    assert.ok(lib.reportPathAllowed('messages/abc123'));
    assert.ok(lib.reportPathAllowed('groups/g1/messages/m1'));
    assert.ok(lib.reportPathAllowed('shares/u_ch_1'));
    assert.ok(!lib.reportPathAllowed('users/u1/writing/ch1'));
    assert.ok(!lib.reportPathAllowed('users/u1/private/data'));
    assert.ok(!lib.reportPathAllowed('messages/../users/u1'));
});

test('report email escapes and flags child safety', () => {
    const e = lib.reportEmail({ reason: 'child-safety', type: 'message', targetUsername: 'x<b>', from: 'r1', excerpt: '<script>' }, 'rep', '');
    assert.ok(e.subject.startsWith('URGENT'));
    assert.ok(!e.html.includes('<script>'));
});
