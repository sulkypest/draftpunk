'use strict';
// Runs the real handlers in index.js against an in-memory fake of Firestore
// and FCM, to check who gets notified and what gets written.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// ── Fake Firestore + messaging ───────────────────────────────────────────────
const store = new Map();          // path -> object
const sent = [];                  // { token, data }
const writes = [];                // paths written
const deadTokens = new Set();

class FieldPath { constructor(...parts) { this.parts = parts; } }
const DELETE = Symbol('delete');

function docRef(path) {
    return {
        path,
        collection: (c) => colRef(path + '/' + c),
        async get() { const d = store.get(path); return { exists: !!d, id: path.split('/').pop(), data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined) }; },
        async set(obj, opts) { writes.push(path); store.set(path, opts && opts.merge ? { ...(store.get(path) || {}), ...obj } : obj); },
        async update(...args) {
            writes.push(path);
            const d = JSON.parse(JSON.stringify(store.get(path) || {}));
            for (let i = 0; i < args.length; i += 2) {
                const fp = args[i], v = args[i + 1];
                let o = d; for (let j = 0; j < fp.parts.length - 1; j++) o = o[fp.parts[j]] = o[fp.parts[j]] || {};
                if (v === DELETE) delete o[fp.parts[fp.parts.length - 1]]; else o[fp.parts[fp.parts.length - 1]] = v;
            }
            store.set(path, d);
        }
    };
}
function colRef(path) {
    return {
        doc: (id) => docRef(path + '/' + id),
        select: () => ({ async get() {
            const docs = [...store.keys()].filter(k => k.startsWith(path + '/') && k.split('/').length === path.split('/').length + 1)
                .map(k => ({ id: k.split('/').pop() }));
            return { docs, size: docs.length };
        } })
    };
}
const fakeDb = { collection: (c) => colRef(c) };
const fakeAdmin = {
    initializeApp() {},
    firestore: Object.assign(() => fakeDb, { FieldValue: { delete: () => DELETE }, FieldPath }),
    messaging: () => ({ async send(msg) {
        if (deadTokens.has(msg.token)) { const e = new Error('gone'); e.code = 'messaging/registration-token-not-registered'; throw e; }
        sent.push({ token: msg.token, data: msg.data });
        return 'ok';
    } })
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fakeAdmin : origLoad.call(this, req, ...rest); };
process.env.GCLOUD_PROJECT = 'test';
const fns = require('../index.js');

function reset() { store.clear(); sent.length = 0; writes.length = 0; deadTokens.clear(); }
const realNow = Date.now;
function withNow(iso, fn) { const RealDate = Date; const t = new RealDate(iso).getTime();
    global.Date = class extends RealDate { constructor(...a) { a.length ? super(...a) : super(t); } static now() { return t; } };
    return Promise.resolve(fn()).finally(() => { global.Date = RealDate; }); }

function user(uid, { tokens = ['t-' + uid], reminder = { enabled: true, time: '19:00', tz: 'Europe/London' }, social = { enabled: true }, projects = {} } = {}) {
    store.set('users/' + uid, { username: uid, draftPunkData: { projects: { stale: { lastWritingDate: '2000-01-01' } } } });
    store.set(`users/${uid}/private/data`, { draftPunkData: { projects } });
    store.set(`users/${uid}/private/notifications`, { tokens: Object.fromEntries(tokens.map(t => [t, { addedAt: 1 }])), reminder, social });
}

test('daily reminder: only writers who are due and haven’t written; once per day', async () => {
    reset();
    user('due',      { projects: { a: { lastWritingDate: '2026-11-15', currentStreak: 7 } } });
    user('wrote',    { projects: { a: { lastWritingDate: '2026-11-16', currentStreak: 8 } } });
    user('off',      { reminder: { enabled: false } });
    user('later',    { reminder: { enabled: true, time: '21:30', tz: 'Europe/London' } });
    user('nodevice', { tokens: [] });
    store.set('users/nosettings', { username: 'x' });
    await withNow('2026-11-16T19:10:00Z', () => fns.dailyWritingReminder.run({}));
    assert.deepStrictEqual(sent.map(s => s.token), ['t-due']);
    assert.match(sent[0].data.body, /7-day/);
    assert.strictEqual(sent[0].data.url, 'write.html');
    assert.strictEqual(store.get('users/due/private/notifications').lastReminderDate, '2026-11-16');
    // Only notification settings are ever written
    assert.ok(writes.every(p => p.endsWith('/private/notifications')), writes.join(','));
    // Second run 15 minutes later sends nothing new
    await withNow('2026-11-16T19:25:00Z', () => fns.dailyWritingReminder.run({}));
    assert.strictEqual(sent.length, 1);
});

test('dead device tokens are removed, live ones kept', async () => {
    reset();
    user('ross', { tokens: ['live', 'dead'] });
    deadTokens.add('dead');
    await withNow('2026-11-16T19:10:00Z', () => fns.dailyWritingReminder.run({}));
    assert.deepStrictEqual(sent.map(s => s.token), ['live']);
    assert.deepStrictEqual(Object.keys(store.get('users/ross/private/notifications').tokens), ['live']);
});

test('direct message notifies the recipient only, without the message text', async () => {
    reset();
    user('a'); user('b');
    await fns.notifyDirectMessage.run({ data: { data: () => ({ from: 'a', to: 'b', fromUsername: 'alice', body: 'my secret chapter idea' }) }, params: {} });
    assert.deepStrictEqual(sent.map(s => s.token), ['t-b']);
    assert.ok(!JSON.stringify(sent).includes('secret'));
});

test('group message notifies other members who have social alerts on', async () => {
    reset();
    user('a'); user('b'); user('c', { social: { enabled: false } }); user('d');
    store.set('groups/g1', { name: 'Night Owls', members: ['a', 'b', 'c', 'd', 'e'] });
    await fns.notifyGroupMessage.run({ data: { data: () => ({ from: 'a', fromUsername: 'alice', body: 'hi' }) }, params: { groupId: 'g1' } });
    assert.deepStrictEqual(sent.map(s => s.token).sort(), ['t-b', 't-d']);
    assert.strictEqual(sent[0].data.title, 'NIGHT OWLS');
    assert.strictEqual(writes.length, 0);
});

test('friend request and chapter share notify the right people', async () => {
    reset();
    user('a'); user('b'); user('c');
    await fns.notifyFriendRequest.run({ data: { data: () => ({ from: 'a', to: 'b', fromUsername: 'alice' }) }, params: {} });
    await fns.notifyChapterShare.run({ data: { data: () => ({ ownerId: 'a', ownerUsername: 'alice', sharedWith: ['b', 'c', 'a'] }) }, params: {} });
    const titles = sent.map(s => s.token + ':' + s.data.title).sort();
    assert.deepStrictEqual(titles, ['t-b:CHAPTER SHARED', 't-b:FRIEND REQUEST', 't-c:CHAPTER SHARED']);
});
