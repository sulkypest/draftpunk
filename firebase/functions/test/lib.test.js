'use strict';
const test = require('node:test');
const assert = require('node:assert');
const lib = require('../lib');

const tokens = { tok1: { addedAt: 1 } };
const settings = (extra = {}) => ({ tokens, reminder: { enabled: true, time: '19:00', tz: 'Europe/London' }, ...extra });
const dp = (projects) => ({ projects });
// 16 Nov 2026 is GMT (no daylight saving), so UTC == London.
const at = (iso) => new Date(iso);

test('localParts handles time zones and yesterday across month ends', () => {
    const p = lib.localParts('Europe/London', at('2026-12-01T00:30:00Z'));
    assert.strictEqual(p.date, '2026-12-01');
    assert.strictEqual(p.yesterday, '2026-11-30');
    assert.strictEqual(p.minutes, 30);
    const ny = lib.localParts('America/New_York', at('2026-12-01T00:30:00Z'));
    assert.strictEqual(ny.date, '2026-11-30');
    assert.strictEqual(ny.minutes, 19 * 60 + 30);
    const bad = lib.localParts('Not/AZone', at('2026-11-16T10:00:00Z'));
    assert.strictEqual(bad.zone, 'Europe/London');
});

test('reminder: not before the chosen time, sends inside the window, not after', () => {
    const data = dp({ a: { lastWritingDate: '2026-11-15', currentStreak: 4 } });
    assert.strictEqual(lib.reminderDecision(settings(), data, at('2026-11-16T18:59:00Z')).reason, 'not-yet');
    const d = lib.reminderDecision(settings(), data, at('2026-11-16T19:05:00Z'));
    assert.strictEqual(d.send, true);
    assert.strictEqual(d.status.streak, 4);
    assert.strictEqual(lib.reminderDecision(settings(), data, at('2026-11-16T20:01:00Z')).reason, 'window-passed');
});

test('reminder: skipped if they wrote today in any project', () => {
    const data = dp({ a: { lastWritingDate: '2026-11-15', currentStreak: 4 }, b: { lastWritingDate: '2026-11-16', currentStreak: 1 } });
    assert.strictEqual(lib.reminderDecision(settings(), data, at('2026-11-16T19:05:00Z')).reason, 'wrote-today');
});

test('reminder: once a day, off when disabled or no devices', () => {
    const data = dp({});
    assert.strictEqual(lib.reminderDecision(settings({ lastReminderDate: '2026-11-16' }), data, at('2026-11-16T19:05:00Z')).reason, 'already-sent');
    assert.strictEqual(lib.reminderDecision(settings({ lastReminderDate: '2026-11-15' }), data, at('2026-11-16T19:05:00Z')).send, true);
    assert.strictEqual(lib.reminderDecision({ tokens, reminder: { enabled: false } }, data, at('2026-11-16T19:05:00Z')).reason, 'off');
    assert.strictEqual(lib.reminderDecision({ tokens: {}, reminder: { enabled: true } }, data, at('2026-11-16T19:05:00Z')).reason, 'no-devices');
});

test('reminder uses the writer’s own time zone', () => {
    const s = { tokens, reminder: { enabled: true, time: '19:00', tz: 'America/New_York' } };
    // 19:05 London = 14:05 New York: not yet
    assert.strictEqual(lib.reminderDecision(s, dp({}), at('2026-11-16T19:05:00Z')).reason, 'not-yet');
    // 00:05 UTC next day = 19:05 New York on the 16th
    const d = lib.reminderDecision(s, dp({}), at('2026-11-17T00:05:00Z'));
    assert.strictEqual(d.send, true);
    assert.strictEqual(d.local.date, '2026-11-16');
});

test('reminder wording depends on the streak at risk', () => {
    assert.match(lib.reminderMessage({ streak: 12 }).body, /12-day/);
    assert.match(lib.reminderMessage({ streak: 1 }).title, /KEEP IT GOING/);
    assert.match(lib.reminderMessage({ streak: 0 }).title, /TIME TO WRITE/);
});

test('social messages never include message text, and skip the sender in groups', () => {
    const dm = lib.socialMessage('dm', { from: 'u1', fromUsername: 'ross', body: 'SECRET PLOT' });
    assert.ok(!JSON.stringify(dm).includes('SECRET'));
    assert.strictEqual(dm.url, 'messages.html');
    const g = lib.socialMessage('group', { from: 'u1', fromUsername: 'ross', groupId: 'g 1', groupName: 'Night Owls' });
    assert.strictEqual(g.title, 'NIGHT OWLS');
    assert.strictEqual(g.url, 'messages.html#group=g%201');
    assert.deepStrictEqual(lib.groupRecipients({ members: ['u1', 'u2', 'u3', 'u2'] }, 'u1'), ['u2', 'u3']);
});

test('only genuine dead-token errors remove a device', () => {
    assert.ok(lib.isDeadTokenError('messaging/registration-token-not-registered'));
    assert.ok(!lib.isDeadTokenError('messaging/invalid-argument'));
    assert.ok(!lib.isDeadTokenError('messaging/internal-error'));
});
