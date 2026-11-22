'use strict';
// Writing Record share links issued by the server (issueWritingRecord), and
// the fingerprint in record-core.js. Runs the real handler against an
// in-memory fake of Firestore.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const store = new Map();
const writes = [];
const UNION = Symbol('union');

function docRef(path) {
    return {
        path, id: path.split('/').pop(),
        collection: c => colRef(path + '/' + c),
        async get() { const d = store.get(path); return { exists: !!d, id: path.split('/').pop(), data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined) }; },
        async set(obj, opts) {
            writes.push(path);
            const prev = (opts && opts.merge && store.get(path)) || {};
            const out = { ...prev };
            for (const [k, v] of Object.entries(obj)) {
                out[k] = v && v[UNION] ? [...new Set([...(prev[k] || []), ...v[UNION]])] : JSON.parse(JSON.stringify(v));
            }
            store.set(path, out);
        }
    };
}
function colRef(path, filters = []) {
    return {
        doc: id => docRef(path + '/' + id),
        where: (f, op, v) => colRef(path, [...filters, [f, v]]),
        async get() {
            const docs = [...store.keys()].filter(k => k.startsWith(path + '/') && k.split('/').length === path.split('/').length + 1)
                .filter(k => filters.every(([f, v]) => store.get(k)[f] === v))
                .map(k => ({ id: k.split('/').pop(), data: () => JSON.parse(JSON.stringify(store.get(k))) }));
            return { docs, size: docs.length };
        }
    };
}
const fakeDb = { collection: c => colRef(c) };
const fakeAdmin = {
    initializeApp() {},
    firestore: Object.assign(() => fakeDb, { FieldValue: { delete: () => null, arrayUnion: (...v) => ({ [UNION]: v }) }, FieldPath: class {} }),
    messaging: () => ({})
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fakeAdmin : origLoad.call(this, req, ...rest); };
process.env.GCLOUD_PROJECT = 'test';
const fns = require('../index.js');
const core = require('../record-core.js');

const STORY = 'The lighthouse keeper counted the ships every night, though none had come for years. ' +
    'She wrote their names in a ledger anyway, inventing them when the sea stayed empty.';

function seed() {
    store.clear(); writes.length = 0;
    store.set('users/w', { username: 'writer_w' });
    store.set('users/w/private/data', { draftPunkData: { projects: { p1: { title: 'THE KEEPER' }, p2: { title: 'OTHER' } } } });
    store.set('users/w/writing/c1', { projectId: 'p1', title: 'One', order: 0, content: STORY.slice(0, 85) + '<div>' + STORY.slice(85) + '</div>', wordCount: 999999 });
    store.set('users/w/writing/c2', { projectId: 'p2', title: 'Elsewhere', order: 0, content: 'not in this project' });
    store.set('users/w/evidence/c1', { projectId: 'p1', startedAt: 1000, baselineWords: 0,
        devices: { dA: { typed: 120, pasted: 40, dropped: 0, imported: 0, deleted: 5, pastes: [{ t: 2000, c: 40, w: 7, k: 'pasted' }], earlierPastes: 0, earlierPastedChars: 0,
                         days: { '2026-11-20': { typed: 120, pasted: 40, deleted: 5, min: 12, words: 30 } } },
                   dB: { typed: 30, pastes: [], days: {} } } });
    store.set('users/x', { username: 'someone_else' });
}
const call = (uid, data) => fns.issueWritingRecord.run({ auth: uid ? { uid } : null, data });

test('builds the share from the cloud copy, not from anything the browser sends', async () => {
    seed();
    const res = await call('w', { projectId: 'p1', snapshot: { totals: { typed: 1e9 } }, totals: { typed: 1e9 } });
    const share = store.get('evidenceShares/' + res.id);
    assert.match(res.id, /^[a-f0-9]{24}$/);
    assert.strictEqual(share.uid, 'w');
    assert.strictEqual(share.issuedBy, 'draft-punk');
    assert.strictEqual(share.title, 'THE KEEPER');
    assert.strictEqual(share.author, 'writer_w');
    assert.strictEqual(share.totals.typed, 150, 'both devices added up');
    assert.strictEqual(share.totals.pasted, 40);
    assert.strictEqual(share.totals.words, core.tokens(STORY).length, 'words counted from the saved text, not the stored count');
    assert.strictEqual(share.chapters.length, 1, 'only this project');
    assert.strictEqual(share.pastes.length, 1);
    assert.ok(!JSON.stringify(share).includes('lighthouse'), 'no text in the share');
    assert.deepStrictEqual(store.get('users/w/evidence/_shares').ids, [res.id]);
    // Only the share and the private list of share ids are written
    assert.deepStrictEqual(writes.sort(), ['evidenceShares/' + res.id, 'users/w/evidence/_shares'].sort());
});

test('the fingerprint recognises the story, even copied out of a word processor', async () => {
    seed();
    const { id } = await call('w', { projectId: 'p1' });
    const fp = store.get('evidenceShares/' + id).fingerprint;
    const copied = STORY.replace(/'/g, '’').toUpperCase().replace(/ /g, '  \n');
    const same = core.compare(fp, copied);
    assert.strictEqual(same.share, 1);
    assert.strictEqual(same.exact, true);
    const edited = core.compare(fp, STORY.replace('ledger', 'notebook').replace('lighthouse keeper', 'old sailor'));
    assert.ok(edited.share > 0.3 && edited.share < 1, String(edited.share));
    assert.strictEqual(edited.exact, false);
    const other = core.compare(fp, 'A completely different story about a baker who never once burned the bread in forty years of mornings.');
    assert.strictEqual(other.found, 0);
});

test('updating a link keeps its address; another writer cannot update it', async () => {
    seed();
    const { id } = await call('w', { projectId: 'p1' });
    const first = store.get('evidenceShares/' + id).fingerprint.salt;
    const again = await call('w', { projectId: 'p1', shareId: id });
    assert.strictEqual(again.id, id);
    assert.notStrictEqual(store.get('evidenceShares/' + id).fingerprint.salt, first);
    await assert.rejects(call('x', { projectId: 'p1', shareId: id }), e => e.code === 'permission-denied');
    await assert.rejects(call('w', { projectId: 'p1', shareId: 'f'.repeat(24) }), e => e.code === 'permission-denied');
});

test('refuses signed-out callers, bad input and unknown projects', async () => {
    seed();
    await assert.rejects(call(null, { projectId: 'p1' }), e => e.code === 'unauthenticated');
    await assert.rejects(call('w', { projectId: '../x' }), e => e.code === 'invalid-argument');
    await assert.rejects(call('w', { projectId: 'p1', shareId: 'nope' }), e => e.code === 'invalid-argument');
    await assert.rejects(call('w', { projectId: 'p9' }), e => e.code === 'not-found');
    assert.strictEqual(writes.length, 0);
});

test('a project with thousands of pastes still fits in one document', async () => {
    seed();
    const pastes = Array.from({ length: 300 }, (_, i) => ({ t: i, c: 10, w: 2, k: 'pasted' }));
    for (let c = 0; c < 40; c++) {
        store.set('users/w/writing/big' + c, { projectId: 'p1', title: 'Chapter ' + c, order: c + 1, content: 'word '.repeat(3000) });
        store.set('users/w/evidence/big' + c, { projectId: 'p1', startedAt: 1, devices: { a: { typed: 1, pastes }, b: { typed: 1, pastes } } });
    }
    const { id } = await call('w', { projectId: 'p1' });
    const share = store.get('evidenceShares/' + id);
    assert.ok(Buffer.byteLength(JSON.stringify(share)) < 1024 * 1024);
    assert.ok(share.pastes.length <= 500);
    assert.strictEqual(share.pastes.length + share.totals.earlierPastes, 1 + 40 * 600, 'every paste still counted');
});

test('fingerprint of a very long text is sampled and stays small', () => {
    const words = Array.from({ length: 150000 }, (_, i) => 'w' + (i * 7919 % 100003));
    const fp = core.fingerprint(words.join(' '), 'abc');
    assert.ok(fp.rate > 1);
    assert.ok(fp.hashes.length / 8 <= 20000 * 1.05);
    const excerpt = words.slice(50000, 52000).join(' ');
    const r = core.compare(fp, excerpt);
    assert.ok(r.checked > 50, 'a 2,000-word excerpt is still checked');
    assert.strictEqual(r.share, 1);
});
