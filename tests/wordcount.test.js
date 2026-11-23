'use strict';
// node --test tests/wordcount.test.js — word counting (wordcount.js) and the
// server copy in firebase/functions/record-core.js
const test = require('node:test');
const assert = require('node:assert');
const { countWordsHtml, countWordsText } = require('../wordcount.js');
const core = require('../firebase/functions/record-core.js');

const CASES = [
    ['', 0],
    ['<div><br></div>', 0],
    ['one two three', 3],
    ['<b>Hel</b>lo world', 2],                           // formatting inside a word
    ["the <i>Titanic</i>'s hull", 3],
    ['<i>Wuthering Heights</i>, she said.', 4],
    ['he paused – then left', 4],                       // spaced en dash (UK style)
    ['he paused — then left', 4],                       // spaced em dash
    ['paused—then', 2],                                 // unspaced em dash
    ['wait . . . what', 2],                             // spaced ellipsis
    ['wait…what', 2],
    ['" Hello "', 1],                                   // lone speech marks
    ['Marks &amp; Spencer', 2],                          // a lone symbol is not a word
    ['AT&amp;T', 1],
    ['a &lt; b', 2],
    ['well-known', 1],
    ["don't", 1],
    ['&nbsp;word&nbsp;&nbsp;word&nbsp;', 2],
    ['<div>end.</div><div>Start</div>', 2],              // paragraphs separate words
    ['<h2>Chapter</h2>One', 2],
    ['line<br>break', 2],
    ['1984 was a year', 4],
    ['caf&#233; au lait', 3],
    ['<p>Her <b><i>name</i></b> was <u>Mary</u>.</p><p>She ran.</p>', 6],
];

test('counts words in chapter HTML', () => {
    for (const [html, n] of CASES) assert.strictEqual(countWordsHtml(html), n, JSON.stringify(html));
});

test('server record count agrees with the app on every case', () => {
    for (const [html] of CASES) assert.strictEqual(core.countWordsHtml(html), countWordsHtml(html), JSON.stringify(html));
});

test('plain text (Word Runner)', () => {
    assert.strictEqual(countWordsText('  '), 0);
    assert.strictEqual(countWordsText('She ran — fast.\nThen stopped...'), 5);
});

test('agrees with the server on a long generated chapter', () => {
    const bits = ['the', '<i>Titanic</i>\'s', '—', '&amp;', 'well-known', '…', '<b>Hel</b>lo', '"', '</div><div>', '<br>', 'AT&amp;T', 'x'];
    let html = '<div>';
    for (let i = 0; i < 5000; i++) html += bits[(i * 7) % bits.length] + (i % 3 ? ' ' : '');
    html += '</div>';
    assert.strictEqual(core.countWordsHtml(html), countWordsHtml(html));
});
