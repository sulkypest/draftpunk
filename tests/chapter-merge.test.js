'use strict';
// node --test tests/chapter-merge.test.js — chapter merge on sign-in (chapter-merge.js)
const test = require('node:test');
const assert = require('node:assert');
const { merge } = require('../chapter-merge.js');

const ch = (id, updatedAt, content, order) => ({ id, updatedAt, content: content || id, title: id, order: order || 0 });

test('nothing in the cloud: every local chapter is kept and pushed', () => {
    const local = [ch('a', 1, 'A', 0), ch('b', 2, 'B', 1)];
    const r = merge(local, []);
    assert.deepStrictEqual(r.chapters.map(c => c.id), ['a', 'b']);
    assert.deepStrictEqual(r.toPush.map(c => c.id), ['a', 'b']);
    assert.strictEqual(r.replaced.length, 0);
    assert.strictEqual(r.changed, false);
});

test('identical copies: nothing changes, nothing pushed', () => {
    const local = [ch('a', 5, 'A', 0)];
    const r = merge(local, [ch('a', 5, 'A', 0)]);
    assert.strictEqual(r.changed, false);
    assert.strictEqual(r.toPush.length, 0);
    assert.strictEqual(r.replaced.length, 0);
});

test('THE BUG: newer cloud edit to one chapter no longer wipes an unsynced local edit to another', () => {
    // iPad (local) edited chapter 3 offline at t=100; laptop edited chapter 5 at t=200
    const local = [ch('c3', 100, 'ipad edit', 0), ch('c5', 10, 'old five', 1)];
    const cloud = [ch('c3', 50, 'old three', 0), ch('c5', 200, 'laptop edit', 1)];
    const r = merge(local, cloud);
    const byId = Object.fromEntries(r.chapters.map(c => [c.id, c.content]));
    assert.strictEqual(byId.c3, 'ipad edit');      // kept
    assert.strictEqual(byId.c5, 'laptop edit');    // taken from cloud
    assert.deepStrictEqual(r.toPush.map(c => c.id), ['c3']);
    assert.deepStrictEqual(r.replaced.map(c => c.id), ['c5']);
    assert.strictEqual(r.changed, true);
});

test('a chapter written offline on this device survives even when the cloud is newer overall', () => {
    const local = [ch('a', 10, 'A', 0), ch('new', 50, 'offline chapter', 1)];
    const cloud = [ch('a', 999, 'A newer', 0)];
    const r = merge(local, cloud);
    assert.deepStrictEqual(r.chapters.map(c => c.id).sort(), ['a', 'new']);
    assert.ok(r.toPush.some(c => c.id === 'new'));
});

test('a chapter added on another device is brought in', () => {
    const r = merge([ch('a', 5, 'A', 0)], [ch('a', 5, 'A', 0), ch('b', 6, 'B', 1)]);
    assert.deepStrictEqual(r.chapters.map(c => c.id), ['a', 'b']);
    assert.strictEqual(r.changed, true);
    assert.strictEqual(r.toPush.length, 0);
});

test('cloud newer but same text (e.g. only a timestamp moved): not listed as replaced', () => {
    const r = merge([ch('a', 1, 'same', 0)], [ch('a', 2, 'same', 0)]);
    assert.strictEqual(r.replaced.length, 0);
    assert.strictEqual(r.chapters[0].updatedAt, 2);
});

test('a tie keeps this device and pushes nothing', () => {
    const r = merge([ch('a', 7, 'local', 0)], [ch('a', 7, 'cloud', 0)]);
    assert.strictEqual(r.chapters[0].content, 'local');
    assert.strictEqual(r.toPush.length, 0);
});

test('order follows stored positions; shared positions put the older chapter first', () => {
    const local = [ch('x', 20, 'X', 2), ch('y', 30, 'Y', 1)];
    const cloud = [ch('z', 10, 'Z', 1)];
    const r = merge(local, cloud);
    assert.deepStrictEqual(r.chapters.map(c => c.id), ['z', 'y', 'x']);
});

test('no text is ever lost: every chapter id from either side is in the result', () => {
    const local = [ch('a', 3), ch('b', 9), ch('c', 1)];
    const cloud = [ch('b', 4), ch('c', 8), ch('d', 2)];
    const r = merge(local, cloud);
    assert.deepStrictEqual(r.chapters.map(c => c.id).sort(), ['a', 'b', 'c', 'd']);
});

test('bad input is handled', () => {
    assert.deepStrictEqual(merge(null, undefined).chapters, []);
    assert.deepStrictEqual(merge([null, {}], [null]).chapters, []);
});
