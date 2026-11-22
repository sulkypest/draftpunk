'use strict';
// node --test tests/   — Writing Record: a device's figures survive losing the
// local copy (evidence.js restore). Each test loads evidence.js afresh, with a
// pretend browser storage and a pretend cloud.
const test = require('node:test');
const assert = require('node:assert');

function freshBrowser(storage, cloud) {
    global.localStorage = {
        getItem: k => (k in storage ? storage[k] : null),
        setItem: (k, v) => { storage[k] = String(v); },
        removeItem: k => { delete storage[k]; }
    };
    global.window = { addEventListener() {} };
    global.document = { addEventListener() {} };
    // Cloud: one document per chapter, devices merged as Firestore merge does
    window.pushEvidenceToCloud = async (id, meta, device, counters) => {
        const docu = cloud[id] || (cloud[id] = { devices: {} });
        Object.assign(docu, meta);
        docu.devices[device] = JSON.parse(JSON.stringify(counters));
    };
    window.pullEvidenceChapter = async id => (cloud[id] ? JSON.parse(JSON.stringify(cloud[id])) : null);
    delete require.cache[require.resolve('../evidence.js')];
    require('../evidence.js');
    return window.DPEvidence;
}

// A pretend editor whose text we change, then fire an input
function editor(text) { return { textContent: text }; }
function type(E, ed, id, more) { ed.textContent += more; E.recordInput(id, 'p1', ed, 'insertText'); }

test('dropped local copy: this device\'s cloud figures are added back, not overwritten', async () => {
    const storage = { dpDeviceId: 'devA' }, cloud = {};
    let E = freshBrowser(storage, cloud);
    const ed = editor('');
    E.attach('c1', 'p1', ed);
    type(E, ed, 'c1', 'a'.repeat(5000));
    await E.pushAll('p1');                        // first push: checks the cloud (nothing there), then sends
    assert.strictEqual(cloud.c1.devices.devA.typed, 5000);
    const started = cloud.c1.startedAt;

    // Storage fills up: write.js drops the local record. Next page load:
    E.dropLocal();
    E = freshBrowser(storage, cloud);
    const ed2 = editor(ed.textContent);
    E.attach('c1', 'p1', ed2);                    // record re-created from the current text
    type(E, ed2, 'c1', 'b'.repeat(200));
    await E.pushAll('p1');

    const mine = cloud.c1.devices.devA;
    assert.strictEqual(mine.typed, 5200, 'old 5,000 typed + new 200');
    assert.strictEqual(cloud.c1.startedAt, started, 'original start date kept');
    assert.strictEqual(cloud.c1.baselineChars, 0, 'old text not turned into "untracked"');
    const s = E.summarise('c1');
    assert.strictEqual(s.typed, 5200);
    assert.strictEqual(s.baselineWords, 0);
});

test('restore happens once only: later pushes do not add the cloud figures again', async () => {
    const storage = { dpDeviceId: 'devA' }, cloud = { c1: { projectId: 'p1', startedAt: 1, baselineChars: 0, baselineWords: 0,
        devices: { devA: { typed: 100, pasted: 0, dropped: 0, imported: 0, deleted: 0, pastes: [], earlierPastes: 0, earlierPastedChars: 0, days: {}, lastMinute: 0 } } } };
    const E = freshBrowser(storage, cloud);
    const ed = editor('');
    E.attach('c1', 'p1', ed);
    type(E, ed, 'c1', 'xxxxx');
    await E.pushAll('p1');
    type(E, ed, 'c1', 'yyyyy');
    await E.pushAll('p1');
    await E.pushAll('p1');
    assert.strictEqual(cloud.c1.devices.devA.typed, 110);
});

test('nothing is sent while the cloud copy can\'t be checked', async () => {
    const storage = { dpDeviceId: 'devA' }, cloud = { c1: { projectId: 'p1', startedAt: 1,
        devices: { devA: { typed: 999, pastes: [], days: {} } } } };
    const E = freshBrowser(storage, cloud);
    window.pullEvidenceChapter = async () => { throw new Error('offline'); };
    const ed = editor('');
    E.attach('c1', 'p1', ed);
    type(E, ed, 'c1', 'abc');
    await E.pushAll('p1');
    assert.strictEqual(cloud.c1.devices.devA.typed, 999, 'cloud figures untouched');
    window.pullEvidenceChapter = async id => JSON.parse(JSON.stringify(cloud[id]));
    await E.pushAll('p1');
    assert.strictEqual(cloud.c1.devices.devA.typed, 1002);
});

test('other devices\' figures are never changed', async () => {
    const other = { typed: 700, pasted: 50, dropped: 0, imported: 0, deleted: 0, pastes: [{ t: 5, c: 50, w: 9, k: 'pasted' }], earlierPastes: 0, earlierPastedChars: 0, days: {}, lastMinute: 0 };
    const storage = { dpDeviceId: 'devA' }, cloud = { c1: { projectId: 'p1', startedAt: 1, devices: { devB: other } } };
    const E = freshBrowser(storage, cloud);
    const ed = editor('');
    E.attach('c1', 'p1', ed);
    type(E, ed, 'c1', 'hello');
    await E.pushAll('p1');
    assert.deepStrictEqual(cloud.c1.devices.devB, other);
    assert.strictEqual(cloud.c1.devices.devA.typed, 5);
});

test('records already on a device before this update behave exactly as before', async () => {
    const rec = { projectId: 'p1', startedAt: 10, baselineChars: 0, baselineWords: 0,
        mine: { typed: 40, pasted: 0, dropped: 0, imported: 0, deleted: 0, pastes: [], earlierPastes: 0, earlierPastedChars: 0, days: {}, lastMinute: 0 }, others: {} };
    const storage = { dpDeviceId: 'devA', writingEvidence: JSON.stringify({ v: 1, chapters: { c1: rec } }) };
    const cloud = {};
    let pulled = 0;
    const E = freshBrowser(storage, cloud);
    window.pullEvidenceChapter = async () => { pulled++; return null; };
    await E.pushAll('p1');
    assert.strictEqual(pulled, 0, 'no extra cloud read');
    assert.strictEqual(cloud.c1.devices.devA.typed, 40);
});

test('pastes and days are combined, keeping the paste log within its cap', () => {
    const E = freshBrowser({ dpDeviceId: 'devA' }, {});
    const a = { typed: 1, pastes: Array.from({ length: 250 }, (_, i) => ({ t: i, c: 10 })), days: { '2026-11-01': { typed: 1, pasted: 2, deleted: 0, min: 3, words: 4 } } };
    const b = { typed: 2, pastes: Array.from({ length: 100 }, (_, i) => ({ t: 1000 + i, c: 1 })), days: { '2026-11-01': { typed: 1, pasted: 0, deleted: 0, min: 1, words: 1 }, '2026-11-02': { typed: 5, pasted: 0, deleted: 0, min: 2, words: 1 } } };
    const out = E._addCounters(a, b);
    assert.strictEqual(out.typed, 3);
    assert.strictEqual(out.pastes.length, 300);
    assert.strictEqual(out.earlierPastes, 50);
    assert.strictEqual(out.earlierPastedChars, 500);
    assert.deepStrictEqual(out.days['2026-11-01'], { typed: 2, pasted: 2, deleted: 0, min: 4, words: 5 });
});
