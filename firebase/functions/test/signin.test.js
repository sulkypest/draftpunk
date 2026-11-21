'use strict';
// Email sign-in codes: runs the real requestSignInCode / verifySignInCode /
// weeklyNumbers handlers against in-memory fakes of Firestore, Auth, FCM and
// the Resend API.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// ── Fakes ────────────────────────────────────────────────────────────────────
const store = new Map();
const pushes = [];
const emails = [];
let resendReply = null;          // override the next Resend response
const accounts = new Map();      // email -> user record
let nextUid = 1;

function docRef(path) {
    return {
        path,
        collection: (c) => colRef(path + '/' + c),
        async get() { const d = store.get(path); return { exists: !!d, data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined) }; },
        async set(obj, opts) { store.set(path, opts && opts.merge ? { ...(store.get(path) || {}), ...obj } : obj); },
        async update(obj) { store.set(path, { ...(store.get(path) || {}), ...obj }); },
        async delete() { store.delete(path); }
    };
}
function colRef(path) { return { doc: (id) => docRef(path + '/' + id) }; }
const fakeDb = { collection: (c) => colRef(c) };

function authError(code) { const e = new Error(code); e.code = code; return e; }
const fakeAuth = {
    async getUserByEmail(email) { const u = accounts.get(email); if (!u) throw authError('auth/user-not-found'); return { ...u }; },
    async createUser({ email, emailVerified }) {
        const u = { uid: 'new' + (nextUid++), email, emailVerified, disabled: false, providerData: [], metadata: { creationTime: new Date().toUTCString() } };
        accounts.set(email, u); return { ...u };
    },
    async updateUser(uid, props) { for (const u of accounts.values()) if (u.uid === uid) Object.assign(u, props); },
    async createCustomToken(uid) { return 'token-for-' + uid; },
    async listUsers() { return { users: [...accounts.values()], pageToken: undefined }; }
};
const fakeAdmin = {
    initializeApp() {},
    firestore: Object.assign(() => fakeDb, { FieldValue: { delete: () => null }, FieldPath: class {} }),
    messaging: () => ({ async send(msg) { pushes.push({ token: msg.token, data: msg.data }); return 'ok'; } }),
    auth: () => fakeAuth
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fakeAdmin : origLoad.call(this, req, ...rest); };

global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const r = resendReply || { status: 200, json: { id: 'em_1' }, quota: String(emails.length + 1) };
    resendReply = null;
    if (r.status === 200) emails.push(body);
    return {
        ok: r.status === 200, status: r.status,
        headers: { get: (h) => (h === 'x-resend-daily-quota' ? (r.quota || null) : null) },
        async json() { return r.json; }
    };
};

process.env.GCLOUD_PROJECT = 'test';
process.env.RESEND_API_KEY = 'test-key';
process.env.ADMIN_UID = 'ross';
const fns = require('../index.js');
const lib = require('../lib.js');

function reset() { store.clear(); pushes.length = 0; emails.length = 0; accounts.clear(); resendReply = null; nextUid = 1;
    store.set('users/ross/private/notifications', { tokens: { 'ross-phone': { addedAt: 1 } } }); }
function withNow(ms, fn) { const RealDate = Date;
    global.Date = class extends RealDate { constructor(...a) { a.length ? super(...a) : super(ms); } static now() { return ms; } };
    return Promise.resolve(fn()).finally(() => { global.Date = RealDate; }); }
const T0 = Date.UTC(2026, 10, 21, 12, 0, 0);
const call = (fn, data) => fn.run({ data, app: { appId: 'web' } });
const codeIn = (email) => emails.filter(e => e.to[0] === email).pop().subject.match(/(\d{6})$/)[1];
async function rejects(p, code, reason) {
    await assert.rejects(p, err => { assert.strictEqual(err.code, code); if (reason) assert.strictEqual(err.details.reason, reason); return true; });
}

// ── Tests ────────────────────────────────────────────────────────────────────
test('a code is emailed, nothing readable is stored, and it signs in a new writer once', async () => {
    reset();
    await withNow(T0, () => call(fns.requestSignInCode, { email: '  Writer@Example.com ' }));
    assert.strictEqual(emails.length, 1);
    assert.deepStrictEqual(emails[0].to, ['writer@example.com']);
    const code = codeIn('writer@example.com');
    const stored = JSON.stringify([...store.entries()]);
    assert.ok(!stored.includes(code), 'code must not be stored in plain text');
    assert.ok(!stored.includes('writer@example.com'), 'email must not be stored in plain text');

    const res = await withNow(T0 + 60000, () => call(fns.verifySignInCode, { email: 'writer@example.com', code }));
    assert.match(res.token, /^token-for-new1$/);
    assert.strictEqual(accounts.get('writer@example.com').emailVerified, true);
    // Single use
    await rejects(withNow(T0 + 61000, () => call(fns.verifySignInCode, { email: 'writer@example.com', code })), 'not-found', 'expired');
});

test('an existing Google writer is signed into THEIR account, never a new one', async () => {
    reset();
    accounts.set('ross@example.com', { uid: 'google-ross', email: 'ross@example.com', emailVerified: true, disabled: false,
        providerData: [{ providerId: 'google.com' }], metadata: { creationTime: 'Mon, 01 Jun 2026 10:00:00 GMT' } });
    await withNow(T0, () => call(fns.requestSignInCode, { email: 'ross@example.com' }));
    const res = await withNow(T0 + 1000, () => call(fns.verifySignInCode, { email: 'ROSS@example.com', code: codeIn('ross@example.com') }));
    assert.strictEqual(res.token, 'token-for-google-ross');
    assert.strictEqual(accounts.size, 1);
});

test('an unverified password account is reused and marked verified', async () => {
    reset();
    accounts.set('pw@example.com', { uid: 'pw-1', email: 'pw@example.com', emailVerified: false, disabled: false, providerData: [{ providerId: 'password' }], metadata: {} });
    await withNow(T0, () => call(fns.requestSignInCode, { email: 'pw@example.com' }));
    const res = await withNow(T0 + 1000, () => call(fns.verifySignInCode, { email: 'pw@example.com', code: codeIn('pw@example.com') }));
    assert.strictEqual(res.token, 'token-for-pw-1');
    assert.strictEqual(accounts.get('pw@example.com').emailVerified, true);
});

test('wrong codes count down, then the code locks even if the right one is typed', async () => {
    reset();
    await withNow(T0, () => call(fns.requestSignInCode, { email: 'a@example.com' }));
    const code = codeIn('a@example.com');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let left = 4; left >= 1; left--) {
        await assert.rejects(withNow(T0 + 1000, () => call(fns.verifySignInCode, { email: 'a@example.com', code: wrong })),
            err => err.code === 'invalid-argument' && err.details.left === left);
    }
    await rejects(withNow(T0 + 1000, () => call(fns.verifySignInCode, { email: 'a@example.com', code: wrong })), 'permission-denied', 'locked');
    await rejects(withNow(T0 + 1000, () => call(fns.verifySignInCode, { email: 'a@example.com', code })), 'permission-denied', 'locked');
    assert.strictEqual(accounts.size, 0);
});

test('codes expire after 10 minutes', async () => {
    reset();
    await withNow(T0, () => call(fns.requestSignInCode, { email: 'b@example.com' }));
    await rejects(withNow(T0 + 10 * 60000 + 1, () => call(fns.verifySignInCode, { email: 'b@example.com', code: codeIn('b@example.com') })), 'not-found', 'expired');
});

test('a new code replaces the old one', async () => {
    reset();
    await withNow(T0, () => call(fns.requestSignInCode, { email: 'c@example.com' }));
    const first = codeIn('c@example.com');
    await withNow(T0 + 61000, () => call(fns.requestSignInCode, { email: 'c@example.com' }));
    const second = codeIn('c@example.com');
    if (first !== second) {
        await assert.rejects(withNow(T0 + 62000, () => call(fns.verifySignInCode, { email: 'c@example.com', code: first })));
    }
    const res = await withNow(T0 + 63000, () => call(fns.verifySignInCode, { email: 'c@example.com', code: second }));
    assert.ok(res.token);
});

test('per-address limits: one code a minute, five an hour', async () => {
    reset();
    await withNow(T0, () => call(fns.requestSignInCode, { email: 'd@example.com' }));
    await assert.rejects(withNow(T0 + 30000, () => call(fns.requestSignInCode, { email: 'd@example.com' })),
        err => err.code === 'resource-exhausted' && err.details.reason === 'cooldown' && err.details.waitSeconds === 30);
    for (let i = 1; i <= 4; i++) await withNow(T0 + i * 61000, () => call(fns.requestSignInCode, { email: 'd@example.com' }));
    await rejects(withNow(T0 + 5 * 61000, () => call(fns.requestSignInCode, { email: 'd@example.com' })), 'resource-exhausted', 'hourly');
    assert.strictEqual(emails.length, 5);
    // An hour after the first, one more is allowed
    await withNow(T0 + 60 * 60000 + 1000, () => call(fns.requestSignInCode, { email: 'd@example.com' }));
    assert.strictEqual(emails.length, 6);
});

test('bad input is refused without sending anything', async () => {
    reset();
    await rejects(call(fns.requestSignInCode, { email: 'not-an-email' }), 'invalid-argument');
    await rejects(call(fns.verifySignInCode, { email: 'e@example.com', code: '12ab56' }), 'invalid-argument', 'format');
    assert.strictEqual(emails.length, 0);
});

test('nearly-at-limit alert goes to Ross only, once a day', async () => {
    reset();
    store.set('users/other/private/notifications', { tokens: { 'other-phone': { addedAt: 1 } } });
    store.set('ops/emailDaily-2026-11-21', { sent: 68 });
    await withNow(T0, () => call(fns.requestSignInCode, { email: 'f1@example.com' }));
    assert.strictEqual(pushes.length, 0);            // 69
    await withNow(T0, () => call(fns.requestSignInCode, { email: 'f2@example.com' }));
    assert.strictEqual(pushes.length, 1);            // 70: warn
    assert.strictEqual(pushes[0].token, 'ross-phone');
    assert.match(pushes[0].data.title, /LIMIT NEAR/);
    await withNow(T0, () => call(fns.requestSignInCode, { email: 'f3@example.com' }));
    assert.strictEqual(pushes.length, 1);            // not again
});

test('when Resend refuses (daily quota) the writer is told and Ross is alerted once', async () => {
    reset();
    resendReply = { status: 429, json: { name: 'daily_quota_exceeded' } };
    await rejects(withNow(T0, () => call(fns.requestSignInCode, { email: 'g@example.com' })), 'resource-exhausted', 'quota');
    assert.strictEqual(pushes.length, 1);
    assert.match(pushes[0].data.title, /LIMIT REACHED/);
    resendReply = { status: 429, json: { name: 'daily_quota_exceeded' } };
    await rejects(withNow(T0, () => call(fns.requestSignInCode, { email: 'h@example.com' })), 'resource-exhausted', 'quota');
    assert.strictEqual(pushes.length, 1);
    // No code was stored for an email that never went
    await rejects(withNow(T0, () => call(fns.verifySignInCode, { email: 'g@example.com', code: '123456' })), 'not-found', 'expired');
});

test('weekly numbers: counts new writers by sign-in type and goes to Ross only', async () => {
    reset();
    const now = Date.UTC(2026, 10, 23, 9, 0, 0);
    const day = (d) => new Date(now - d * 86400000).toUTCString();
    accounts.set('1', { uid: 'u1', providerData: [{ providerId: 'google.com' }], metadata: { creationTime: day(2) } });
    accounts.set('2', { uid: 'u2', providerData: [], metadata: { creationTime: day(3) } });
    accounts.set('3', { uid: 'u3', providerData: [{ providerId: 'password' }], metadata: { creationTime: day(1) } });
    accounts.set('4', { uid: 'u4', providerData: [{ providerId: 'google.com' }], metadata: { creationTime: day(40) } });
    store.set('ops/emailDaily-2026-11-20', { sent: 12 });
    store.set('ops/emailDaily-2026-11-21', { sent: 3, quotaUsed: 5 });
    await withNow(now, () => fns.weeklyNumbers.run({}));
    assert.strictEqual(pushes.length, 1);
    assert.strictEqual(pushes[0].token, 'ross-phone');
    assert.match(pushes[0].data.body, /^3 new writers \(1 Google, 1 email code, 1 password\)\. 4 in total\. Sign-in emails: 17, busiest 12 on Fri/);
});

test('lib: code check and request decisions', () => {
    const salt = 'abc';
    const state = { salt, codeHash: lib.hashCode(salt, '042317'), expiresAt: 1000, attempts: 0 };
    assert.deepStrictEqual(lib.codeCheckDecision(state, '042317', 999), { result: 'ok' });
    assert.deepStrictEqual(lib.codeCheckDecision(state, ' 042317 ', 999), { result: 'ok' });
    assert.deepStrictEqual(lib.codeCheckDecision(state, '42317', 999), { result: 'wrong', left: 4 });
    assert.deepStrictEqual(lib.codeCheckDecision(state, '042317', 1001), { result: 'expired' });
    assert.deepStrictEqual(lib.codeCheckDecision(null, '042317', 0), { result: 'expired' });
    assert.ok(/^\d{6}$/.test(lib.newCode()));
    assert.strictEqual(lib.emailKey('A@B.co'), lib.emailKey(' a@b.co '));
});
