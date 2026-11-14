// ── Friend picker ─────────────────────────────────────────────────────────────
// Search-to-add picker for choosing friends (works with a handful or hundreds).
// Type to filter, choose from up to 8 matches, chosen friends appear as chips
// that can be removed. Keyboard: ↑/↓ to move, Enter to add, Backspace on an
// empty box removes the last chip, Escape closes the matches.
//
//   const picker = createFriendPicker(containerEl, {
//       friends: [{ uid, username }], exclude: [uids], max: 11, onChange(selected) {}
//   });
//   picker.getSelected()  -> [{ uid, username }]
//   picker.setFriends(friends, exclude); picker.reset();
(function () {
    const SHOW = 8;
    let uidSeq = 0;
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    window.createFriendPicker = function (container, opts) {
        opts = opts || {};
        let friends  = (opts.friends || []).slice();
        let exclude  = new Set(opts.exclude || []);
        const max    = opts.max || 11;
        let selected = [];
        let active   = -1;
        let matches  = [];
        const id = 'fp' + (++uidSeq);

        container.classList.add('fp');
        container.innerHTML = `
            <div class="fp-chips" id="${id}-chips"></div>
            <input type="text" class="fp-input" id="${id}-input" autocomplete="off"
                placeholder="Type a friend's name…" role="combobox" aria-expanded="false"
                aria-controls="${id}-list" aria-autocomplete="list">
            <div class="fp-list" id="${id}-list" role="listbox" hidden></div>
            <div class="fp-note" id="${id}-note" aria-live="polite"></div>`;
        const input = container.querySelector('.fp-input');
        const list  = container.querySelector('.fp-list');
        const chips = container.querySelector('.fp-chips');
        const note  = container.querySelector('.fp-note');

        function available() {
            const chosen = new Set(selected.map(s => s.uid));
            return friends.filter(f => !exclude.has(f.uid) && !chosen.has(f.uid));
        }

        function renderChips() {
            chips.innerHTML = selected.map((f, i) =>
                `<span class="fp-chip">${esc(f.username)}<button type="button" data-i="${i}" aria-label="Remove ${esc(f.username)}">✕</button></span>`).join('');
            chips.querySelectorAll('button').forEach(b => b.onclick = () => { remove(Number(b.dataset.i)); input.focus(); });
            const full = selected.length >= max;
            input.disabled = full;
            input.placeholder = full ? `That's the most (${max})` : (selected.length ? 'Add another…' : "Type a friend's name…");
            note.textContent = selected.length ? `${selected.length} chosen · up to ${max}` : '';
            if (opts.onChange) opts.onChange(selected.slice());
        }

        function renderList(show) {
            const q = input.value.trim().toLowerCase();
            const pool = available();
            if (!friends.length) {
                list.innerHTML = '<div class="fp-empty">No friends yet — add friends first.</div>';
            } else if (!pool.length) {
                list.innerHTML = '<div class="fp-empty">Everyone\'s already chosen.</div>';
            }
            matches = (q ? pool.filter(f => String(f.username).toLowerCase().includes(q)) : pool)
                .sort((a, b) => {
                    const as = String(a.username).toLowerCase().startsWith(q), bs = String(b.username).toLowerCase().startsWith(q);
                    return as === bs ? String(a.username).localeCompare(String(b.username)) : (as ? -1 : 1);
                });
            if (friends.length && pool.length) {
                const shown = matches.slice(0, SHOW);
                if (active >= shown.length) active = shown.length - 1;
                list.innerHTML = shown.length
                    ? shown.map((f, i) => `<button type="button" role="option" class="fp-opt${i === active ? ' active' : ''}" aria-selected="${i === active}" data-i="${i}">${esc(f.username)}</button>`).join('')
                      + (matches.length > SHOW ? `<div class="fp-more">${matches.length - SHOW} more — keep typing to narrow down</div>` : '')
                    : `<div class="fp-empty">No friend called "${esc(input.value.trim())}"</div>`;
                list.querySelectorAll('.fp-opt').forEach(b => {
                    b.onmousedown = e => e.preventDefault();   // keep focus in the box
                    b.onclick = () => add(matches[Number(b.dataset.i)]);
                });
            }
            const open = show !== false && !input.disabled;
            list.hidden = !open;
            input.setAttribute('aria-expanded', String(open));
        }

        function add(f) {
            if (!f || selected.length >= max) return;
            selected.push(f);
            input.value = ''; active = -1;
            renderChips(); renderList();
            input.focus();
        }
        function remove(i) { selected.splice(i, 1); renderChips(); renderList(document.activeElement === input); }

        input.addEventListener('focus', () => renderList());
        input.addEventListener('input', () => { active = 0; renderList(); });
        input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) renderList(false); }, 150));
        input.addEventListener('keydown', e => {
            const shown = Math.min(matches.length, SHOW);
            if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(shown - 1, active + 1); renderList(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); renderList(); }
            else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0 && matches[active]) add(matches[active]); }
            else if (e.key === 'Escape') { renderList(false); }
            else if (e.key === 'Backspace' && !input.value && selected.length) { remove(selected.length - 1); }
        });

        renderChips();
        list.hidden = true;

        return {
            getSelected: () => selected.slice(),
            setFriends(newFriends, newExclude) {
                friends = (newFriends || []).slice();
                if (newExclude) exclude = new Set(newExclude);
                selected = selected.filter(s => friends.some(f => f.uid === s.uid) && !exclude.has(s.uid));
                renderChips();
                if (!list.hidden) renderList();
            },
            reset() { selected = []; input.value = ''; active = -1; renderChips(); list.hidden = true; },
            focus() { input.focus(); }
        };
    };
})();
