// ── Import ────────────────────────────────────────────────────────────────────
// One import dialog for the Write page. Reads a story from Word (.docx), RTF,
// plain text or HTML, or a Draft Punk backup (.json), shows what was found, and
// only then adds it to the open project.
//
// Rules that protect existing writing:
//   • Importing only ever ADDS: new chapters go at the end of the project with
//     new ids; notes, characters and beat notes from a backup are added as new
//     items. Nothing already in the project is changed or replaced.
//   • Imported words are marked as imported in the Writing Record and are NOT
//     added to the tracker (no XP, streak or leaderboard words).
//   • Files are read in this browser. Nothing is uploaded until the chapters
//     are added and saved like any other chapter.
(function () {
    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

    // ── Text model ───────────────────────────────────────────────────────────
    // A block is { type: 'para' | 'heading' | 'chapter', runs: [{ text, b, i, u } | { br: true }] }
    // 'chapter' blocks start a new chapter; 'heading' blocks are scene headings.
    function runsText(runs) { return runs.map(r => r.br ? ' ' : r.text).join(''); }
    function cleanRuns(runs) {
        // Merge neighbouring runs with the same formatting; trim edges
        const out = [];
        runs.forEach(r => {
            if (r.br) { out.push({ br: true }); return; }
            if (!r.text) return;
            const last = out[out.length - 1];
            if (last && !last.br && last.b === !!r.b && last.i === !!r.i && last.u === !!r.u) last.text += r.text;
            else out.push({ text: r.text, b: !!r.b, i: !!r.i, u: !!r.u });
        });
        while (out.length && out[0].br) out.shift();
        while (out.length && out[out.length - 1].br) out.pop();
        if (out.length && !out[0].br) out[0].text = out[0].text.replace(/^\s+/, '');
        const z = out[out.length - 1];
        if (z && !z.br) z.text = z.text.replace(/\s+$/, '');
        return out.filter(r => r.br || r.text);
    }
    // Heading text without the heading style's own bold/underline; line breaks as spaces
    function plainRuns(runs) {
        return runs.map(r => r.br ? { text: ' ' } : { text: r.text, b: false, i: !!r.i, u: false });
    }
    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function runsHtml(runs) {
        return runs.map(r => {
            if (r.br) return '<br>';
            let t = esc(r.text);
            if (r.u) t = '<u>' + t + '</u>';
            if (r.i) t = '<i>' + t + '</i>';
            if (r.b) t = '<b>' + t + '</b>';
            return t;
        }).join('');
    }
    function blocksHtml(blocks) {
        return blocks.map(b => b.type === 'heading' ? '<h2>' + runsHtml(b.runs) + '</h2>' : '<div>' + runsHtml(b.runs) + '</div>').join('');
    }
    function wordsIn(html) {
        if (typeof window.countWords === 'function') return window.countWords(html);
        const t = String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').trim();
        return t ? t.split(/\s+/).length : 0;
    }
    function plainText(html) {
        const d = document.createElement('div'); d.innerHTML = html; return d.textContent || '';
    }

    // ── Chapter headings in plain text ───────────────────────────────────────
    // Only lines that are clearly headings: "Chapter 1", "CHAPTER TWELVE",
    // "Chapter 3: The Lab", "Part One", "Book II — Winter", "Prologue",
    // "Epilogue: After". Prose such as "Part of me wanted to run." is not.
    const NUM_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred';
    const NUM = `(?:\\d{1,4}|[ivxlcdm]{1,7}|(?:${NUM_WORDS})(?:[\\s-]+(?:and[\\s-]+)?(?:${NUM_WORDS}))*)`;
    const HEADING_RE = new RegExp(
        `^(?:(?:chapter|part|book)\\s+${NUM}(?:\\s*[:.\\-–—]\\s*\\S.*|\\s*[:.]?)?` +
        `|chapter` +
        `|(?:prologue|epilogue|interlude|foreword|afterword|preface)(?:\\s*[:.\\-–—]\\s*\\S.*|\\s*[:.]?)?)$`, 'i');
    function isChapterLine(text) {
        const t = String(text || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 80) return false;
        return HEADING_RE.test(t);
    }

    // Group blocks into chapters. If the file marked chapters itself (Word or
    // HTML headings), those are used; otherwise clear "Chapter …" lines.
    function toChapters(blocks, hasMarkedChapters) {
        const chapters = [];
        let cur = null;
        blocks.forEach(b => {
            const isStart = hasMarkedChapters ? b.type === 'chapter' : (b.type !== 'heading' && isChapterLine(runsText(b.runs)));
            if (isStart) {
                cur = { title: runsText(b.runs).replace(/\s+/g, ' ').trim(), blocks: [] };
                chapters.push(cur);
            } else {
                if (!cur) { cur = { title: '', blocks: [] }; chapters.push(cur); }
                cur.blocks.push(b.type === 'chapter' ? { type: 'heading', runs: b.runs } : b);
            }
        });
        return chapters;
    }
    // Everything as one chapter, chapter titles kept as scene headings
    function asOneChapter(blocks) {
        return [{ title: '', blocks: blocks.map(b => b.type === 'chapter' ? { type: 'heading', runs: b.runs } : b) }];
    }

    // ── Plain text ───────────────────────────────────────────────────────────
    function textBlocks(text) {
        return String(text).replace(/\r\n?/g, '\n').split('\n')
            .map(l => l.replace(/\t/g, ' ').trim())
            .filter(Boolean)
            .map(l => ({ type: 'para', runs: [{ text: l }] }));
    }

    // ── HTML (including Google Docs' "Web page" download) ────────────────────
    function htmlBlocks(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('script, style, head, title, noscript, template').forEach(n => n.remove());
        const blocks = [];
        const hasH1 = !!doc.body.querySelector('h1');
        const BLOCK = /^(P|DIV|H1|H2|H3|H4|H5|H6|LI|BLOCKQUOTE|PRE|TD|TH|SECTION|ARTICLE)$/;
        function runsOf(node, fmt, out) {
            if (node.nodeType === 3) {
                const t = node.textContent.replace(/\s+/g, ' ');
                if (t) out.push({ text: t, b: !!fmt.b, i: !!fmt.i, u: !!fmt.u });
                return;
            }
            if (node.nodeType !== 1) return;
            const tag = node.tagName;
            if (tag === 'BR') { out.push({ br: true }); return; }
            const f = { ...fmt };
            if (tag === 'B' || tag === 'STRONG') f.b = true;
            if (tag === 'I' || tag === 'EM') f.i = true;
            if (tag === 'U') f.u = true;
            const st = node.getAttribute('style') || '';
            if (/font-weight:\s*(bold|[6-9]00)/i.test(st)) f.b = true;
            if (/font-weight:\s*(normal|[1-4]00)/i.test(st)) f.b = false;
            if (/font-style:\s*italic/i.test(st)) f.i = true;
            if (/text-decoration[^;]*underline/i.test(st)) f.u = true;
            node.childNodes.forEach(c => runsOf(c, f, out));
        }
        function walk(el) {
            let loose = [];
            const flush = () => { const r = cleanRuns(loose); if (r.length) blocks.push({ type: 'para', runs: r }); loose = []; };
            el.childNodes.forEach(n => {
                if (n.nodeType === 1 && BLOCK.test(n.tagName)) {
                    flush();
                    const hasInnerBlocks = [...n.children].some(c => BLOCK.test(c.tagName));
                    if (hasInnerBlocks) { walk(n); return; }
                    const runs = [];
                    runsOf(n, {}, runs);
                    const r = cleanRuns(runs);
                    if (!r.length) return;
                    const t = n.tagName;
                    if (t === 'H1') blocks.push({ type: 'chapter', runs: plainRuns(r) });
                    else if (/^H[2-6]$/.test(t)) blocks.push({ type: 'heading', runs: plainRuns(r) });
                    else blocks.push({ type: 'para', runs: r });
                } else if (n.nodeType === 1 && n.tagName === 'BR') {
                    flush();
                } else {
                    runsOf(n, {}, loose);
                }
            });
            flush();
        }
        walk(doc.body);
        return { blocks, marked: hasH1 };
    }

    // ── RTF ──────────────────────────────────────────────────────────────────
    // Reads text, paragraphs, line breaks, bold, italic and underline. Skips
    // font and colour tables, pictures, headers, footers, footnotes and fields'
    // hidden instructions.
    const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'headerl', 'headerr', 'headerf',
        'footer', 'footerl', 'footerr', 'footerf', 'footnote', 'annotation', 'object', 'fldinst', 'themedata', 'colorschememapping',
        'datastore', 'latentstyles', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'mmathPr', 'pgdsctbl',
        'filetbl', 'revtbl', 'bkmkstart', 'bkmkend', 'shppict', 'nonshppict', 'blipuid', 'operator', 'author', 'title', 'company']);
    const CP1252 = { 0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6,
        0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D,
        0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178 };
    // Heading levels of the file's paragraph styles ("heading 1" → 1), read
    // from the stylesheet, so chapters come through as they do from Word
    function rtfHeadingStyles(rtf) {
        const out = {};
        const at = rtf.indexOf('{\\stylesheet');
        if (at < 0) return out;
        let depth = 0, end = at;
        for (; end < rtf.length; end++) {
            const c = rtf[end];
            if (c === '\\') { end++; continue; }
            if (c === '{') depth++;
            else if (c === '}' && --depth === 0) break;
        }
        const sheet = rtf.slice(at + 1, end);
        const re = /\{[^{}]*?\\s(\d+)\b(?:[^{}]|\{[^{}]*\})*?\s([^\\{};]+);\}/g;
        let m;
        while ((m = re.exec(sheet))) {
            const name = m[2].trim().toLowerCase();
            const h = /^heading\s*(\d)$/.exec(name);
            if (h) out[m[1]] = parseInt(h[1], 10);
        }
        return out;
    }
    function rtfBlocks(rtf) {
        const headingStyles = rtfHeadingStyles(rtf);
        const blocks = [];
        let runs = [];
        let paraStyle = null, paraOutline = null;
        let st = { b: false, i: false, u: false, skip: false, uc: 1 };
        const stack = [];
        let skipChars = 0;
        const add = ch => {
            if (st.skip) return;
            if (skipChars > 0) { skipChars--; return; }
            const last = runs[runs.length - 1];
            if (last && !last.br && last.b === st.b && last.i === st.i && last.u === st.u) last.text += ch;
            else runs.push({ text: ch, b: st.b, i: st.i, u: st.u });
        };
        const endPara = () => {
            const r = cleanRuns(runs); runs = [];
            if (!r.length) return;
            const lvl = paraOutline != null ? paraOutline + 1 : (paraStyle != null ? headingStyles[paraStyle] || 0 : 0);
            if (lvl === 1) blocks.push({ type: 'chapter', runs: plainRuns(r) });
            else if (lvl >= 2) blocks.push({ type: 'heading', runs: plainRuns(r), level: lvl });
            else blocks.push({ type: 'para', runs: r });
        };
        let i = 0, groupStart = false;
        const n = rtf.length;
        while (i < n) {
            const c = rtf[i];
            if (c === '{') { stack.push({ ...st }); groupStart = true; i++; continue; }
            if (c === '}') { st = stack.pop() || st; groupStart = false; i++; continue; }
            if (c === '\\') {
                const nx = rtf[i + 1];
                if (nx === '\\' || nx === '{' || nx === '}') { add(nx); i += 2; groupStart = false; continue; }
                if (nx === '~') { add(' '); i += 2; continue; }
                if (nx === '-' || nx === '_') { i += 2; continue; }
                if (nx === '*') { st.skip = true; i += 2; continue; }
                if (nx === '\'') {
                    const code = parseInt(rtf.substr(i + 2, 2), 16);
                    if (!isNaN(code)) add(String.fromCharCode(CP1252[code] || code));
                    i += 4; groupStart = false; continue;
                }
                if (nx === '\n' || nx === '\r') { if (!st.skip) endPara(); i += 2; continue; }
                const m = /^\\([a-zA-Z]{1,32})(-?\d{1,10})? ?/.exec(rtf.slice(i, i + 48));
                if (!m) { i++; continue; }
                i += m[0].length;
                const word = m[1], arg = m[2] === undefined ? null : parseInt(m[2], 10);
                if (groupStart && RTF_SKIP.has(word)) st.skip = true;
                groupStart = false;
                if (st.skip) continue;
                switch (word) {
                    case 'par': case 'sect': case 'page': case 'cell': case 'row': case 'nestcell': endPara(); break;
                    case 'pard': paraStyle = null; paraOutline = null; break;
                    case 's': paraStyle = String(arg); break;
                    case 'outlinelevel': paraOutline = arg != null && arg < 9 ? arg : null; break;
                    case 'line': runs.push({ br: true }); break;
                    case 'tab': add(' '); break;
                    case 'emdash': add('—'); break;
                    case 'endash': add('–'); break;
                    case 'lquote': add('‘'); break;
                    case 'rquote': add('’'); break;
                    case 'ldblquote': add('“'); break;
                    case 'rdblquote': add('”'); break;
                    case 'bullet': add('•'); break;
                    case 'b': st.b = arg !== 0; break;
                    case 'i': st.i = arg !== 0; break;
                    case 'ul': st.u = arg !== 0; break;
                    case 'ulnone': st.u = false; break;
                    case 'plain': st.b = st.i = st.u = false; break;
                    case 'uc': st.uc = arg || 0; break;
                    case 'u': {
                        let cp = arg < 0 ? arg + 65536 : arg;
                        add(String.fromCharCode(cp));
                        skipChars = st.uc;
                        break;
                    }
                }
                continue;
            }
            groupStart = false;
            if (c === '\r' || c === '\n') { i++; continue; }
            add(c);
            i++;
        }
        endPara();
        // As in Word: if no Heading 1 was used, the top heading level is chapters
        const levels = blocks.filter(b => b.type === 'heading').map(b => b.level);
        if (!blocks.some(b => b.type === 'chapter') && levels.length) {
            const top = Math.min(...levels);
            blocks.forEach(b => { if (b.type === 'heading' && b.level === top) b.type = 'chapter'; });
        }
        return { blocks, marked: blocks.some(b => b.type === 'chapter') };
    }

    // ── Word (.docx) ─────────────────────────────────────────────────────────
    async function unzip(buf) {
        const dv = new DataView(buf), bytes = new Uint8Array(buf);
        let eocd = -1;
        for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 66000); p--) {
            if (dv.getUint32(p, true) === 0x06054b50) { eocd = p; break; }
        }
        if (eocd < 0) throw new Error('not-zip');
        const count = dv.getUint16(eocd + 10, true);
        let p = dv.getUint32(eocd + 16, true);
        const files = {};
        const dec = new TextDecoder();
        for (let k = 0; k < count; k++) {
            if (dv.getUint32(p, true) !== 0x02014b50) break;
            const method = dv.getUint16(p + 10, true);
            const csize = dv.getUint32(p + 20, true);
            const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
            const off = dv.getUint32(p + 42, true);
            const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
            files[name] = { method, csize, off };
            p += 46 + nlen + xlen + clen;
        }
        return {
            has: name => !!files[name],
            async text(name) {
                const f = files[name];
                if (!f) return null;
                const lnl = dv.getUint16(f.off + 26, true), lxl = dv.getUint16(f.off + 28, true);
                const start = f.off + 30 + lnl + lxl;
                const data = bytes.subarray(start, start + f.csize);
                if (f.method === 0) return dec.decode(data);
                if (f.method !== 8) throw new Error('zip-method');
                if (typeof DecompressionStream === 'undefined') throw new Error('no-inflate');
                const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
                return dec.decode(await new Response(stream).arrayBuffer());
            }
        };
    }

    function wAttr(el, name) { return el ? (el.getAttributeNS(W_NS, name) || el.getAttribute('w:' + name)) : null; }
    function wChild(el, name) {
        if (!el) return null;
        for (const c of el.children) if (c.localName === name && c.namespaceURI === W_NS) return c;
        return null;
    }
    function onOff(el) {
        if (!el) return null;
        const v = wAttr(el, 'val');
        return !(v === '0' || v === 'false' || v === 'off' || v === 'none');
    }

    async function docxBlocks(buf) {
        const zip = await unzip(buf);
        const docXml = await zip.text('word/document.xml');
        if (!docXml) throw new Error('not-docx');
        const stylesXml = await zip.text('word/styles.xml');

        // Styles: heading level and character formatting, following "based on"
        const styles = {};
        if (stylesXml) {
            const sd = new DOMParser().parseFromString(stylesXml, 'application/xml');
            [...sd.getElementsByTagNameNS(W_NS, 'style')].forEach(s => {
                const id = wAttr(s, 'styleId');
                const name = (wAttr(wChild(s, 'name'), 'val') || '').toLowerCase();
                const pPr = wChild(s, 'pPr'), rPr = wChild(s, 'rPr');
                const ol = wAttr(wChild(pPr, 'outlineLvl'), 'val');
                styles[id] = {
                    name, basedOn: wAttr(wChild(s, 'basedOn'), 'val'),
                    outline: ol != null ? parseInt(ol, 10) : null,
                    b: onOff(wChild(rPr, 'b')), i: onOff(wChild(rPr, 'i')),
                    u: rPr && wChild(rPr, 'u') ? onOff(wChild(rPr, 'u')) : null
                };
            });
        }
        function styleProp(id, prop, depth) {
            const s = styles[id];
            if (!s || (depth || 0) > 10) return null;
            if (s[prop] != null) return s[prop];
            return s.basedOn ? styleProp(s.basedOn, prop, (depth || 0) + 1) : null;
        }
        function headingLevel(styleId, pPr) {
            const direct = wAttr(wChild(pPr, 'outlineLvl'), 'val');
            if (direct != null && direct !== '9') return parseInt(direct, 10) + 1;
            if (!styleId) return 0;
            const s = styles[styleId];
            const name = s ? s.name : styleId.toLowerCase();
            let m = /^heading\s*(\d)$/.exec(name);
            if (m) return parseInt(m[1], 10);
            if (name === 'title') return -1;          // the book's title
            const ol = styleProp(styleId, 'outline');
            if (ol != null && ol < 9) return ol + 1;
            m = /^heading(\d)$/i.exec(styleId);
            return m ? parseInt(m[1], 10) : 0;
        }

        const doc = new DOMParser().parseFromString(docXml, 'application/xml');
        const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
        if (!body) throw new Error('not-docx');

        const SKIP = new Set(['pPr', 'rPr', 'del', 'delText', 'instrText', 'footnoteReference', 'endnoteReference', 'commentReference', 'sectPr', 'fldData', 'moveFrom']);
        const blocks = [];
        let sawHeading1 = false, sawHeading2 = false;

        function paraRuns(p, base) {
            const out = [];
            let inFieldCode = false;
            (function walk(node, fmt) {
                for (const c of node.children) {
                    if (c.namespaceURI === MC_NS && c.localName === 'Fallback') continue;
                    if (c.namespaceURI !== W_NS) { walk(c, fmt); continue; }
                    const ln = c.localName;
                    if (SKIP.has(ln)) continue;
                    if (ln === 'r') {
                        const rPr = wChild(c, 'rPr');
                        const rs = wAttr(wChild(rPr, 'rStyle'), 'val');
                        const f = {
                            b: pick(onOff(wChild(rPr, 'b')), styleProp(rs, 'b'), fmt.b),
                            i: pick(onOff(wChild(rPr, 'i')), styleProp(rs, 'i'), fmt.i),
                            u: pick(rPr && wChild(rPr, 'u') ? onOff(wChild(rPr, 'u')) : null, styleProp(rs, 'u'), fmt.u)
                        };
                        for (const k of c.children) {
                            if (k.namespaceURI !== W_NS) continue;
                            const kn = k.localName;
                            if (kn === 'fldChar') {
                                const t = wAttr(k, 'fldCharType');
                                if (t === 'begin') inFieldCode = true; else if (t === 'separate' || t === 'end') inFieldCode = false;
                            } else if (inFieldCode) {
                                continue;
                            } else if (kn === 't') out.push({ text: k.textContent, ...f });
                            else if (kn === 'tab' || kn === 'ptab') out.push({ text: ' ', ...f });
                            else if (kn === 'noBreakHyphen') out.push({ text: '-', ...f });
                            else if (kn === 'sym') {
                                const ch = parseInt(wAttr(k, 'char') || '', 16);
                                if (ch && ch < 0xF000) out.push({ text: String.fromCharCode(ch), ...f });
                            } else if (kn === 'br' || kn === 'cr') {
                                if (wAttr(k, 'type') !== 'page' && wAttr(k, 'type') !== 'column') out.push({ br: true });
                            }
                        }
                        continue;
                    }
                    if (ln === 'p') continue;                 // nested paragraphs handled on their own
                    walk(c, fmt);                             // hyperlink, ins, smartTag, sdt, fldSimple…
                }
            })(p, base);
            return out;
        }
        function pick(direct, style, inherited) {
            if (direct != null) return direct;
            if (style != null) return style;
            return !!inherited;
        }

        function addPara(p) {
            const pPr = wChild(p, 'pPr');
            const sid = wAttr(wChild(pPr, 'pStyle'), 'val');
            const base = { b: !!styleProp(sid, 'b'), i: !!styleProp(sid, 'i'), u: !!styleProp(sid, 'u') };
            const runs = cleanRuns(paraRuns(p, base));
            if (!runs.length) return;
            const lvl = headingLevel(sid, pPr);
            if (lvl === 1) { sawHeading1 = true; blocks.push({ type: 'chapter', runs: plainRuns(runs), level: 1 }); }
            else if (lvl >= 2) { sawHeading2 = true; blocks.push({ type: 'heading', runs: plainRuns(runs), level: lvl }); }
            else if (lvl === -1) blocks.push({ type: 'title', runs });
            else blocks.push({ type: 'para', runs });
        }
        (function walkBody(el) {
            for (const c of el.children) {
                if (c.namespaceURI === MC_NS && c.localName === 'Fallback') continue;
                if (c.namespaceURI === W_NS && c.localName === 'p') {
                    addPara(c);
                    // Text boxes inside the paragraph
                    [...c.getElementsByTagNameNS(W_NS, 'txbxContent')].forEach(tb => {
                        if (!tb.closest || !hasFallbackAncestor(tb, c)) walkBody(tb);
                    });
                } else if (c.namespaceURI === W_NS && (c.localName === 'sectPr' || c.localName === 'del')) {
                    continue;
                } else walkBody(c);           // tables, content controls, tracked insertions
            }
        })(body);
        function hasFallbackAncestor(node, stop) {
            for (let n = node.parentNode; n && n !== stop; n = n.parentNode) if (n.namespaceURI === MC_NS && n.localName === 'Fallback') return true;
            return false;
        }

        // Writers who use only Heading 2 for chapters: treat the top level used as chapters
        if (!sawHeading1 && sawHeading2) {
            const top = Math.min(...blocks.filter(b => b.type === 'heading').map(b => b.level));
            blocks.forEach(b => { if (b.type === 'heading' && b.level === top) b.type = 'chapter'; });
        }
        const marked = blocks.some(b => b.type === 'chapter');
        // The book's title is shown in the preview, not imported as text
        const titleBlock = blocks.find(b => b.type === 'title');
        return {
            blocks: blocks.filter(b => b.type !== 'title'),
            marked,
            docTitle: titleBlock ? runsText(titleBlock.runs).trim() : ''
        };
    }

    // ── Draft Punk backups ───────────────────────────────────────────────────
    // version 1: the open project's chapters in writingData
    // version 2: every project's chapters in chaptersByProject
    function backupProjects(data) {
        const dp = data.draftPunkData || {};
        const titles = {};
        Object.keys(dp.projects || {}).forEach(id => { titles[id] = (dp.projects[id] && dp.projects[id].title) || 'Untitled project'; });
        const byProject = {};
        if (data.chaptersByProject && typeof data.chaptersByProject === 'object') {
            Object.keys(data.chaptersByProject).forEach(pid => {
                if (Array.isArray(data.chaptersByProject[pid])) byProject[pid] = data.chaptersByProject[pid];
            });
        } else if (data.writingData && Array.isArray(data.writingData.chapters)) {
            byProject[data.writingData.projectId || dp.activeProjectId || 'project'] = data.writingData.chapters;
        }
        const perProject = (obj, pid, flatOk) => {
            if (!obj || typeof obj !== 'object') return undefined;
            if (obj[pid] !== undefined) return obj[pid];
            // Very old backups stored one project's notes without a project key
            return flatOk && pid === dp.activeProjectId ? obj : undefined;
        };
        const ids = new Set([...Object.keys(byProject), ...Object.keys(titles)]);
        const out = [];
        ids.forEach(pid => {
            const chapters = (byProject[pid] || []).filter(c => c && typeof c === 'object')
                .slice().sort((a, b) => (a.order || 0) - (b.order || 0));
            let notes = perProject(data.notesData, pid, false);
            notes = Array.isArray(notes) ? notes.filter(n => n && typeof n === 'object') : [];
            let chars = perProject(data.charactersData, pid, data.charactersData && Array.isArray(data.charactersData.chars));
            chars = chars && Array.isArray(chars.chars) ? chars.chars.filter(c => c && typeof c === 'object') : [];
            let beats = perProject(data.beatNotesData, pid, data.beatNotesData && !Object.keys(data.beatNotesData).some(k => k === pid));
            beats = beats && typeof beats === 'object' && !Array.isArray(beats) ? beats : {};
            const beatSections = Object.keys(beats).reduce((s, k) => s + (Array.isArray(beats[k]) ? beats[k].length : (typeof beats[k] === 'string' && beats[k].trim() ? 1 : 0)), 0);
            if (!chapters.length && !notes.length && !chars.length && !beatSections) return;
            out.push({
                id: pid, title: titles[pid] || 'Project',
                chapters: chapters.map(c => ({ title: c.title || '', html: typeof window.sanitizeHtml === 'function' ? window.sanitizeHtml(String(c.content || '')) : esc(plainText(String(c.content || ''))) }))
                    .map(c => ({ ...c, words: wordsIn(c.html) })),
                notes, chars, beats, beatSections
            });
        });
        return out;
    }

    // ── Reading a file ───────────────────────────────────────────────────────
    function readAs(file, how) {
        return new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.onerror = () => rej(r.error || new Error('read'));
            if (how === 'buffer') r.readAsArrayBuffer(file); else r.readAsText(file, 'utf-8');
        });
    }
    async function parseFile(file) {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        if (ext === 'json') {
            let data;
            try { data = JSON.parse(await readAs(file, 'text')); } catch (e) { throw new Error('bad-backup'); }
            if (!data || typeof data !== 'object' || !data.version) throw new Error('bad-backup');
            return { kind: 'backup', name: file.name, exported: data.exported || null, projects: backupProjects(data) };
        }
        let parsed;
        if (ext === 'docx') parsed = await docxBlocks(await readAs(file, 'buffer'));
        else if (ext === 'doc') throw new Error('old-doc');
        else if (ext === 'rtf') parsed = rtfBlocks(await readAs(file, 'text'));
        else if (ext === 'html' || ext === 'htm') parsed = htmlBlocks(await readAs(file, 'text'));
        else if (ext === 'txt' || ext === 'md' || ext === 'text') parsed = { blocks: textBlocks(await readAs(file, 'text')), marked: false };
        else throw new Error('type');
        return { kind: 'story', name: file.name, blocks: parsed.blocks, marked: parsed.marked, docTitle: parsed.docTitle || '' };
    }
    // Chapters for the preview, from a story's blocks and the chosen split
    function storyChapters(story, split) {
        let groups;
        if (split === 'one') groups = asOneChapter(story.blocks);
        else groups = toChapters(story.blocks, story.marked);
        return groups.map(g => {
            const html = blocksHtml(g.blocks);
            return { title: g.title, html, words: wordsIn(html) };
        });
    }
    function detectedCount(story) {
        if (story.marked) return story.blocks.filter(b => b.type === 'chapter').length;
        return story.blocks.filter(b => b.type !== 'heading' && isChapterLine(runsText(b.runs))).length;
    }

    // ── Adding notes, characters and beat notes from a backup ────────────────
    // Only adds: an item already here (same id, same content) is skipped; an
    // item with the same id but different content is added as a copy with a
    // new id. Nothing already in the project is changed.
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    function addItems(existing, incoming, makeId, markCopy) {
        const out = existing.slice();
        let added = 0;
        incoming.forEach(item => {
            const here = out.find(x => String(x.id) === String(item.id));
            if (here && same(here, item)) return;
            const copy = JSON.parse(JSON.stringify(item));
            if (here || item.id == null) { copy.id = makeId(); markCopy(copy); }
            out.push(copy); added++;
        });
        return { list: out, added };
    }
    function addBackupExtras(project, pid, opts, label) {
        let notesAdded = 0, charsAdded = 0, beatsAdded = 0;
        const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        if (opts.notes && project.notes.length) {
            const all = JSON.parse(localStorage.getItem('notesData') || '{}');
            const r = addItems(Array.isArray(all[pid]) ? all[pid] : [], project.notes, () => 'note_' + uid(),
                n => { n.title = (n.title ? n.title + ' ' : '') + label; });
            if (r.added) { all[pid] = r.list; localStorage.setItem('notesData', JSON.stringify(all)); }
            notesAdded = r.added;
        }
        if (opts.chars && project.chars.length) {
            const all = JSON.parse(localStorage.getItem('charactersData') || '{}');
            const cur = all[pid] && Array.isArray(all[pid].chars) ? all[pid] : { ...(all[pid] || {}), chars: [] };
            const r = addItems(cur.chars, project.chars, () => String(Date.now()) + Math.floor(Math.random() * 1000),
                c => { c.name = (c.name ? c.name + ' ' : '') + label; });
            if (r.added) { all[pid] = { ...cur, chars: r.list }; localStorage.setItem('charactersData', JSON.stringify(all)); }
            charsAdded = r.added;
        }
        if (opts.beats && project.beatSections) {
            const all = JSON.parse(localStorage.getItem('beatNotesData') || '{}');
            const cur = all[pid] && typeof all[pid] === 'object' ? { ...all[pid] } : {};
            let n = 0;
            Object.keys(project.beats).forEach(beat => {
                let incoming = project.beats[beat];
                if (typeof incoming === 'string') incoming = incoming.trim() ? [{ id: Date.now() + n, title: 'Notes', text: incoming }] : [];
                if (!Array.isArray(incoming) || !incoming.length) return;
                let mine = cur[beat];
                if (typeof mine === 'string') mine = mine.trim() ? [{ id: Date.now() - 1, title: 'Notes', text: mine }] : [];
                const r = addItems(Array.isArray(mine) ? mine : [], incoming, () => Date.now() + (++n) + Math.floor(Math.random() * 1000),
                    s => { s.title = (s.title ? s.title + ' ' : '') + label; });
                if (r.added) { cur[beat] = r.list; beatsAdded += r.added; }
            });
            if (beatsAdded) { all[pid] = cur; localStorage.setItem('beatNotesData', JSON.stringify(all)); }
        }
        return { notesAdded, charsAdded, beatsAdded };
    }

    // ── Dialog ───────────────────────────────────────────────────────────────
    function projectTitle() {
        const dp = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
        const p = dp.projects && dp.projects[dp.activeProjectId];
        return { id: dp.activeProjectId, title: (p && p.title) || 'this project' };
    }
    function shortDate(iso) {
        const d = iso ? new Date(iso) : null;
        if (!d || isNaN(d)) return '';
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
    }
    const ERRORS = {
        'old-doc': 'This is an older Word file (.doc). In Word, choose File → Save As → Word Document (.docx), then import that.',
        'no-inflate': 'This browser can\'t open Word files. Please update it, or save the file as RTF and import that.',
        'not-zip': 'This doesn\'t look like a Word (.docx) file. If it came from Pages or another app, export it as Word (.docx) or RTF first.',
        'not-docx': 'This doesn\'t look like a Word (.docx) file. If it came from Pages or another app, export it as Word (.docx) or RTF first.',
        'zip-method': 'This Word file is saved in a way Draft Punk can\'t read. Try File → Save As → Word Document (.docx) and import that.',
        'bad-backup': 'This file isn\'t a Draft Punk backup Draft Punk can read.',
        'type': 'Draft Punk can import Word (.docx), RTF, plain text (.txt), web page (.html) files and Draft Punk backups (.json).'
    };

    function open(mode) {
        let ov = document.getElementById('importOverlay');
        if (!ov) { ov = document.createElement('div'); ov.id = 'importOverlay'; ov.className = 'export-overlay'; document.body.appendChild(ov); }
        const proj = projectTitle();
        let state = { file: null, parsed: null, split: 'detected', projectIdx: 0, error: '', busy: false };
        const backupMode = mode === 'backup';

        function render() {
            const p = state.parsed;
            let body = '';
            if (!p) {
                body = `
                <div class="exp-sec">
                    <p class="exp-note" style="color:var(--text)">${backupMode
                        ? 'Choose a Draft Punk backup file (.json). You\'ll see what\'s in it before anything is added.'
                        : 'Choose a Word (.docx), RTF, plain text or web page file, or a Draft Punk backup (.json). You\'ll see what was found before anything is added.'}</p>
                    ${backupMode ? '' : '<p class="exp-note"><b>From Google Docs:</b> File → Download → Microsoft Word (.docx), then choose that file here.</p>'}
                    <button type="button" id="impChoose" style="width:100%;margin-top:8px;">CHOOSE FILE</button>
                    <input type="file" id="impFile" accept="${backupMode ? '.json' : '.docx,.rtf,.txt,.html,.htm,.md,.json,.doc'}" style="display:none">
                    ${state.busy ? '<p class="exp-note">Reading…</p>' : ''}
                    ${state.error ? `<p class="exp-note imp-error">${esc(state.error)}</p>` : ''}
                </div>
                <div class="exp-sec"><p class="exp-note">Importing only adds. New chapters go at the end of <b>${esc(proj.title)}</b>; nothing already in it is changed. Imported words show as imported in your Writing Record and aren't added to your tracker.</p></div>`;
            } else if (p.kind === 'story') {
                const chapters = storyChapters(p, state.split);
                const found = detectedCount(p);
                state.chapters = chapters;
                const empty = chapters.filter(c => !c.words);
                body = `
                <div class="exp-sec"><div class="exp-label">FILE</div>
                    <p class="exp-note" style="color:var(--text);margin-top:0">${esc(p.name)}${p.docTitle ? ' · ' + esc(p.docTitle) : ''}</p>
                </div>
                <div class="exp-sec"><div class="exp-label">CHAPTERS</div>
                    <div class="exp-chips">
                        <label class="exp-chip"><input type="radio" name="impSplit" value="detected"${state.split === 'detected' ? ' checked' : ''}><span>${found ? `SPLIT AT CHAPTER HEADINGS (${found})` : 'NO CHAPTER HEADINGS FOUND'}</span></label>
                        <label class="exp-chip"><input type="radio" name="impSplit" value="one"${state.split === 'one' ? ' checked' : ''}><span>ONE CHAPTER</span></label>
                    </div>
                    <p class="exp-note">${p.marked
                        ? 'Chapters come from the headings in your file (Heading 1). Smaller headings become scene headings.'
                        : 'Chapters start at lines such as "Chapter 1", "Chapter One: Title", "Part Two" or "Prologue".'}</p>
                    <div class="exp-chapters" style="max-height:240px">
                        ${chapters.map((c, i) => `<label class="exp-ch"><input type="checkbox" value="${i}"${c.words ? ' checked' : ''}><span>${esc(c.title || 'Untitled')}</span><em>${c.words.toLocaleString()}</em></label>`).join('')}
                    </div>
                    ${empty.length ? `<p class="exp-note">${empty.length} heading${empty.length > 1 ? 's have' : ' has'} no text under ${empty.length > 1 ? 'them' : 'it'} and ${empty.length > 1 ? 'are' : 'is'} unticked.</p>` : ''}
                </div>
                <div class="exp-sec"><p class="exp-note">The chapters you tick are added at the end of <b>${esc(proj.title)}</b>. Nothing already in it is changed. Imported words show as imported in your Writing Record and aren't added to your tracker.</p></div>`;
            } else {
                const projects = p.projects;
                if (!projects.length) {
                    body = `<div class="exp-sec"><p class="exp-note">${esc(p.name)}${p.exported ? ' · saved ' + esc(shortDate(p.exported)) : ''}</p><p class="exp-note imp-error">This backup has no chapters or notes in it.</p></div>`;
                } else {
                    const sp = projects[Math.min(state.projectIdx, projects.length - 1)];
                    state.chapters = sp.chapters;
                    body = `
                    <div class="exp-sec"><div class="exp-label">BACKUP</div>
                        <p class="exp-note" style="color:var(--text);margin-top:0">${esc(p.name)}${p.exported ? ' · saved ' + esc(shortDate(p.exported)) : ''}</p>
                    </div>
                    ${projects.length > 1 ? `<div class="exp-sec"><div class="exp-label">PROJECT IN THE BACKUP</div><div class="exp-chips">
                        ${projects.map((pr, i) => `<label class="exp-chip"><input type="radio" name="impProj" value="${i}"${i === state.projectIdx ? ' checked' : ''}><span>${esc(pr.title.toUpperCase())}</span></label>`).join('')}
                    </div></div>` : ''}
                    <div class="exp-sec"><div class="exp-label">CHAPTERS <span class="exp-links"><button type="button" id="impAll">ALL</button> · <button type="button" id="impNone">NONE</button></span></div>
                        ${sp.chapters.length ? `<div class="exp-chapters" style="max-height:240px">
                            ${sp.chapters.map((c, i) => `<label class="exp-ch"><input type="checkbox" value="${i}"${c.words ? ' checked' : ''}><span>${esc(c.title || 'Untitled')}</span><em>${c.words.toLocaleString()}</em></label>`).join('')}
                        </div>` : '<p class="exp-note">No chapters in this project.</p>'}
                    </div>
                    ${(sp.notes.length || sp.chars.length || sp.beatSections) ? `<div class="exp-sec"><div class="exp-label">ALSO ADD</div>
                        ${sp.notes.length ? `<label class="exp-check"><input type="checkbox" id="impNotes" checked> Notes (${sp.notes.length})</label>` : ''}
                        ${sp.chars.length ? `<label class="exp-check" style="margin-top:6px"><input type="checkbox" id="impChars" checked> Characters (${sp.chars.length})</label>` : ''}
                        ${sp.beatSections ? `<label class="exp-check" style="margin-top:6px"><input type="checkbox" id="impBeats" checked> Beat notes (${sp.beatSections})</label>` : ''}
                    </div>` : ''}
                    <div class="exp-sec"><p class="exp-note">Everything you tick is <b>added</b> to <b>${esc(proj.title)}</b> as copies marked "from backup${p.exported ? ' ' + esc(shortDate(p.exported)) : ''}". Nothing already in it is replaced, so you may see a chapter twice — keep the one you want. Word counts, XP and streaks in the backup aren't restored.</p></div>`;
                }
            }
            const canAdd = p && state.chapters && (p.kind === 'story' || (p.projects && p.projects.length));
            ov.innerHTML = `
            <div class="export-box" role="dialog" aria-modal="true" aria-labelledby="impTitle">
                <div class="exp-head"><h2 id="impTitle">${backupMode || (p && p.kind === 'backup') ? 'RESTORE FROM BACKUP' : 'IMPORT'}</h2><button class="exp-x" id="impClose" aria-label="Close">✕</button></div>
                ${body}
                ${canAdd ? `<div class="exp-foot">
                    <button type="button" class="btn-secondary" id="impBack" style="width:auto">← OTHER FILE</button>
                    <span id="impSummary" class="exp-note"></span>
                    <button id="impGo">ADD</button>
                </div>` : ''}
            </div>`;
            wire();
        }

        function selectedChapters() {
            return [...ov.querySelectorAll('.exp-ch input:checked')].map(i => state.chapters[+i.value]).filter(Boolean);
        }
        function refreshSummary() {
            const sum = document.getElementById('impSummary'), go = document.getElementById('impGo');
            if (!sum || !go) return;
            const chs = selectedChapters();
            const words = chs.reduce((s, c) => s + c.words, 0);
            const extras = ['impNotes', 'impChars', 'impBeats'].some(id => { const e = document.getElementById(id); return e && e.checked; });
            sum.textContent = `${chs.length} chapter${chs.length !== 1 ? 's' : ''} · ${words.toLocaleString()} words`;
            go.disabled = !chs.length && !extras;
        }

        function wire() {
            const $ = id => document.getElementById(id);
            const close = () => { ov.style.display = 'none'; };
            $('impClose').onclick = close;
            ov.onclick = e => { if (e.target === ov) close(); };
            if ($('impChoose')) {
                $('impChoose').onclick = () => $('impFile').click();
                $('impFile').onchange = async e => {
                    const f = e.target.files[0];
                    if (!f) return;
                    state.busy = true; state.error = ''; render();
                    try {
                        state.parsed = await parseFile(f);
                        state.split = 'detected'; state.projectIdx = 0;
                        if (state.parsed.kind === 'backup') {
                            const i = state.parsed.projects.findIndex(x => x.id === proj.id);
                            if (i >= 0) state.projectIdx = i;
                        }
                    } catch (err) {
                        console.warn('Import read failed:', err);
                        state.error = ERRORS[err && err.message] || 'Sorry — that file couldn\'t be read. Nothing has been changed.';
                    }
                    state.busy = false; render();
                };
            }
            ov.querySelectorAll('input[name=impSplit]').forEach(r => r.onchange = () => { state.split = r.value; render(); });
            ov.querySelectorAll('input[name=impProj]').forEach(r => r.onchange = () => { state.projectIdx = +r.value; render(); });
            ov.querySelectorAll('.exp-ch input, .exp-check input').forEach(i => i.addEventListener('change', refreshSummary));
            if ($('impAll'))  $('impAll').onclick  = () => { ov.querySelectorAll('.exp-ch input').forEach(i => i.checked = true);  refreshSummary(); };
            if ($('impNone')) $('impNone').onclick = () => { ov.querySelectorAll('.exp-ch input').forEach(i => i.checked = false); refreshSummary(); };
            if ($('impBack')) $('impBack').onclick = () => { state.parsed = null; state.error = ''; render(); };
            if ($('impGo')) $('impGo').onclick = () => {
                const p = state.parsed;
                const chs = selectedChapters();
                const label = '(from backup' + (p.exported ? ' ' + shortDate(p.exported) : '') + ')';
                let added = 0, extras = { notesAdded: 0, charsAdded: 0, beatsAdded: 0 };
                try {
                    if (chs.length) {
                        added = window.dpAddImportedChapters(chs.map(c => ({
                            title: p.kind === 'backup' ? ((c.title || 'Untitled') + ' ' + label) : c.title,
                            html: c.html
                        })));
                    }
                    if (p.kind === 'backup') {
                        const sp = p.projects[state.projectIdx];
                        const chk = id => { const e = document.getElementById(id); return !!(e && e.checked); };
                        extras = addBackupExtras(sp, proj.id, { notes: chk('impNotes'), chars: chk('impChars'), beats: chk('impBeats') }, label);
                    }
                } catch (err) {
                    console.error('Import failed:', err);
                    alert('Sorry — the import failed. Nothing already in your project was changed.');
                    return;
                }
                close();
                const bits = [];
                if (added) bits.push(added + ' CHAPTER' + (added !== 1 ? 'S' : ''));
                if (extras.notesAdded) bits.push(extras.notesAdded + ' NOTE' + (extras.notesAdded !== 1 ? 'S' : ''));
                if (extras.charsAdded) bits.push(extras.charsAdded + ' CHARACTER' + (extras.charsAdded !== 1 ? 'S' : ''));
                if (extras.beatsAdded) bits.push(extras.beatsAdded + ' BEAT NOTE' + (extras.beatsAdded !== 1 ? 'S' : ''));
                if (window.showWriteToast) window.showWriteToast(null, '✓ ADDED', bits.length ? bits.join(' · ') : 'NOTHING NEW TO ADD');
            };
            refreshSummary();
        }

        render();
        ov.style.display = 'flex';
        document.addEventListener('keydown', function escK(e) { if (e.key === 'Escape') { ov.style.display = 'none'; document.removeEventListener('keydown', escK); } });
    }

    window.DPImport = {
        open, parseFile, storyChapters, detectedCount, isChapterLine, backupProjects, addItems,
        _rtfBlocks: rtfBlocks, _rtfHeadingStyles: rtfHeadingStyles, _htmlBlocks: htmlBlocks, _docxBlocks: docxBlocks, _textBlocks: textBlocks
    };
})();
