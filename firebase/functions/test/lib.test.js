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

test('quiet hours: 22:00-08:00 local, reminder times clamped to 08:00-21:45', () => {
    assert.ok(lib.inQuietHours('Europe/London', at('2026-11-16T22:00:00Z')));
    assert.ok(lib.inQuietHours('Europe/London', at('2026-11-16T07:59:00Z')));
    assert.ok(!lib.inQuietHours('Europe/London', at('2026-11-16T08:00:00Z')));
    assert.ok(!lib.inQuietHours('Europe/London', at('2026-11-16T21:59:00Z')));
    // 23:00 in London is 18:00 in New York: not quiet there
    assert.ok(!lib.inQuietHours('America/New_York', at('2026-11-16T23:00:00Z')));
    assert.strictEqual(lib.parseTime('03:00'), 8 * 60);
    assert.strictEqual(lib.parseTime('23:30'), 21 * 60 + 45);
    assert.strictEqual(lib.parseTime('19:00'), 19 * 60);
});

test('a late reminder never goes out at or after 22:00', () => {
    const s = settings({ reminder: { enabled: true, time: '21:45', tz: 'Europe/London' } });
    assert.strictEqual(lib.reminderDecision(s, dp({}), at('2026-11-16T21:50:00Z')).send, true);
    assert.strictEqual(lib.reminderDecision(s, dp({}), at('2026-11-16T22:00:00Z')).reason, 'window-passed');
    const late = settings({ reminder: { enabled: true, time: '23:59', tz: 'Europe/London' } });
    assert.strictEqual(lib.reminderDecision(late, dp({}), at('2026-11-16T23:59:00Z')).send, false);
});

test('reminder uses the account-wide streak and mentions freezes', () => {
    const projects = dp({ a: { lastWritingDate: '2026-11-15', currentStreak: 2 } });
    const streak = { v: 1, start: '2026-11-06', last: '2026-11-15', freezes: 2, days: {}, frozen: [] };
    const d = lib.reminderDecision(settings(), projects, at('2026-11-16T19:05:00Z'), streak);
    assert.strictEqual(d.status.streak, 10);
    assert.strictEqual(d.status.freezes, 2);
    assert.match(lib.reminderMessage(d.status).body, /2 streak freezes/);
    // Missed the 15th, one freeze covers it: streak still alive (11 days incl. the frozen day)
    const s2 = { ...streak, last: '2026-11-14', freezes: 1 };
    const d2 = lib.reminderDecision(settings(), dp({}), at('2026-11-16T19:05:00Z'), s2);
    assert.strictEqual(d2.status.streak, 10); assert.strictEqual(d2.status.freezes, 0);
    assert.match(lib.reminderMessage(d2.status).title, /10-DAY STREAK AT RISK/);
    // Account streak shows they already wrote today (on another project)
    const s3 = { ...streak, last: '2026-11-16' };
    assert.strictEqual(lib.reminderDecision(settings(), projects, at('2026-11-16T19:05:00Z'), s3).reason, 'wrote-today');
    // Too many missed days for the freezes: no streak to protect
    const s4 = { ...streak, last: '2026-11-10', freezes: 1 };
    assert.strictEqual(lib.reminderDecision(settings(), dp({}), at('2026-11-16T19:05:00Z'), s4).status.streak, 0);
});
