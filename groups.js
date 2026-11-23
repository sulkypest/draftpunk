(function() { const _dp = JSON.parse(localStorage.getItem('draftPunkData') || '{}'); const _ok = _dp.activeProjectId && _dp.projects && _dp.projects[_dp.activeProjectId] && _dp.projects[_dp.activeProjectId].active; if (!_ok) window.location.replace('index.html'); })();

// ── Safe output ───────────────────────────────────────────────────────────────
// Names, titles and shared chapters come from other writers, so everything is
// escaped, and shared chapter text is reduced to the editor's own formatting.
function esc(str) {
    return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const SAFE_TAGS = new Set(['B','STRONG','I','EM','U','H2','H3','P','BR','DIV']);
function safeChapterHtml(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html || '');
    const clean = node => {
        [...node.childNodes].forEach(n => {
            if (n.nodeType === 1) {
                if (!SAFE_TAGS.has(n.tagName)) {
                    if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|TEMPLATE|SVG|MATH)$/.test(n.tagName)) { n.remove(); return; }
                    clean(n);
                    n.replaceWith(...n.childNodes);
                    return;
                }
                [...n.attributes].forEach(a => n.removeAttribute(a.name));
                clean(n);
            } else if (n.nodeType !== 3) n.remove();
        });
    };
    clean(tpl.content);
    const div = document.createElement('div'); div.appendChild(tpl.content);
    return div.innerHTML;
}

// ── Auth handling ─────────────────────────────────────────────────────────────
function handleAuthState(user) {
    if (!user) {
        document.getElementById('groupsSignInGate').style.display = 'block';
        document.getElementById('groupsContent').style.display    = 'none';
    } else {
        document.getElementById('groupsSignInGate').style.display = 'none';
        document.getElementById('groupsContent').style.display    = 'block';
        loadAll();
    }
}

// React to auth state dispatched by sync.js
document.addEventListener('dpAuthChanged', function(e) {
    handleAuthState(e.detail.user);
});

// Fallback: if auth already resolved before this listener registered
document.addEventListener('DOMContentLoaded', function() {
    const user = window.getCurrentUser && window.getCurrentUser();
    if (user !== undefined) handleAuthState(user);
});

// ── Load everything ───────────────────────────────────────────────────────────
function loadAll() {
    loadPendingRequests();
    loadFriends();
    loadSharedWithMe();
    loadLeaderboard();
    loadMyGroups();
}

// ── My groups: word counts per group ─────────────────────────────────────────
let groupPeriod = 'week';
let _myGroups = [];
const _groupStats = {};

window.setGroupPeriod = function(period) {
    groupPeriod = period;
    document.querySelectorAll('.grp-period-btn').forEach(b => b.classList.toggle('lb-period-active', b.dataset.gperiod === period));
    renderMyGroups();
};

async function loadMyGroups() {
    const container = document.getElementById('myGroupsList');
    if (!container || !window.getMyGroups) return;
    container.innerHTML = '<div class="lb-loading">LOADING...</div>';
    const groups = await window.getMyGroups();
    if (!Array.isArray(groups)) { container.innerHTML = '<div class="lb-empty">COULD NOT LOAD GROUPS</div>'; return; }
    _myGroups = groups.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    await Promise.all(_myGroups.map(async g => { _groupStats[g.id] = await window.getGroupStats(g); }));
    renderMyGroups();
}

function renderMyGroups() {
    const container = document.getElementById('myGroupsList');
    if (!container) return;
    if (!_myGroups.length) {
        container.innerHTML = '<div class="lb-empty">YOU\'RE NOT IN ANY GROUPS YET — USE ＋ NEW GROUP TO START ONE WITH YOUR FRIENDS</div>';
        return;
    }
    const field = PERIOD_FIELD[groupPeriod] || 'totalWords';
    const me = window.getCurrentUser && window.getCurrentUser();
    container.innerHTML = _myGroups.map(g => {
        const rows = (_groupStats[g.id] || []).slice().sort((a, b) => (b[field] || 0) - (a[field] || 0));
        const total = rows.reduce((s, r) => s + (r[field] || 0), 0);
        return `<div class="grp-card" data-id="${esc(g.id)}">
            <div class="grp-head">
                <span class="grp-name">${esc(g.name)}</span>
                <span class="grp-total">${total.toLocaleString()} WDS TOGETHER</span>
                <a class="grp-chat" href="messages.html#group=${encodeURIComponent(g.id)}">OPEN CHAT</a>
            </div>
            ${rows.map((r, i) => `<div class="lb-row ${me && r.uid === me.uid ? 'lb-row-me' : ''}">
                <span class="lb-rank">#${i + 1}</span>
                <span class="lb-name">${esc(r.username)}</span>
                <span class="lb-words">${(r[field] || 0).toLocaleString()} WDS</span>
            </div>`).join('')}
        </div>`;
    }).join('');
}

// ── Pending friend requests ───────────────────────────────────────────────────
async function loadPendingRequests() {
    const section   = document.getElementById('pendingRequestsSection');
    const container = document.getElementById('pendingRequestsList');
    if (!section || !container) return;

    const result = await window.getPendingRequests();

    if (!result || result.error || result.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    container.innerHTML = result.map(req => `
        <div class="lb-row" style="gap:8px;">
            <span class="lb-name" style="flex:1;">${esc(req.fromUsername || 'UNKNOWN')}</span>
            <button data-id="${esc(req.id)}" data-from="${esc(req.from)}" onclick="doAccept(this.dataset.id, this.dataset.from)"
                style="font-size:0.75rem;padding:6px 10px;letter-spacing:1px;white-space:nowrap;">
                ✓ ACCEPT
            </button>
            <button class="btn-secondary" data-id="${esc(req.id)}" onclick="doDecline(this.dataset.id)"
                style="font-size:0.75rem;padding:6px 10px;letter-spacing:1px;white-space:nowrap;">
                ✕ DECLINE
            </button>
            <button class="btn-secondary" data-from="${esc(req.from)}" data-name="${esc(req.fromUsername || '')}" onclick="openReportDialog({type:'friendRequest', uid:this.dataset.from, username:this.dataset.name})"
                title="Report or block" aria-label="Report or block ${esc(req.fromUsername || '')}"
                style="font-size:0.75rem;padding:6px 10px;letter-spacing:1px;white-space:nowrap;min-width:unset;width:auto;">⚑</button>
        </div>
    `).join('');

    window.updateRequestBadge(result.length);
}

window.doAccept = async function(requestId, fromUid) {
    const result = await window.acceptFriendRequest(requestId, fromUid);
    if (result.success) {
        loadPendingRequests();
        loadFriends();
    } else {
        alert(result.error || 'Could not accept request.');
    }
};

window.doDecline = async function(requestId) {
    const result = await window.declineFriendRequest(requestId);
    if (result.success) loadPendingRequests();
};

// ── Leaderboard ───────────────────────────────────────────────────────────────
const PERIOD_FIELD = {
    week:  'wordsThisWeek',
    month: 'wordsThisMonth',
    year:  'wordsThisYear',
    all:   'totalWords'
};
let currentPeriod = 'week';

window.setLeaderboardPeriod = function(period) {
    currentPeriod = period;
    document.querySelectorAll('.lb-period-btn').forEach(btn => {
        btn.classList.toggle('lb-period-active', btn.dataset.period === period);
    });
    loadLeaderboard();
};

async function loadLeaderboard() {
    const container = document.getElementById('leaderboardList');
    if (!container) return;
    container.innerHTML = '<div class="lb-loading">LOADING...</div>';

    const field  = PERIOD_FIELD[currentPeriod] || 'totalWords';
    const result = await window.getLeaderboard(field);

    if (!result || result.error) {
        container.innerHTML = '<div class="lb-empty">COULD NOT LOAD LEADERBOARD</div>';
        return;
    }

    const active = result.filter(u => (u[field] || 0) > 0);
    if (active.length === 0) {
        container.innerHTML = '<div class="lb-empty">NO ENTRIES FOR THIS PERIOD YET</div>';
        return;
    }

    const currentUser = window.getCurrentUser();
    container.innerHTML = active.map((u, i) => `
        <div class="lb-row ${currentUser && u.uid === currentUser.uid ? 'lb-row-me' : ''}">
            <span class="lb-rank">#${i + 1}</span>
            <span class="lb-name">${esc(u.username)}</span>
            <span class="lb-words">${(u[field] || 0).toLocaleString()} WDS</span>
        </div>
    `).join('');
}

// ── Friends list ──────────────────────────────────────────────────────────────
let _friendsData = [];

function renderFriends(list) {
    const container = document.getElementById('friendsList');
    if (!container) return;
    if (list.length === 0) {
        container.innerHTML = '<div class="lb-empty">NO MATCHES</div>';
        return;
    }
    container.innerHTML = list.map(u => `
        <div class="lb-row">
            <span class="lb-rank">✦</span>
            <span class="lb-name">${esc(u.username)}</span>
            <span class="lb-words">${(u.totalWords || 0).toLocaleString()} WDS</span>
            <button class="lb-remove-btn" data-uid="${esc(u.uid)}" data-name="${esc(u.username)}" onclick="openReportDialog({type:'writer', uid:this.dataset.uid, username:this.dataset.name})" title="Report or block" aria-label="Report or block ${esc(u.username)}">⚑</button>
            <button class="lb-remove-btn" data-uid="${esc(u.uid)}" data-name="${esc(u.username)}" onclick="doRemoveFriend(this.dataset.uid, this.dataset.name)" aria-label="Remove ${esc(u.username)}">✕</button>
        </div>
    `).join('');
}

window.filterFriends = function(query) {
    const q = query.trim().toUpperCase();
    const filtered = q ? _friendsData.filter(u => u.username.toUpperCase().includes(q)) : _friendsData;
    renderFriends(filtered);
};

async function loadFriends() {
    const container = document.getElementById('friendsList');
    if (!container) return;
    container.innerHTML = '<div class="lb-loading">LOADING...</div>';

    const result = await window.getFriends();

    if (!result || result.error) {
        container.innerHTML = '<div class="lb-empty">COULD NOT LOAD FRIENDS</div>';
        return;
    }
    if (result.length === 0) {
        container.innerHTML = '<div class="lb-empty">NO FRIENDS YET — ADD ONE ABOVE</div>';
        return;
    }

    _friendsData = [...result].sort((a, b) => (b.totalWords || 0) - (a.totalWords || 0));
    const searchVal = document.getElementById('friendsSearch');
    const q = searchVal ? searchVal.value.trim().toUpperCase() : '';
    const filtered = q ? _friendsData.filter(u => u.username.toUpperCase().includes(q)) : _friendsData;
    renderFriends(filtered);
}

// ── Add friend ────────────────────────────────────────────────────────────────
window.doAddFriend = async function() {
    const input    = document.getElementById('friendUsernameInput');
    const msg      = document.getElementById('addFriendMsg');
    const username = input.value.trim();
    if (!username) return;

    msg.style.color = 'var(--text-dim)';
    msg.textContent = 'SEARCHING...';

    const result = await window.addFriend(username);
    if (result.success) {
        input.value     = '';
        msg.style.color = 'var(--neon)';
        msg.textContent = 'REQUEST SENT TO ' + username;
    } else {
        msg.style.color = '#ff4500';
        msg.textContent = result.error || 'COULD NOT SEND REQUEST';
    }
    setTimeout(() => { msg.textContent = ''; }, 3000);
};

// ── Shared with me ────────────────────────────────────────────────────────────
// Grouped as writer + project, each folded to one line. A chapter that reached
// this reader more than once (directly and through a group) shows once.
let _sharedWithMeData = [];      // one entry per chapter, after merging duplicates
let _shareReads = { seen: {}, readAt: {}, hidden: {} };
const _swmOpenProjects = new Set();
let _swmShowHidden = false;

const swmChapterKey = s => s.ownerId + '|' + s.chapterId;
const swmProjectKey = s => s.ownerId + '|' + (s.projectId || s.projectTitle || '');

function swmAgo(t) {
    if (!t) return '';
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 60)   return mins <= 1 ? 'JUST NOW' : mins + ' MIN AGO';
    const hrs = Math.round(mins / 60);
    if (hrs < 24)    return hrs + 'H AGO';
    const days = Math.round(hrs / 24);
    if (days < 30)   return days === 1 ? 'YESTERDAY' : days + ' DAYS AGO';
    return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
}

// Book order when every chapter in the project carries its position (shares
// made from now on do). Otherwise natural title order ("Chapter 2" before
// "Chapter 10"), so older shares and newer ones don't split into two runs.
function swmSortChapters(chapters) {
    const byTitle = (a, b) => String(a.chapterTitle || '').localeCompare(String(b.chapterTitle || ''), undefined, { numeric: true, sensitivity: 'base' });
    const allOrdered = chapters.every(c => Number.isFinite(c.chapterOrder));
    return chapters.sort(allOrdered ? (a, b) => (a.chapterOrder - b.chapterOrder) || byTitle(a, b) : byTitle);
}

function swmStatus(sh) {
    const seen = _shareReads.seen[swmChapterKey(sh)];
    if (!seen) return 'new';
    return (sh.updatedAt || 0) > seen ? 'updated' : '';
}

function swmIsOpen() { try { return localStorage.getItem('dpSharedOpen') === '1'; } catch (e) { return false; } }

window.toggleSharedWithMe = function(force) {
    const open = typeof force === 'boolean' ? force : !swmIsOpen();
    try { localStorage.setItem('dpSharedOpen', open ? '1' : '0'); } catch (e) {}
    swmApplyOpen();
};
function swmApplyOpen() {
    const open = swmIsOpen();
    const btn = document.getElementById('swmToggle');
    document.getElementById('sharedWithMeList').hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.querySelector('.swm-caret').textContent = open ? '▾' : '▸';
}

async function loadSharedWithMe() {
    const container = document.getElementById('sharedWithMeList');
    const summary   = document.getElementById('swmSummary');
    if (!container) return;
    swmApplyOpen();
    summary.textContent = '';
    container.innerHTML = '<div class="lb-loading">LOADING...</div>';

    const [result, reads] = await Promise.all([window.getSharedWithMe(), window.getShareReads()]);

    if (!result || result.error) {
        container.innerHTML = '<div class="lb-empty">COULD NOT LOAD</div>';
        return;
    }
    // Merge the same chapter arriving more than once; keep the newest copy and
    // remember every route it came by.
    const byChapter = new Map();
    result.forEach(sh => {
        const k = swmChapterKey(sh), have = byChapter.get(k);
        const via = sh.groupName ? 'VIA ' + sh.groupName : 'DIRECTLY';
        if (!have) { byChapter.set(k, { ...sh, via: [via] }); return; }
        const vias = have.via.includes(via) ? have.via : have.via.concat(via);
        byChapter.set(k, (sh.updatedAt || 0) > (have.updatedAt || 0) ? { ...sh, via: vias } : { ...have, via: vias });
    });
    _sharedWithMeData = [...byChapter.values()];
    _shareReads = { seen: reads.seen || {}, readAt: reads.readAt || {}, hidden: reads.hidden || {} };

    // First visit after this feature arrives: count what's already here as read,
    // so long-standing shares don't all light up as NEW.
    if (reads.fresh && !reads.error && _sharedWithMeData.length) {
        const base = {};
        _sharedWithMeData.forEach(sh => { base[swmChapterKey(sh)] = sh.updatedAt || 1; });
        Object.assign(_shareReads.seen, base);
        window.markSharesSeen(base);
    }
    renderSharedWithMe();
}

function renderSharedWithMe() {
    const container = document.getElementById('sharedWithMeList');
    const summary   = document.getElementById('swmSummary');
    const all = _sharedWithMeData;

    if (!all.length) {
        summary.textContent = 'NOTHING YET';
        container.innerHTML = '<div class="lb-empty">NOTHING SHARED WITH YOU YET</div>';
        return;
    }

    // Writer + project cards, most recently updated first
    const projects = new Map();
    all.forEach(sh => {
        const k = swmProjectKey(sh);
        if (!projects.has(k)) projects.set(k, { key: k, ownerUsername: sh.ownerUsername, projectTitle: sh.projectTitle, chapters: [], updatedAt: 0, via: new Set() });
        const p = projects.get(k);
        p.chapters.push(sh);
        p.updatedAt = Math.max(p.updatedAt, sh.updatedAt || 0);
        sh.via.forEach(v => p.via.add(v));
    });
    const list = [...projects.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    list.forEach(p => {
        swmSortChapters(p.chapters);
        p.fresh = p.chapters.filter(swmStatus).length;
        // Hidden until the writer shares something newer in this project
        p.hidden = (_shareReads.hidden[p.key] || 0) >= p.updatedAt;
    });
    const shown  = list.filter(p => !p.hidden);
    const hidden = list.filter(p => p.hidden);

    const writers = new Set(shown.map(p => p.key.split('|')[0])).size;
    const chCount = shown.reduce((n, p) => n + p.chapters.length, 0);
    const freshAll = shown.reduce((n, p) => n + p.fresh, 0);
    summary.innerHTML = shown.length
        ? `${chCount} ${chCount === 1 ? 'CHAPTER' : 'CHAPTERS'} · ${writers} ${writers === 1 ? 'WRITER' : 'WRITERS'}` +
          (freshAll ? ` <span class="swm-badge">${freshAll} NEW</span>` : '')
        : 'ALL HIDDEN';

    const card = p => {
        const open = _swmOpenProjects.has(p.key);
        const words = p.chapters.reduce((n, c) => n + (Number(c.wordCount) || 0), 0);
        const rows = !open ? '' : p.chapters.map(sh => {
            const st = swmStatus(sh);
            const readAt = _shareReads.readAt[swmChapterKey(sh)];
            // Past-tense marker: plain dim text, not a box, so it doesn't look tappable
            const mark = st ? `<span class="swm-badge">${st === 'new' ? 'NEW' : 'UPDATED'}</span>`
                       : readAt ? `<span class="swm-was-read">READ ${swmAgo(readAt)}</span>` : '';
            return `<div class="swm-ch${!st && readAt ? ' swm-ch-read' : ''}">
                <span class="swm-ch-title"><span>${esc(sh.chapterTitle)}</span>${mark}</span>
                <span class="lb-words">${(Number(sh.wordCount) || 0).toLocaleString()} WDS</span>
                <button type="button" class="swm-read" data-id="${esc(sh.id)}" onclick="viewShare(this.dataset.id)">OPEN</button>
            </div>`;
        }).join('');
        const foot = !open ? '' : `<div class="swm-foot">
                <span>SHARED ${esc([...p.via].sort().join(' AND '))}</span>
                <button type="button" class="swm-link" data-key="${esc(p.key)}" onclick="${p.hidden ? 'unhideShareProject' : 'hideShareProject'}(this.dataset.key)">${p.hidden ? 'SHOW AGAIN' : 'HIDE'}</button>
            </div>`;
        return `<div class="swm-card${p.fresh ? ' swm-card-fresh' : ''}">
            <button type="button" class="swm-head" aria-expanded="${open}" data-key="${esc(p.key)}" onclick="toggleShareProject(this.dataset.key)">
                <span class="swm-caret" aria-hidden="true">${open ? '▾' : '▸'}</span>
                <span class="swm-head-main">
                    <span class="swm-proj">${esc(p.projectTitle || 'UNTITLED')}</span>
                    <span class="swm-meta">${esc(p.ownerUsername || '?')} · ${p.chapters.length} CH · ${words.toLocaleString()} WDS · ${swmAgo(p.updatedAt)}</span>
                </span>
                ${p.fresh ? `<span class="swm-badge">${p.fresh} NEW</span>` : ''}
            </button>
            ${rows}${foot}
        </div>`;
    };

    container.innerHTML =
        (shown.length ? shown.map(card).join('') : '<div class="lb-empty">EVERYTHING HERE IS HIDDEN</div>') +
        (hidden.length ? `<button type="button" class="swm-link swm-hidden-toggle" onclick="toggleHiddenShares()">${_swmShowHidden ? 'HIDE' : 'SHOW'} HIDDEN (${hidden.length})</button>` +
            (_swmShowHidden ? `<div class="swm-hidden-list">${hidden.map(card).join('')}</div>` : '') : '');
}

window.toggleShareProject = function(key) {
    if (_swmOpenProjects.has(key)) _swmOpenProjects.delete(key); else _swmOpenProjects.add(key);
    renderSharedWithMe();
};
window.toggleHiddenShares = function() { _swmShowHidden = !_swmShowHidden; renderSharedWithMe(); };
window.hideShareProject = async function(key) {
    const t = Date.now();
    _shareReads.hidden[key] = t;
    _swmOpenProjects.delete(key);
    renderSharedWithMe();
    await window.setShareProjectHidden(key, t);
};
window.unhideShareProject = async function(key) {
    _shareReads.hidden[key] = 0;
    renderSharedWithMe();
    await window.setShareProjectHidden(key, 0);
};

window.viewShare = function(shareId) {
    const share = _sharedWithMeData.find(s => s.id === shareId);
    if (!share) return;
    document.getElementById('shareViewTitle').textContent = share.chapterTitle.toUpperCase();
    document.getElementById('shareViewMeta').textContent  = share.projectTitle + ' — BY ' + share.ownerUsername;
    document.getElementById('shareViewContent').innerHTML = share.content ? safeChapterHtml(share.content) : '<em style="color:var(--text-dim);">No content.</em>';
    document.getElementById('shareViewReport').onclick = () => window.openReportDialog({
        type: 'share', uid: share.ownerId, username: share.ownerUsername,
        path: 'shares/' + share.id, excerpt: share.chapterTitle });
    document.getElementById('shareViewOverlay').style.display = 'flex';
    // Opening it clears its NEW / UPDATED mark and records when it was read
    const k = swmChapterKey(share), now = Date.now();
    _shareReads.seen[k] = Math.max(_shareReads.seen[k] || 0, share.updatedAt || 1);
    _shareReads.readAt[k] = now;
    window.markSharesSeen({ [k]: _shareReads.seen[k] }, now);
    renderSharedWithMe();
    swmFeedbackReset(share);
};

// ── Feedback on a shared chapter → the writer's message inbox ────────────────
// Direct messages only reach someone who has you as a friend (database rules),
// so for a writer who shared through a group but isn't a friend, say so
// instead of offering a button that would fail.
let _swmFeedbackShare = null;
function swmFeedbackReset(share) {
    _swmFeedbackShare = share;
    const bar = document.getElementById('swmFeedback');
    if (!bar) return;
    const isFriend = (_friendsData || []).some(f => f.uid === share.ownerId);
    const name = esc(share.ownerUsername || 'the writer');
    if (document.body.classList.contains('dp-under-min')) { bar.innerHTML = ''; return; }
    bar.innerHTML = isFriend
        ? `<button type="button" class="btn-secondary swm-fb-open" onclick="swmFeedbackOpen()">✉ SEND FEEDBACK TO ${name}</button>`
        : `<p class="swm-fb-note">YOU CAN ONLY GIVE FEEDBACK TO FRIENDS.</p>`;
}
window.swmFeedbackOpen = function() {
    const share = _swmFeedbackShare; if (!share) return;
    document.getElementById('swmFeedback').innerHTML = `
        <label for="swmFbText" class="grp-label">FEEDBACK ON “${esc(share.chapterTitle)}” · GOES TO ${esc(share.ownerUsername)}’S MESSAGES</label>
        <textarea id="swmFbText" class="swm-fb-text" maxlength="500" rows="4" oninput="document.getElementById('swmFbCount').textContent = this.value.length + ' / 500'"></textarea>
        <div class="swm-fb-foot">
            <span id="swmFbCount" class="swm-fb-count">0 / 500</span>
            <span id="swmFbMsg" class="swm-fb-msg" role="status"></span>
            <button type="button" class="grp-cancel-btn swm-fb-btn" onclick="swmFeedbackReset(_swmFeedbackShare)">CANCEL</button>
            <button type="button" class="swm-fb-btn" id="swmFbSend" onclick="swmFeedbackSend()">SEND</button>
        </div>`;
    document.getElementById('swmFbText').focus();
};
window.swmFeedbackReset = swmFeedbackReset;
window.swmFeedbackSend = async function() {
    const share = _swmFeedbackShare; if (!share) return;
    const text = document.getElementById('swmFbText').value.trim();
    const msg  = document.getElementById('swmFbMsg');
    if (!text) { msg.style.color = '#ff4500'; msg.textContent = 'WRITE SOMETHING FIRST'; return; }
    const btn = document.getElementById('swmFbSend');
    btn.disabled = true; msg.style.color = 'var(--text-dim)'; msg.textContent = 'SENDING...';
    const r = await window.sendMessage(share.ownerId, share.ownerUsername, text,
        { kind: 'chapter', chapterId: share.chapterId, chapterTitle: share.chapterTitle, projectTitle: share.projectTitle });
    if (r && r.success) {
        document.getElementById('swmFeedback').innerHTML =
            `<p class="swm-fb-note swm-fb-sent">FEEDBACK SENT TO ${esc(share.ownerUsername)}. IT’S IN YOUR MESSAGES TOO.</p>`;
    } else {
        btn.disabled = false; msg.style.color = '#ff4500';
        msg.textContent = 'COULD NOT SEND — YOUR TEXT IS STILL HERE';
    }
};
window.onDpBlockChange = function() { closeShareView(); loadAll(); };

window.closeShareView = function() {
    document.getElementById('shareViewOverlay').style.display = 'none';
};

// ── Remove friend ─────────────────────────────────────────────────────────────
window.doRemoveFriend = async function(uid, username) {
    if (!confirm('Remove ' + username + ' from friends?')) return;
    const result = await window.removeFriend(uid);
    if (result.success) loadFriends();
};

// ── Create a group here ───────────────────────────────────────────────────────
const GROUP_MAX = 12;

let _newGroupPicker = null;
window.toggleNewGroup = function(show) {
    const panel = document.getElementById('grpNewPanel');
    const open = show === undefined ? panel.style.display === 'none' : show;
    panel.style.display = open ? '' : 'none';
    document.getElementById('grpNewMsg').textContent = '';
    if (!open) return;
    const friends = _friendsData.map(f => ({ uid: f.uid, username: f.username }));
    if (!_newGroupPicker) _newGroupPicker = createFriendPicker(document.getElementById('grpNewPicker'), { friends, max: GROUP_MAX - 1 });
    else _newGroupPicker.setFriends(friends, []);
    document.getElementById('grpNewName').focus();
};

window.createGroupHere = async function() {
    const name   = document.getElementById('grpNewName').value.trim();
    const picked = _newGroupPicker ? _newGroupPicker.getSelected() : [];
    const msg    = document.getElementById('grpNewMsg');
    if (!name)          { msg.textContent = 'GIVE THE GROUP A NAME'; return; }
    if (!picked.length) { msg.textContent = 'CHOOSE AT LEAST ONE FRIEND'; return; }
    if (picked.length > GROUP_MAX - 1) { msg.textContent = 'A GROUP CAN HAVE UP TO 12 PEOPLE INCLUDING YOU'; return; }
    msg.textContent = 'CREATING...';
    const r = await window.createGroup(name, picked);
    if (r && r.success) {
        document.getElementById('grpNewName').value = '';
        if (_newGroupPicker) _newGroupPicker.reset();
        toggleNewGroup(false);
        await loadMyGroups();
        const card = document.querySelector(`.grp-card[data-id="${CSS.escape(r.id)}"]`);
        if (card) { card.classList.add('grp-card-new'); card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    } else {
        msg.textContent = (r && r.error) || 'COULD NOT CREATE THE GROUP';
    }
};
