'use strict';
// node --test tests/   — Check a Writing Record page (verify.js)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');
const { parseRecordInput, verdict, docxToText } = require('../verify.js');
const core = require('../firebase/functions/record-core.js');

test('reads a record link, its id or a record code, and nothing else', () => {
    const id = 'ca7d115fe0e369ada8daf2c1';
    const P = v => parseRecordInput(v, core.normaliseCode);
    assert.deepStrictEqual(P('https://www.draft-punk.com/record.html?share=' + id), { share: id });
    assert.deepStrictEqual(P('  draft-punk.com/verify.html?share=' + id.toUpperCase() + '  '), { share: id });
    assert.deepStrictEqual(P(id), { share: id });
    assert.deepStrictEqual(P('?share=' + id), { share: id });
    assert.deepStrictEqual(P('DP-7K3F-9QXM'), { code: 'DP-7K3F-9QXM' });
    assert.deepStrictEqual(P('dp 7k3f 9qxm'), { code: 'DP-7K3F-9QXM' });
    assert.deepStrictEqual(P('https://www.draft-punk.com/verify?code=DP-7K3F-9QXM'), { code: 'DP-7K3F-9QXM' });
    assert.deepStrictEqual(P('?code=DP-7K3F-9QXM'), { code: 'DP-7K3F-9QXM' });
    assert.strictEqual(P('https://example.com/?share=abc'), null);
    assert.strictEqual(P(id + 'ff'), null);
    assert.strictEqual(P(''), null);
});

test('verdicts: exact, match, mostly, partly, none, too short', () => {
    const fp = { words: 1000 };
    assert.strictEqual(verdict({ checked: 100, found: 100, share: 1, exact: true, words: 1000 }, fp).level, 'match');
    assert.match(verdict({ checked: 100, found: 97, share: 0.97, words: 1000 }, fp).title, /^✓ MATCHES THE RECORD$/);
    // All of the story is in a bigger record: no talk of "differences"
    const part = verdict({ checked: 100, found: 100, share: 1, exact: false, words: 900 }, { words: 5000 });
    assert.match(part.text, /^All of this story is in the record\./);
    assert.doesNotMatch(part.text, /differences/);
    // A short piece is told that small edits count heavily
    assert.match(verdict({ checked: 30, found: 18, share: 0.6, words: 38 }, fp).text, /short piece/);
    assert.strictEqual(verdict({ checked: 1, found: 0, share: 0, words: 2 }, fp).level, 'none');
    // 99.6% is never rounded up to look like 100%
    assert.match(verdict({ checked: 1000, found: 996, share: 0.996, words: 1000 }, fp).text, /^99%/);
    assert.strictEqual(verdict({ checked: 100, found: 70, share: 0.7, words: 1000 }, fp).title, 'MOSTLY MATCHES');
    assert.strictEqual(verdict({ checked: 100, found: 20, share: 0.2, words: 1000 }, fp).title, 'PARTLY MATCHES');
    assert.strictEqual(verdict({ checked: 100, found: 0, share: 0, words: 1000 }, fp).level, 'nomatch');
    assert.strictEqual(verdict({ checked: 0, found: 0, share: 0, words: 3 }, fp).level, 'none');
    assert.strictEqual(verdict(null, fp).level, 'none');
    // A story that is only part of a bigger project says so
    assert.match(verdict({ checked: 100, found: 100, share: 1, exact: false, words: 2000 }, { words: 90000 }).text, /also includes other writing/);
});

test('reads the text of a Word file made by Word-compatible software', async () => {
    const buf = fs.readFileSync(path.join(__dirname, 'fixtures/verify-sample.docx'));
    const text = await docxToText(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    assert.match(text, /Test Story Title\n/);
    assert.match(text, /These filler words check that a Word file is read correctly,\n/);
    assert.match(text, /with bold words, “curly quotes” and it’s apostrophes & ampersands\./);
});

// Build a tiny .docx by hand (deflated, like Word), with a tracked deletion
function makeDocx(xml) {
    const name = Buffer.from('word/document.xml');
    const data = zlib.deflateRawSync(Buffer.from(xml));
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(xml.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(xml.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
    const cdOffset = local.length + name.length + data.length;
    const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length + name.length, 12); eocd.writeUInt32LE(cdOffset, 16);
    const all = Buffer.concat([local, name, data, central, name, eocd]);
    return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}

test('tracked deletions in a Word file are left out', async () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Kept words</w:t></w:r><w:del><w:r><w:delText> deleted words</w:delText></w:r></w:del><w:r><w:t xml:space="preserve"> stay.</w:t></w:r></w:p></w:body></w:document>';
    assert.strictEqual((await docxToText(makeDocx(xml))).trim(), 'Kept words stay.');
});

test('a file that isn\'t a .docx is refused, not misread', async () => {
    await assert.rejects(docxToText(new TextEncoder().encode('just text, not a zip').buffer), /not-docx/);
});

test('end to end: a Word copy of the story matches its fingerprint', async () => {
    const buf = fs.readFileSync(path.join(__dirname, 'fixtures/verify-sample.docx'));
    const fromWord = await docxToText(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    // As typed in Draft Punk (HTML, straight quotes, no title)
    const typed = '<div>Test text for the verify page only. These filler words check that a Word file is read correctly,</div><div>including a second paragraph with bold words, "curly quotes" and it\'s apostrophes &amp; ampersands.</div>';
    const fp = core.fingerprint(core.htmlToText(typed), 'salt1');
    // Without the title line it's an exact match, Word formatting and all
    const body = core.compare(fp, fromWord.replace(/^\s*Test Story Title\n/, ''));
    assert.strictEqual(body.exact, true, JSON.stringify(body));
    // With the title: in this 34-word sample the title is 3 of 30 runs (90%)
    const short = core.compare(fp, fromWord);
    assert.strictEqual(Math.round(short.share * 100), 90);
    // In a real-length story, a title barely moves it
    const longBody = Array.from({ length: 40 }, (_, i) => 'Paragraph ' + i + ' of test filler words for checking a longer story here.').join('\n');
    const fpLong = core.fingerprint(longBody, 'salt2');
    assert.strictEqual(verdict(core.compare(fpLong, 'Test Story Title\n' + longBody), fpLong).level, 'match');
});
