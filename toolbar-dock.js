// ── Toolbar that stays within reach ───────────────────────────────────────────
// 1. Everywhere: each open chapter's toolbar stays pinned below the top bar as
//    you scroll through a long chapter (CSS position: sticky; the top offset is
//    the fixed nav's live height).
// 2. Phones and tablets, while typing: the editing row (undo/redo, bold,
//    italic, underline, heading, clear formatting) docks just above the
//    on-screen keyboard, like iOS Notes, and follows it as the keyboard opens,
//    closes or the page scrolls. A placeholder keeps its usual space so the
//    text doesn't jump, and the page scrolls if the caret would end up hidden
//    under the docked row.
// Purely visual: the row's buttons are the same elements, moved, so they keep
// working exactly as before. Nothing about chapters or saving is touched.
(function () {
    const touch = window.matchMedia('(pointer: coarse)').matches;

    // ── Sticky offset: height of the fixed nav bar ────────────────────────────
    function setNavHeight() {
        const nav = document.querySelector('.app-nav');
        const h = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().height : 0;
        document.documentElement.style.setProperty('--nav-h', Math.round(h) + 'px');
    }
    window.addEventListener('resize', setNavHeight);
    document.addEventListener('DOMContentLoaded', setNavHeight);
    window.addEventListener('load', setNavHeight);

    if (!touch) return;

    // ── Dock above the keyboard ───────────────────────────────────────────────
    let dock = null, row = null, home = null, holder = null, editor = null;

    function dockEl() {
        if (!dock) {
            dock = document.createElement('div');
            dock.className = 'tb-dock';
            dock.setAttribute('role', 'toolbar');
            dock.setAttribute('aria-label', 'Formatting');
            document.body.appendChild(dock);
        }
        return dock;
    }

    function place() {
        if (!row || !dock) return;
        const vv = window.visualViewport;
        const h = dock.offsetHeight;
        const top = vv ? vv.offsetTop + vv.height - h : window.innerHeight - h;
        dock.style.top = Math.max(0, Math.round(top)) + 'px';
        keepCaretVisible();
    }

    // Scroll so the caret isn't hidden under the docked row
    function keepCaretVisible() {
        if (!row || !editor) return;
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (!editor.contains(range.startContainer)) return;
        let rect = range.getBoundingClientRect();
        if (!rect || (!rect.top && !rect.bottom)) {
            const el = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
            rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        }
        if (!rect) return;
        const vv = window.visualViewport;
        const dockTop = dock.getBoundingClientRect().top;
        const overlap = rect.bottom + 12 - dockTop;
        if (overlap > 0) {
            const scroller = editor.scrollHeight > editor.clientHeight + 1 ? editor : null;
            if (scroller) scroller.scrollTop += overlap; else window.scrollBy(0, overlap);
        }
    }

    function dockFor(ed) {
        const body = ed.closest('.write-chapter-body');
        const r = body && body.querySelector('.write-tb-row-edit');
        if (!r || r === row) { place(); return; }
        undock();
        editor = ed; row = r; home = r.parentNode;
        holder = document.createElement('div');
        holder.className = 'tb-dock-holder';
        holder.style.height = r.offsetHeight + 'px';
        home.insertBefore(holder, r);
        dockEl().appendChild(r);
        document.body.classList.add('tb-docked');
        dock.style.display = '';
        document.documentElement.style.setProperty('--dock-h', dock.offsetHeight + 'px');
        place();
    }

    function undock() {
        if (!row) return;
        if (holder && holder.parentNode && document.body.contains(holder)) holder.parentNode.replaceChild(row, holder);
        else row.remove();   // its chapter was re-rendered; the new toolbar has its own row
        row = home = holder = editor = null;
        document.body.classList.remove('tb-docked');
        if (dock) dock.style.display = 'none';
    }

    document.addEventListener('focusin', e => {
        const ed = e.target && e.target.closest && e.target.closest('.write-area');
        if (ed && !ed.classList.contains('ver-read')) dockFor(ed);
    });
    document.addEventListener('focusout', () => {
        // Toolbar buttons keep focus in the editor, so a real blur means done
        setTimeout(() => {
            const a = document.activeElement;
            if (!(a && a.closest && a.closest('.write-area'))) undock();
        }, 120);
    });
    // The chapter list is rebuilt at times (adding/moving chapters, SYNC); when
    // that happens, drop the old row and dock the new one if still typing
    document.addEventListener('DOMContentLoaded', () => {
        const list = document.getElementById('writeChapterList');
        if (!list) return;
        new MutationObserver(() => {
            if (!row || document.body.contains(holder)) return;
            undock();
            const a = document.activeElement;
            if (a && a.closest && a.closest('.write-area')) dockFor(a.closest('.write-area'));
        }).observe(list, { childList: true });
    });

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', place);
        window.visualViewport.addEventListener('scroll', place);
    }
    window.addEventListener('scroll', () => { if (row) place(); }, { passive: true });
    document.addEventListener('selectionchange', () => { if (row) keepCaretVisible(); });
    document.addEventListener('input', e => { if (row && e.target.closest && e.target.closest('.write-area')) keepCaretVisible(); }, true);

    window.DPToolbarDock = { isDocked: () => !!row, _place: place };
})();
