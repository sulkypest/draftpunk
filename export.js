// ── Export ────────────────────────────────────────────────────────────────────
// Export dialog: format (Word .docx, PDF, RTF), which chapters, and layout
// (standard manuscript, reading copy, or custom). Export only reads chapters;
// it never changes them. Settings (including name and contact details for the
// title page) are saved on this device only — never synced to the cloud.
(function () {
    const PREFS_KEY = 'dpExportPrefs';

    // ── Settings ─────────────────────────────────────────────────────────────
    const PRESETS = {
        manuscript: { font: 'Times New Roman', size: 12, spacing: 2,    paraStyle: 'indent', header: true,  titlePage: true,  newPage: true  },
        reading:    { font: 'Georgia',         size: 11, spacing: 1.15, paraStyle: 'indent', header: false, titlePage: true,  newPage: true  }
    };
    const DEFAULTS = {
        format: 'docx', preset: 'manuscript', pageSize: 'A4',
        font: 'Times New Roman', size: 12, spacing: 2, paraStyle: 'indent', header: true, titlePage: true, newPage: true,
        chapterTitles: 'asWritten', sceneHeadings: 'keep', firstPara: 'indent',
        authorName: '', byline: '', contact: '', surname: ''
    };

    function projectInfo() {
        const dp = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
        const proj = (dp.projects && dp.projects[dp.activeProjectId]) || {};
        return { id: dp.activeProjectId, title: proj.title || 'MY STORY' };
    }
    function loadPrefs() {
        let all = {};
        try { all = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch (e) {}
        const shared = all._author || {};
        const proj = all[projectInfo().id] || {};
        return Object.assign({}, DEFAULTS, shared, proj);
    }
    function savePrefs(o) {
        let all = {};
        try { all = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch (e) {}
        // Name and contact details are the writer's, not the project's
        all._author = { authorName: o.authorName, contact: o.contact, surname: o.surname };
        const { authorName, contact, surname, ...rest } = o;
        all[projectInfo().id] = rest;
        try { localStorage.setItem(PREFS_KEY, JSON.stringify(all)); } catch (e) {}
    }
    // The settings actually used, with a preset's fixed values applied
    function effective(o) {
        return o.preset === 'custom' ? { ...o } : { ...o, ...PRESETS[o.preset] };
    }

    // ── Document model ───────────────────────────────────────────────────────
    // A chapter's HTML becomes a list of blocks:
    //   { type: 'para' | 'heading', runs: [{ text, b, i, u, br }] }, { type: 'blank' }
    // Text sitting directly in the editor (a chapter's opening paragraph, which
    // the browser doesn't wrap) is its own paragraph. Soft line breaks (\n or
    // <br> inside a paragraph) become line breaks within the paragraph.
    function parseChapter(html) {
        const root = document.createElement('div');
        root.innerHTML = html || '';
        const blocks = [];
        let loose = [];
        const flushLoose = () => {
            if (loose.length) { pushPara(blocks, 'para', loose); loose = []; }
        };
        root.childNodes.forEach(node => {
            const tag = node.nodeType === 1 ? node.tagName.toLowerCase() : '';
            if (tag === 'h2' || tag === 'h3') {
                flushLoose();
                pushPara(blocks, 'heading', collectRuns(node, {}));
            } else if (tag === 'div' || tag === 'p') {
                flushLoose();
                // A block may itself contain blocks (pasted structure)
                if ([...node.children].some(c => /^(DIV|P|H2|H3)$/.test(c.tagName))) {
                    parseChapter(node.innerHTML).forEach(b => blocks.push(b));
                } else {
                    pushPara(blocks, 'para', collectRuns(node, {}));
                }
            } else if (tag === 'br' && !loose.length) {
                blocks.push({ type: 'blank' });
            } else {
                collectRuns(node, {}, loose);
            }
        });
        flushLoose();
        return blocks;
    }
    function pushPara(blocks, type, runs) {
        // Drop a trailing line break (the browser's placeholder <br>)
        while (runs.length && runs[runs.length - 1].br) runs.pop();
        const hasText = runs.some(r => r.text && r.text.trim());
        if (!hasText) { blocks.push({ type: 'blank' }); return; }
        blocks.push({ type, runs });
    }
    function collectRuns(node, fmt, out) {
        out = out || [];
        if (node.nodeType === 3) {
            const parts = node.textContent.replace(/ /g, ' ').split('\n');
            parts.forEach((t, i) => {
                if (i > 0) out.push({ br: true });
                if (t) out.push({ text: t, b: !!fmt.b, i: !!fmt.i, u: !!fmt.u });
            });
            return out;
        }
        if (node.nodeType !== 1) return out;
        const tag = node.tagName.toLowerCase();
        if (tag === 'br') { out.push({ br: true }); return out; }
        const f = { ...fmt };
        if (tag === 'b' || tag === 'strong') f.b = true;
        if (tag === 'i' || tag === 'em')     f.i = true;
        if (tag === 'u')                      f.u = true;
        const st = node.getAttribute && (node.getAttribute('style') || '');
        if (/font-weight:\s*(bold|[6-9]00)/i.test(st)) f.b = true;
        if (/font-style:\s*italic/i.test(st)) f.i = true;
        if (/text-decoration[^;]*underline/i.test(st)) f.u = true;
        node.childNodes.forEach(c => collectRuns(c, f, out));
        return out;
    }

    const ONES = ['Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
    const TENS = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
    function numberWords(n) {
        if (n < 20) return ONES[n];
        if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
        if (n < 1000) return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + numberWords(n % 100) : '');
        return String(n);
    }
    function chapterHeading(title, n, mode) {
        switch (mode) {
            case 'words':      return 'Chapter ' + numberWords(n);
            case 'digits':     return 'Chapter ' + n;
            case 'wordsTitle': return 'Chapter ' + numberWords(n) + ': ' + title;
            default:           return title;
        }
    }

    // Build the whole document as a flat list the writers below can render
    function buildDoc(chapters, o) {
        const items = [];
        chapters.forEach((ch, idx) => {
            items.push({ type: 'chapter', text: chapterHeading(ch.title || 'Untitled', idx + 1, o.chapterTitles), first: idx === 0 });
            let afterBreak = true;   // the next paragraph opens a chapter or scene
            parseChapter(ch.content).forEach(b => {
                if (b.type === 'heading') {
                    if (o.sceneHeadings === 'remove') { afterBreak = true; return; }
                    if (o.sceneHeadings === 'break')  { items.push({ type: 'sceneBreak' }); afterBreak = true; return; }
                    items.push({ type: 'heading', runs: b.runs }); afterBreak = true; return;
                }
                if (b.type === 'blank') { items.push({ type: 'blank' }); return; }
                items.push({ type: 'para', runs: b.runs, opening: afterBreak });
                afterBreak = false;
            });
        });
        return items;
    }
    function wordCountFor(chapters) {
        return chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
    }
    function roundedWords(n) {
        const r = n >= 10000 ? Math.round(n / 1000) * 1000 : Math.max(100, Math.round(n / 100) * 100);
        return 'about ' + r.toLocaleString('en-GB') + ' words';
    }
    function surnameFor(o) {
        if (o.surname && o.surname.trim()) return o.surname.trim();
        const name = (o.byline || o.authorName || '').trim().split(/\s+/);
        return name[name.length - 1] || '';
    }
    function shortTitle(t) {
        const words = t.trim().split(/\s+/);
        return (words.length > 4 ? words.slice(0, 4).join(' ') : t.trim()).toUpperCase();
    }
    function paraIndented(item, o) {
        if (o.paraStyle !== 'indent') return false;
        if (item.opening && o.firstPara === 'flush') return false;
        return true;
    }

    // ── Word (.docx) ─────────────────────────────────────────────────────────
    function xmlEsc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    }
    function docxRuns(runs) {
        return runs.map(r => {
            if (r.br) return '<w:r><w:br/></w:r>';
            const pr = (r.b ? '<w:b/>' : '') + (r.i ? '<w:i/>' : '') + (r.u ? '<w:u w:val="single"/>' : '');
            return `<w:r>${pr ? '<w:rPr>' + pr + '</w:rPr>' : ''}<w:t xml:space="preserve">${xmlEsc(r.text)}</w:t></w:r>`;
        }).join('');
    }
    function docxPara(style, content, extraPPr) {
        return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extraPPr || ''}</w:pPr>${content}</w:p>`;
    }
    function buildDocx(title, chapters, o) {
        const A4 = o.pageSize === 'A4';
        const pgW = A4 ? 11906 : 12240, pgH = A4 ? 16838 : 15840, margin = 1440;
        const textW = pgW - margin * 2;
        const line = Math.round(240 * o.spacing);
        const half = o.size * 2;
        const block = o.paraStyle === 'block';
        const items = buildDoc(chapters, o);

        let body = '';
        if (o.titlePage) {
            const name = o.authorName.trim(), by = (o.byline || o.authorName).trim();
            const contactLines = (o.contact || '').split('\n').map(s => s.trim()).filter(Boolean);
            const wc = roundedWords(wordCountFor(chapters));
            if (o.header) {
                // Manuscript: contact block top left, word count top right
                body += docxPara('TitleInfo', `<w:r><w:t xml:space="preserve">${xmlEsc(name)}</w:t></w:r><w:r><w:tab/><w:t>${xmlEsc(wc)}</w:t></w:r>`,
                    `<w:tabs><w:tab w:val="right" w:pos="${textW}"/></w:tabs>`);
                contactLines.forEach(l => { body += docxPara('TitleInfo', `<w:r><w:t xml:space="preserve">${xmlEsc(l)}</w:t></w:r>`); });
                body += docxPara('TitleMain', `<w:r><w:t xml:space="preserve">${xmlEsc(title.toUpperCase())}</w:t></w:r>`, '<w:spacing w:before="4320"/>');
                if (by) body += docxPara('TitleBy', `<w:r><w:t xml:space="preserve">by ${xmlEsc(by)}</w:t></w:r>`);
            } else {
                body += docxPara('TitleMain', `<w:r><w:t xml:space="preserve">${xmlEsc(title)}</w:t></w:r>`, '<w:spacing w:before="4320"/>');
                if (by) body += docxPara('TitleBy', `<w:r><w:t xml:space="preserve">${xmlEsc(by)}</w:t></w:r>`);
            }
        }
        items.forEach(it => {
            if (it.type === 'chapter') {
                const breakBefore = (o.newPage && (o.titlePage || !it.first)) ? '<w:pageBreakBefore/>' : '';
                body += docxPara('ChapterTitle', `<w:r><w:t xml:space="preserve">${xmlEsc(it.text)}</w:t></w:r>`, breakBefore);
            } else if (it.type === 'heading') {
                body += docxPara('SceneHeading', docxRuns(it.runs));
            } else if (it.type === 'sceneBreak') {
                body += docxPara('SceneBreak', '<w:r><w:t>#</w:t></w:r>');
            } else if (it.type === 'blank') {
                body += docxPara(block ? 'BodyFlush' : 'BodyFlush', '');
            } else {
                body += docxPara(paraIndented(it, o) ? 'Body' : 'BodyFlush', docxRuns(it.runs));
            }
        });

        const headerRef = o.header ? '<w:headerReference w:type="default" r:id="rIdHeader"/>' : '';
        const sect = `<w:sectPr>${headerRef}<w:pgSz w:w="${pgW}" w:h="${pgH}"/>` +
            `<w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="720" w:footer="720" w:gutter="0"/>` +
            `${o.titlePage ? '<w:titlePg/>' : ''}</w:sectPr>`;

        const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
        const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;

        const after = block ? Math.round(half * 10) : 0;
        const rFonts = `<w:rFonts w:ascii="${xmlEsc(o.font)}" w:hAnsi="${xmlEsc(o.font)}" w:cs="${xmlEsc(o.font)}" w:eastAsia="${xmlEsc(o.font)}"/>`;
        const style = (id, name, pPr, rPr) =>
            `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${pPr}</w:pPr>${rPr ? '<w:rPr>' + rPr + '</w:rPr>' : ''}</w:style>`;
        const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>${rFonts}<w:sz w:val="${half}"/><w:szCs w:val="${half}"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${style('Body', 'Body Text Indented', `<w:spacing w:after="${after}"/><w:ind w:firstLine="${block ? 0 : 720}"/>`)}
${style('BodyFlush', 'Body Text Flush', `<w:spacing w:after="${after}"/><w:ind w:firstLine="0"/>`)}
${style('ChapterTitle', 'Chapter Title', `<w:keepNext/><w:spacing w:before="${o.header ? 2880 : 1440}" w:after="${o.header ? 480 : 720}"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/>`, o.header ? '' : '<w:b/>')}
${style('SceneHeading', 'Scene Heading', `<w:keepNext/><w:spacing w:before="${line}"/>`, '<w:b/>')}
${style('SceneBreak', 'Scene Break', '<w:keepNext/><w:jc w:val="center"/>')}
${style('TitleInfo', 'Title Page Details', '<w:spacing w:line="240" w:lineRule="auto"/>')}
${style('TitleMain', 'Title Page Title', '<w:jc w:val="center"/>', o.header ? '' : '<w:b/><w:sz w:val="' + (half + 12) + '"/>')}
${style('TitleBy', 'Title Page Byline', '<w:spacing w:before="240"/><w:jc w:val="center"/>')}
${style('Header', 'Header', '<w:jc w:val="right"/><w:spacing w:line="240" w:lineRule="auto"/>')}
</w:styles>`;

        const headerText = `${surnameFor(o) ? xmlEsc(surnameFor(o)) + ' / ' : ''}${xmlEsc(shortTitle(title))} / `;
        const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:t xml:space="preserve">${headerText}</w:t></w:r><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:hdr>`;

        const files = [
            ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${o.header ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ''}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
            ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
            ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(title)}</dc:title><dc:creator>${xmlEsc(o.byline || o.authorName || '')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`],
            ['word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${o.header ? '<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' : ''}</Relationships>`],
            ['word/document.xml', documentXml],
            ['word/styles.xml', stylesXml]
        ];
        if (o.header) files.push(['word/header1.xml', headerXml]);
        return zipStore(files);
    }

    // Minimal ZIP writer (stored, no compression) — enough for .docx
    const CRC_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
        return t;
    })();
    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    function zipStore(files) {
        const enc = new TextEncoder();
        const chunks = [], central = [];
        let offset = 0;
        const d = new Date();
        const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
        const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
        files.forEach(([name, content]) => {
            const nameBytes = enc.encode(name), data = enc.encode(content), crc = crc32(data);
            const local = new DataView(new ArrayBuffer(30));
            local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
            local.setUint16(8, 0, true); local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true);
            local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
            local.setUint16(26, nameBytes.length, true); local.setUint16(28, 0, true);
            chunks.push(new Uint8Array(local.buffer), nameBytes, data);
            const cen = new DataView(new ArrayBuffer(46));
            cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
            cen.setUint16(10, 0, true); cen.setUint16(12, dosTime, true); cen.setUint16(14, dosDate, true);
            cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
            cen.setUint16(28, nameBytes.length, true); cen.setUint16(30, 0, true); cen.setUint16(32, 0, true);
            cen.setUint16(34, 0, true); cen.setUint16(36, 0, true); cen.setUint32(38, 0, true); cen.setUint32(42, offset, true);
            central.push(new Uint8Array(cen.buffer), nameBytes);
            offset += 30 + nameBytes.length + data.length;
        });
        const cenSize = central.reduce((s, c) => s + c.length, 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
        end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
        return new Blob([...chunks, ...central, new Uint8Array(end.buffer)],
            { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    }

    // ── RTF ──────────────────────────────────────────────────────────────────
    function rtfEsc(text) {
        let out = '';
        for (const ch of String(text)) {
            const cp = ch.codePointAt(0);
            if (ch === '\\') out += '\\\\';
            else if (ch === '{') out += '\\{';
            else if (ch === '}') out += '\\}';
            else if (cp < 128) out += ch;
            else if (cp < 0x10000) out += '\\u' + (cp > 32767 ? cp - 65536 : cp) + '?';
            else {
                // Characters outside the basic plane (e.g. emoji) as a surrogate pair
                const hi = 0xD800 + ((cp - 0x10000) >> 10), lo = 0xDC00 + ((cp - 0x10000) & 0x3FF);
                out += '\\u' + (hi - 65536) + '?\\u' + (lo - 65536) + '?';
            }
        }
        return out;
    }
    function rtfRuns(runs) {
        return runs.map(r => {
            if (r.br) return '\\line ';
            const on = (r.b ? '\\b' : '') + (r.i ? '\\i' : '') + (r.u ? '\\ul' : '');
            return on ? `{${on} ${rtfEsc(r.text)}}` : rtfEsc(r.text);
        }).join('');
    }
    function buildRtf(title, chapters, o) {
        const half = o.size * 2, line = Math.round(240 * o.spacing);
        const A4 = o.pageSize === 'A4';
        const block = o.paraStyle === 'block';
        const after = block ? half * 10 : 0;
        const base = `\\pard\\plain\\f0\\fs${half}\\sl${line}\\slmult1`;
        const p = [];
        p.push('{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1');
        p.push(`{\\fonttbl{\\f0\\fnil\\fcharset0 ${rtfEsc(o.font)};}}`);
        p.push(`\\paperw${A4 ? 11906 : 12240}\\paperh${A4 ? 16838 : 15840}\\margl1440\\margr1440\\margt1440\\margb1440`);
        if (o.titlePage) p.push('\\titlepg');
        if (o.header) {
            p.push(`{\\header\\pard\\plain\\qr\\f0\\fs${half} ${surnameFor(o) ? rtfEsc(surnameFor(o)) + ' / ' : ''}${rtfEsc(shortTitle(title))} / \\chpgn\\par}`);
            if (o.titlePage) p.push('{\\headerf\\pard\\plain\\par}');
        }
        if (o.titlePage) {
            const by = (o.byline || o.authorName).trim();
            if (o.header) {
                const textW = (A4 ? 11906 : 12240) - 2880;
                p.push(`\\pard\\plain\\f0\\fs${half}\\tqr\\tx${textW} ${rtfEsc(o.authorName.trim())}\\tab ${rtfEsc(roundedWords(wordCountFor(chapters)))}\\par`);
                (o.contact || '').split('\n').map(s => s.trim()).filter(Boolean).forEach(l => p.push(`\\pard\\plain\\f0\\fs${half} ${rtfEsc(l)}\\par`));
                p.push(`\\pard\\plain\\f0\\fs${half}\\qc\\sb4320 ${rtfEsc(title.toUpperCase())}\\par`);
                if (by) p.push(`\\pard\\plain\\f0\\fs${half}\\qc\\sb240 by ${rtfEsc(by)}\\par`);
            } else {
                p.push(`\\pard\\plain\\f0\\fs${half + 12}\\qc\\sb4320\\b ${rtfEsc(title)}\\par`);
                if (by) p.push(`\\pard\\plain\\f0\\fs${half}\\qc\\sb240 ${rtfEsc(by)}\\par`);
            }
        }
        buildDoc(chapters, o).forEach(it => {
            if (it.type === 'chapter') {
                const brk = (o.newPage && (o.titlePage || !it.first)) ? '\\pagebb' : '';
                p.push(`\\pard\\plain\\f0\\fs${half}${brk}\\qc\\keepn\\sb${o.header ? 2880 : 1440}\\sa${o.header ? 480 : 720}${o.header ? '' : '\\b'} ${rtfEsc(it.text)}\\par`);
            } else if (it.type === 'heading') {
                p.push(`${base}\\keepn\\sb${line} {\\b ${rtfRuns(it.runs)}}\\par`);
            } else if (it.type === 'sceneBreak') {
                p.push(`${base}\\qc\\keepn #\\par`);
            } else if (it.type === 'blank') {
                p.push(`${base}\\par`);
            } else {
                p.push(`${base}\\fi${paraIndented(it, o) ? 720 : 0}\\sa${after} ${rtfRuns(it.runs)}\\par`);
            }
        });
        p.push('}');
        return new Blob([p.join('\n')], { type: 'application/rtf' });
    }

    // ── PDF (print-ready page, saved through the browser's print dialog) ─────
    function htmlEsc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function htmlRuns(runs) {
        return runs.map(r => {
            if (r.br) return '<br>';
            let t = htmlEsc(r.text);
            if (r.u) t = '<u>' + t + '</u>';
            if (r.i) t = '<em>' + t + '</em>';
            if (r.b) t = '<strong>' + t + '</strong>';
            return t;
        }).join('');
    }
    function buildPrintHtml(title, chapters, o) {
        const block = o.paraStyle === 'block';
        let body = '';
        if (o.titlePage) {
            const by = (o.byline || o.authorName).trim();
            body += '<section class="titlepage">';
            if (o.header) {
                body += `<div class="tp-top"><div>${htmlEsc(o.authorName.trim())}${(o.contact || '').split('\n').map(s => s.trim()).filter(Boolean).map(l => '<br>' + htmlEsc(l)).join('')}</div><div>${htmlEsc(roundedWords(wordCountFor(chapters)))}</div></div>`;
                body += `<div class="tp-title">${htmlEsc(title.toUpperCase())}</div>${by ? `<div class="tp-by">by ${htmlEsc(by)}</div>` : ''}`;
            } else {
                body += `<div class="tp-title big">${htmlEsc(title)}</div>${by ? `<div class="tp-by">${htmlEsc(by)}</div>` : ''}`;
            }
            body += '</section>';
        }
        buildDoc(chapters, o).forEach(it => {
            if (it.type === 'chapter') {
                const brk = (o.newPage && (o.titlePage || !it.first)) ? ' newpage' : '';
                body += `<h2 class="chapter${brk}">${htmlEsc(it.text)}</h2>`;
            } else if (it.type === 'heading') body += `<p class="scene-heading">${htmlRuns(it.runs)}</p>`;
            else if (it.type === 'sceneBreak') body += '<p class="scene-break">#</p>';
            else if (it.type === 'blank') body += '<p class="blank">&nbsp;</p>';
            else body += `<p class="${paraIndented(it, o) ? 'ind' : 'flush'}">${htmlRuns(it.runs)}</p>`;
        });
        const headerText = `${surnameFor(o) ? surnameFor(o) + ' / ' : ''}${shortTitle(title)} / `;
        const fontStack = `"${o.font}", ${/courier/i.test(o.font) ? 'monospace' : /arial|helvetica/i.test(o.font) ? 'sans-serif' : 'serif'}`;
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEsc(title)}</title>
<style>
@page { size: ${o.pageSize === 'A4' ? 'A4' : 'letter'}; margin: 1in;
  ${o.header ? `@top-right { content: "${headerText.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" counter(page); font-family: ${fontStack}; font-size: ${o.size}pt; }` : ''} }
${o.header && o.titlePage ? '@page :first { @top-right { content: none; } }' : ''}
html { background: #888; }
body { font-family: ${fontStack}; font-size: ${o.size}pt; line-height: ${o.spacing * 1.15}; color: #000; background: #fff;
  max-width: 6.27in; margin: 20px auto; padding: 1in; box-sizing: content-box; }
p { margin: 0 0 ${block ? '1em' : '0'}; orphans: 2; widows: 2; }
p.ind { text-indent: 0.5in; }
p.flush { text-indent: 0; }
.chapter { font-size: 1em; font-weight: ${o.header ? 'normal' : 'bold'}; text-align: center; margin: ${o.header ? '2in' : '1in'} 0 ${o.header ? '0.33in' : '0.5in'}; break-after: avoid; }
.newpage { break-before: page; }
.scene-heading { font-weight: bold; margin-top: 1em; break-after: avoid; }
.scene-break { text-align: center; break-after: avoid; }
.titlepage { height: 9in; position: relative; line-height: 1.2; }
.tp-top { display: flex; justify-content: space-between; }
.tp-title { text-align: center; margin-top: 3in; }
.tp-title.big { font-size: 1.6em; font-weight: bold; }
.tp-by { text-align: center; margin-top: 1em; }
.bar { position: sticky; top: 0; background: #111; color: #fff; font: 14px system-ui, sans-serif; padding: 10px; text-align: center; margin: -20px auto 20px; max-width: 8.27in; }
.bar button { font: inherit; padding: 8px 14px; margin-left: 10px; cursor: pointer; }
@media print { html { background: none; } body { max-width: none; margin: 0; padding: 0; } .bar { display: none; } }
@media (max-width: 700px) { body { padding: 0.5in 0.4in; margin: 0; } .titlepage { height: auto; min-height: 60vh; } }
</style></head><body>
<div class="bar">Choose "Save as PDF" in the print dialog. <button onclick="window.print()">PRINT / SAVE AS PDF</button></div>
${body}
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 400); });<\/script>
</body></html>`;
    }

    // ── Download helpers ─────────────────────────────────────────────────────
    function fileBase(title) {
        return (title.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase() || 'story');
    }
    function download(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    // ── Dialog ───────────────────────────────────────────────────────────────
    function chaptersSorted() {
        return (window.getExportChapters ? window.getExportChapters() : [])
            .slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    function openDialog() {
        const chapters = chaptersSorted();
        if (!chapters.length) { alert('No chapters to export.'); return; }
        const o = loadPrefs();
        const { title } = projectInfo();

        let ov = document.getElementById('exportOverlay');
        if (!ov) { ov = document.createElement('div'); ov.id = 'exportOverlay'; ov.className = 'export-overlay'; document.body.appendChild(ov); }

        const opt = (name, value, label, cur) =>
            `<label class="exp-chip"><input type="radio" name="${name}" value="${value}"${String(cur) === String(value) ? ' checked' : ''}><span>${label}</span></label>`;
        const sel = (id, options, cur) =>
            `<select id="${id}">${options.map(([v, l]) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;

        ov.innerHTML = `
        <div class="export-box" role="dialog" aria-modal="true" aria-labelledby="expTitle">
            <div class="exp-head"><h2 id="expTitle">EXPORT</h2><button class="exp-x" id="expClose" aria-label="Close">✕</button></div>

            <div class="exp-sec"><div class="exp-label">FORMAT</div>
                <div class="exp-chips">
                    ${opt('expFormat', 'docx', 'WORD (.docx)', o.format)}
                    ${opt('expFormat', 'pdf', 'PDF', o.format)}
                    ${opt('expFormat', 'rtf', 'RTF', o.format)}
                </div>
                <p class="exp-note" id="expFormatNote"></p>
            </div>

            <div class="exp-sec"><div class="exp-label">CHAPTERS <span class="exp-links"><button type="button" id="expAll">ALL</button> · <button type="button" id="expNone">NONE</button></span></div>
                <div class="exp-chapters">
                    ${chapters.map(c => `<label class="exp-ch"><input type="checkbox" value="${c.id}" checked><span>${htmlEsc(c.title || 'Untitled')}</span><em>${(c.wordCount || 0).toLocaleString()}</em></label>`).join('')}
                </div>
            </div>

            <div class="exp-sec"><div class="exp-label">LAYOUT</div>
                <div class="exp-chips">
                    ${opt('expPreset', 'manuscript', 'MANUSCRIPT', o.preset)}
                    ${opt('expPreset', 'reading', 'READING COPY', o.preset)}
                    ${opt('expPreset', 'custom', 'CUSTOM', o.preset)}
                </div>
                <p class="exp-note" id="expPresetNote"></p>
                <div id="expCustom" class="exp-grid">
                    <label>FONT ${sel('expFont', [['Times New Roman', 'Times New Roman'], ['Georgia', 'Georgia'], ['Garamond', 'Garamond'], ['Courier New', 'Courier New'], ['Arial', 'Arial']], o.font)}</label>
                    <label>SIZE ${sel('expSize', [[10, '10pt'], [11, '11pt'], [12, '12pt'], [13, '13pt'], [14, '14pt']], o.size)}</label>
                    <label>LINE SPACING ${sel('expSpacing', [[1, 'Single'], [1.15, '1.15'], [1.5, '1.5'], [2, 'Double']], o.spacing)}</label>
                    <label>PARAGRAPHS ${sel('expPara', [['indent', 'Indented'], ['block', 'Space between']], o.paraStyle)}</label>
                    <label class="exp-check"><input type="checkbox" id="expHeader"${o.header ? ' checked' : ''}> Page header (name / title / page)</label>
                    <label class="exp-check"><input type="checkbox" id="expNewPage"${o.newPage ? ' checked' : ''}> Each chapter on a new page</label>
                </div>
            </div>

            <div class="exp-sec"><div class="exp-label">CHAPTERS AND SCENES</div>
                <div class="exp-grid">
                    <label>CHAPTER TITLES ${sel('expChTitles', [['asWritten', 'As written'], ['words', 'Chapter One, Two…'], ['digits', 'Chapter 1, 2…'], ['wordsTitle', 'Chapter One: your title']], o.chapterTitles)}</label>
                    <label>SCENE HEADINGS ${sel('expScenes', [['keep', 'Keep as written'], ['break', 'Replace with #'], ['remove', 'Remove']], o.sceneHeadings)}</label>
                    <label>OPENING PARAGRAPHS ${sel('expFirst', [['indent', 'Indented'], ['flush', 'Not indented']], o.firstPara)}</label>
                    <label>PAGE SIZE ${sel('expPage', [['A4', 'A4'], ['Letter', 'US Letter']], o.pageSize)}</label>
                </div>
                <p class="exp-note">Opening paragraphs are the first after a chapter title or scene heading.</p>
            </div>

            <div class="exp-sec"><div class="exp-label">TITLE PAGE</div>
                <label class="exp-check"><input type="checkbox" id="expTitlePage"${o.titlePage ? ' checked' : ''}> Include a title page</label>
                <div id="expTitleFields" class="exp-grid">
                    <label>YOUR NAME <input type="text" id="expName" value="${htmlEsc(o.authorName)}" autocomplete="name"></label>
                    <label>BYLINE (IF DIFFERENT) <input type="text" id="expByline" value="${htmlEsc(o.byline)}" placeholder="Pen name"></label>
                    <label class="exp-wide">CONTACT DETAILS <textarea id="expContact" rows="3" placeholder="Email, phone, address — one per line">${htmlEsc(o.contact)}</textarea></label>
                    <label>SURNAME FOR HEADER <input type="text" id="expSurname" value="${htmlEsc(o.surname)}" placeholder="From your name"></label>
                </div>
                <p class="exp-note">Your name and contact details are saved on this device only.</p>
            </div>

            <div class="exp-foot">
                <span id="expSummary" class="exp-note"></span>
                <button id="expGo">⬇ EXPORT</button>
            </div>
        </div>`;
        ov.style.display = 'flex';

        const $ = id => document.getElementById(id);
        const read = () => ({
            format: ov.querySelector('input[name=expFormat]:checked').value,
            preset: ov.querySelector('input[name=expPreset]:checked').value,
            font: $('expFont').value, size: Number($('expSize').value), spacing: Number($('expSpacing').value),
            paraStyle: $('expPara').value, header: $('expHeader').checked, newPage: $('expNewPage').checked,
            chapterTitles: $('expChTitles').value, sceneHeadings: $('expScenes').value, firstPara: $('expFirst').value,
            pageSize: $('expPage').value, titlePage: $('expTitlePage').checked,
            authorName: $('expName').value, byline: $('expByline').value, contact: $('expContact').value, surname: $('expSurname').value
        });
        const selected = () => [...ov.querySelectorAll('.exp-ch input:checked')].map(i => i.value);

        function refresh() {
            const cur = read();
            const notes = {
                docx: 'Opens in Word, Google Docs, Pages and LibreOffice.',
                pdf: 'Opens a print-ready page — choose "Save as PDF" in the print dialog.',
                rtf: 'Opens in most word processors.'
            };
            $('expFormatNote').textContent = notes[cur.format];
            const pn = {
                manuscript: 'Standard submission format: Times New Roman 12pt, double spaced, 1-inch margins, indented paragraphs, chapters on new pages, name / title / page in the header.',
                reading: 'For reading: Georgia 11pt, 1.15 spacing, indented paragraphs, chapters on new pages, no header.',
                custom: ''
            };
            $('expPresetNote').textContent = pn[cur.preset];
            $('expCustom').style.display = cur.preset === 'custom' ? '' : 'none';
            if (cur.preset !== 'custom') {
                const pr = PRESETS[cur.preset];
                $('expFont').value = pr.font; $('expSize').value = pr.size; $('expSpacing').value = pr.spacing;
                $('expPara').value = pr.paraStyle; $('expHeader').checked = pr.header; $('expNewPage').checked = pr.newPage;
            }
            $('expTitleFields').style.display = cur.titlePage ? '' : 'none';
            const ids = selected();
            const words = chapters.filter(c => ids.includes(c.id)).reduce((s, c) => s + (c.wordCount || 0), 0);
            $('expSummary').textContent = `${ids.length} of ${chapters.length} chapters · ${words.toLocaleString()} words`;
            $('expGo').disabled = !ids.length;
        }
        ov.querySelectorAll('input, select, textarea').forEach(el => el.addEventListener('change', refresh));
        ov.querySelectorAll('input[name=expPreset]').forEach(r => r.addEventListener('change', () => {
            // Picking a preset sets its title-page default; the writer can still untick it
            const pr = PRESETS[r.value];
            if (pr) $('expTitlePage').checked = pr.titlePage;
            refresh();
        }));
        $('expAll').onclick  = () => { ov.querySelectorAll('.exp-ch input').forEach(i => i.checked = true);  refresh(); };
        $('expNone').onclick = () => { ov.querySelectorAll('.exp-ch input').forEach(i => i.checked = false); refresh(); };
        const close = () => { ov.style.display = 'none'; };
        $('expClose').onclick = close;
        ov.onclick = e => { if (e.target === ov) close(); };
        document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });

        $('expGo').onclick = () => {
            const raw = read();
            savePrefs(raw);
            const eo = effective(raw);
            const ids = selected();
            const chosen = chapters.filter(c => ids.includes(c.id));
            const base = fileBase(title) + (chosen.length < chapters.length && chosen.length === 1 ? '_' + fileBase(chosen[0].title || 'chapter') : '');
            try {
                if (eo.format === 'docx') {
                    download(buildDocx(title, chosen, eo), base + '.docx');
                } else if (eo.format === 'rtf') {
                    download(buildRtf(title, chosen, eo), base + '.rtf');
                } else {
                    const html = buildPrintHtml(title, chosen, eo);
                    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
                    const w = window.open(url, '_blank');
                    if (!w) { download(new Blob([html], { type: 'text/html' }), base + '_print.html'); }
                    setTimeout(() => URL.revokeObjectURL(url), 60000);
                }
                close();
            } catch (err) {
                console.error('Export failed:', err);
                alert('Sorry — the export failed. Your chapters are unaffected.');
            }
        };
        refresh();
    }

    window.exportStory = openDialog;
    window.DPExport = { parseChapter, buildDoc, buildDocx, buildRtf, buildPrintHtml, effective, PRESETS, DEFAULTS };
})();
