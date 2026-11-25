(function() {
    const _dp = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
    const _ok = _dp.activeProjectId && _dp.projects && _dp.projects[_dp.activeProjectId] && _dp.projects[_dp.activeProjectId].active;
    if (!_ok) window.location.replace('index.html');
})();

// ── Messages: one-to-one conversations and group chats ────────────────────────
// Direct messages are stored exactly as before (one record per message with
// from/to); this page groups them into conversations. Group chats live in
// groups/{id}/messages. Both update live while the page is open.

const GROUP_MAX = 12;
let _all        = [];      // direct messages to or from me, oldest first
let _friends    = [];      // [{ uid, username }]
let _groups     = [];      // groups I'm in
let _groupMsgs  = {};      // groupId -> messages, oldest first
let _groupStops = {};      // groupId -> stop listening
let _reads      = {};      // groupId -> time I last read it
let _open       = null;    // { type: 'dm', uid } | { type: 'group', id }
let _stopWatch  = null, _stopGroups = null;
let _me         = null;
let _pendingOpenGroup = null;

// ── Auth ──────────────────────────────────────────────────────────────────────
function showGate() {
    document.getElementById('messagesGate').style.display    = 'block';
    document.getElementById('messagesContent').style.display = 'none';
}

function showContent() {
    document.getElementById('messagesGate').style.display    = 'none';
    document.getElementById('messagesContent').style.display = 'block';
    const user = window.getCurrentUser && window.getCurrentUser();
    if (!user || (_me && _me === user.uid && _stopWatch)) return;
    _me = user.uid;
    loadFriends();
    startWatching();
}

function stopAll() {
    if (_stopWatch) _stopWatch();
    if (_stopGroups) _stopGroups();
    Object.values(_groupStops).forEach(f => f());
    _groupStops = {};
    _stopWatch = _stopGroups = null;
}

document.addEventListener('dpAuthChanged', function(e) {
    if (e.detail.user) showContent(); else { stopAll(); _me = null; showGate(); }
});

window.addEventListener('load', function() {
    const user = window.getCurrentUser && window.getCurrentUser();
    if (user)               showContent();
    else if (user === null) showGate();
});

// ── Data ──────────────────────────────────────────────────────────────────────
async function loadFriends() {
    const friends = await window.getFriends();
    _friends = Array.isArray(friends) ? friends.map(f => ({ uid: f.uid, username: f.username })) : [];
    const select = document.getElementById('composeToSelect');
    if (select) {
        select.innerHTML = _friends.length
            ? '<option value="">— CHOOSE A FRIEND —</option>' + _friends.map(f => `<option value="${escapeAttr(f.uid)}">${escapeHtml(f.username)}</option>`).join('')
            : '<option value="">NO FRIENDS YET — ADD THEM IN WRITING GROUPS</option>';
    }
    if (_newGroupPicker) _newGroupPicker.setFriends(friendList(), []);
    if (_addPicker && currentGroup()) _addPicker.setFriends(friendList(), currentGroup().members || []);
    if (_open) renderThread();
}

async function startWatching() {
    stopAll();
    _reads = (window.getGroupReads ? await window.getGroupReads() : {}) || {};
    if (window.watchMessages) _stopWatch = window.watchMessages(list => { _all = list; refresh(); }, () => fallbackLoad());
    else fallbackLoad();
    if (window.watchGroups) _stopGroups = window.watchGroups(onGroups, () => {});
}

function onGroups(groups) {
    _groups = groups;
    const ids = new Set(groups.map(g => g.id));
    groups.forEach(g => {
        if (_groupStops[g.id]) return;
        _groupStops[g.id] = window.watchGroupMessages(g.id, list => { _groupMsgs[g.id] = list; refresh(); }, () => {});
    });
    Object.keys(_groupStops).forEach(id => {
        if (!ids.has(id)) { _groupStops[id](); delete _groupStops[id]; delete _groupMsgs[id]; }
    });
    if (_open && _open.type === 'group' && !ids.has(_open.id)) closeThread();
    refresh();
    openFromHash();
}

async function fallbackLoad() {
    const [inbox, sent] = await Promise.all([window.getInbox(), window.getSent()]);
    if (!Array.isArray(inbox) || !Array.isArray(sent)) {
        document.getElementById('convList').innerHTML = '<div class="lb-empty">COULD NOT LOAD MESSAGES</div>';
        return;
    }
    _all = [...inbox, ...sent].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    refresh();
}

function otherOf(m) {
    return m.from === _me ? { uid: m.to, username: m.toUsername || '?' } : { uid: m.from, username: m.fromUsername || '?' };
}

function conversations() {
    const map = new Map();
    _all.forEach(m => {
        const o = otherOf(m);
        if (!o.uid || (window.dpIsBlocked && window.dpIsBlocked(o.uid))) return;
        const c = map.get(o.uid) || { type: 'dm', key: o.uid, name: o.username, messages: [], unread: 0 };
        c.messages.push(m);
        if (m.to === _me && !m.read) c.unread++;
        if (o.username && o.username !== '?') c.name = o.username;
        map.set(o.uid, c);
    });
    const list = [...map.values()];
    _groups.forEach(g => {
        const msgs = _groupMsgs[g.id] || [];
        const read = _reads[g.id] || 0;
        list.push({ type: 'group', key: g.id, name: g.name, group: g, messages: msgs,
                    unread: msgs.filter(m => m.from !== _me && (m.createdAt || 0) > read).length });
    });
    return list.sort((a, b) => lastTime(b) - lastTime(a));
}
function lastTime(c) {
    const m = c.messages[c.messages.length - 1];
    return m ? m.createdAt : (c.group ? c.group.createdAt || 0 : 0);
}

function refresh() {
    renderList();
    if (_open) renderThread();
    updateBadge();
}

function updateBadge() {
    const dm  = _all.filter(m => m.to === _me && !m.read).length;
    const grp = conversations().filter(c => c.type === 'group').reduce((s, c) => s + c.unread, 0);
    if (window.updateMessageBadge) window.updateMessageBadge(dm + grp);
}

// ── Conversation list ─────────────────────────────────────────────────────────
function renderList() {
    const el = document.getElementById('convList');
    const convs = conversations();
    if (!convs.length) {
        el.innerHTML = '<div class="lb-empty">NO CONVERSATIONS YET — START ONE WITH ＋ NEW MESSAGE OR ＋ NEW GROUP</div>';
        return;
    }
    el.innerHTML = convs.map(c => {
        const m = c.messages[c.messages.length - 1];
        let preview = 'No messages yet';
        if (m) {
            const who = m.from === _me ? 'You' : (c.type === 'group' ? (m.fromUsername || '?') : '');
            preview = (who ? who + ': ' : '') + (m.about && m.about.kind === 'chapter' ? 'On “' + (m.about.chapterTitle || '') + '”: ' : '') + snippet(m.body);
        }
        const call = c.type === 'group' ? `openGroup('${escapeAttr(c.key)}')` : `openThread('${escapeAttr(c.key)}')`;
        return `<button class="msg-conv${c.unread ? ' unread' : ''}" onclick="${call}">
            <span class="msg-conv-top">
                <span class="msg-conv-name">${escapeHtml(c.name)}</span>
                ${c.type === 'group' ? `<span class="msg-group-tag">GROUP · ${(c.group.members || []).length}</span>` : ''}
                ${c.unread ? `<span class="msg-unread">${c.unread} NEW</span>` : ''}
                <span class="msg-conv-time">${m ? escapeHtml(shortTime(m.createdAt)) : ''}</span>
            </span>
            <span class="msg-conv-snippet">${escapeHtml(preview)}</span>
        </button>`;
    }).join('');
}

window.showNewMessage = function() {
    document.getElementById('newGroupPanel').style.display = 'none';
    const p = document.getElementById('newMsgPicker');
    p.style.display = p.style.display === 'none' ? '' : 'none';
};

window.startConversation = function() {
    const uid = document.getElementById('composeToSelect').value;
    if (!uid) return;
    document.getElementById('newMsgPicker').style.display = 'none';
    openThread(uid);
};

// ── New group ─────────────────────────────────────────────────────────────────
let _newGroupPicker = null, _addPicker = null, _addPickerGroup = null;
function friendList() { return _friends.map(f => ({ uid: f.uid, username: f.username })); }

window.showNewGroup = function() {
    document.getElementById('newMsgPicker').style.display = 'none';
    const p = document.getElementById('newGroupPanel');
    p.style.display = p.style.display === 'none' ? '' : 'none';
    if (!_newGroupPicker) _newGroupPicker = createFriendPicker(document.getElementById('newGroupPicker'), { friends: friendList(), max: GROUP_MAX - 1 });
    else _newGroupPicker.setFriends(friendList(), []);
    document.getElementById('newGroupMsg').textContent = '';
};

window.createNewGroup = async function() {
    const name   = document.getElementById('newGroupName').value.trim();
    const picked = _newGroupPicker ? _newGroupPicker.getSelected() : [];
    const msg    = document.getElementById('newGroupMsg');
    if (!name)          { msg.textContent = 'GIVE THE GROUP A NAME'; return; }
    if (!picked.length) { msg.textContent = 'CHOOSE AT LEAST ONE FRIEND'; return; }
    if (picked.length > GROUP_MAX - 1) { msg.textContent = `A GROUP CAN HAVE UP TO ${GROUP_MAX} PEOPLE INCLUDING YOU`; return; }
    msg.textContent = 'CREATING...';
    const r = await window.createGroup(name, picked);
    if (r && r.success) {
        document.getElementById('newGroupPanel').style.display = 'none';
        document.getElementById('newGroupName').value = '';
        if (_newGroupPicker) _newGroupPicker.reset();
        msg.textContent = '';
        _pendingOpenGroup = r.id;
        openFromHash();
    } else msg.textContent = (r && r.error) || 'COULD NOT CREATE THE GROUP';
};

// ── Open a conversation ───────────────────────────────────────────────────────
function showThreadView() {
    document.getElementById('convListView').style.display = 'none';
    document.getElementById('threadView').style.display   = '';
    document.getElementById('composeMsg').textContent = '';
    const panel = document.getElementById('groupPanel');
    panel.style.display = 'none'; panel.dataset.group = ''; _addPicker = null; _addPickerGroup = null;
}

window.openThread = function(uid) {
    _open = { type: 'dm', uid };
    showThreadView();
    renderThread(true);
    focusReply();
};

window.openGroup = function(id) {
    _open = { type: 'group', id };
    showThreadView();
    renderThread(true);
    focusReply();
    if (location.hash !== '#group=' + id) history.replaceState(null, '', '#group=' + id);
};

function focusReply() {
    const box = document.getElementById('composeBody');
    if (box && window.matchMedia('(pointer: fine)').matches) box.focus();
}

window.closeThread = function() {
    _open = null;
    if (location.hash) history.replaceState(null, '', location.pathname);
    document.getElementById('threadView').style.display   = 'none';
    document.getElementById('convListView').style.display = '';
    renderList();
};

// messages.html#group=ID opens that group (used by the Writing Groups page)
function openFromHash() {
    if (_pendingOpenGroup && _groups.some(g => g.id === _pendingOpenGroup)) {
        const id = _pendingOpenGroup; _pendingOpenGroup = null; openGroup(id); return;
    }
    const m = location.hash.match(/^#group=(.+)$/);
    if (m && !_open && _groups.some(g => g.id === m[1])) openGroup(m[1]);
}

function currentGroup() { return _open && _open.type === 'group' ? _groups.find(g => g.id === _open.id) : null; }

function renderThread(scrollToEnd) {
    const isGroup = _open.type === 'group';
    const group = currentGroup();
    if (isGroup && !group) return;
    const msgs = isGroup
        ? (_groupMsgs[_open.id] || [])
        : _all.filter(m => (m.from === _open.uid && m.to === _me) || (m.from === _me && m.to === _open.uid));
    const friend = !isGroup && _friends.find(f => f.uid === _open.uid);

    const title = isGroup ? group.name : ((friend && friend.username) || (msgs.length ? otherOf(msgs[msgs.length - 1]).username : '?'));
    document.getElementById('threadName').textContent = title;
    document.getElementById('threadSub').innerHTML = isGroup
        ? `${(group.members || []).length} members · <button class="msg-link" onclick="toggleGroupPanel()">MEMBERS &amp; SETTINGS</button>`
        : `<button class="msg-link" onclick="reportWriter('${escapeAttr(_open.uid)}', '${escapeAttr(title)}')">REPORT</button> · <button class="msg-link" onclick="blockFromThread('${escapeAttr(_open.uid)}', '${escapeAttr(title)}')">BLOCK</button>`;

    const box = document.getElementById('threadMessages');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    const isOwner = isGroup && group.ownerId === _me;
    if (!msgs.length) {
        box.innerHTML = '<div class="lb-empty">NO MESSAGES YET — SAY HELLO</div>';
    } else {
        let html = '', lastDay = '', lastFrom = '';
        msgs.forEach(m => {
            const day = dayLabel(m.createdAt);
            if (day !== lastDay) { html += `<div class="msg-day">${escapeHtml(day)}</div>`; lastDay = day; lastFrom = ''; }
            const mine = m.from === _me;
            const showName = isGroup && !mine && m.from !== lastFrom;
            const canDelete = mine || isOwner;
            const delTitle = isGroup ? 'Delete for everyone in the group' : 'Delete for both of you';
            const status = mine && !isGroup ? (m.read ? ' · Read' : ' · Sent') : '';
            html += `<div class="msg-bubble-row ${mine ? 'mine' : 'theirs'}">
                <div class="msg-bubble">
                    ${showName ? `<div class="msg-sender">${escapeHtml(m.fromUsername || (group.memberNames || {})[m.from] || '?')}</div>` : ''}
                    ${m.about && m.about.kind === 'chapter' ? `<div class="msg-about">FEEDBACK ON “${escapeHtml(m.about.chapterTitle || '')}”${m.about.projectTitle ? ' · ' + escapeHtml(m.about.projectTitle) : ''}</div>` : ''}
                    <div class="msg-text">${linkify(m.body)}</div>
                    <div class="msg-meta">
                        <span>${escapeHtml(timeOnly(m.createdAt))}${status}</span>
                        ${canDelete ? `<button class="msg-del" onclick="doDeleteMessage('${escapeAttr(m.id)}')" title="${delTitle}" aria-label="${delTitle}">✕</button>` : ''}
                        ${!mine ? `<button class="msg-del" onclick="reportMessage('${escapeAttr(m.id)}')" title="Report this message" aria-label="Report this message">⚑</button>` : ''}
                    </div>
                </div>
            </div>`;
            lastFrom = m.from;
        });
        box.innerHTML = html;
    }
    if (scrollToEnd || atBottom) box.scrollTop = box.scrollHeight;

    const canReply = isGroup || !!friend;
    document.getElementById('replyBox').style.display     = canReply ? '' : 'none';
    document.getElementById('replyBlocked').style.display = canReply ? 'none' : '';

    if (isGroup && document.getElementById('groupPanel').style.display !== 'none') renderGroupPanel();

    // Mark as read only what's open, only while the page is visible
    if (document.visibilityState !== 'visible') return;
    if (isGroup) {
        const latest = msgs.length ? msgs[msgs.length - 1].createdAt : 0;
        if (latest > (_reads[_open.id] || 0)) {
            _reads[_open.id] = latest;
            window.markGroupRead(_open.id, latest);
            updateBadge(); renderList();
        }
    } else {
        const unread = msgs.filter(m => m.to === _me && !m.read);
        if (unread.length) {
            unread.forEach(m => { m.read = true; window.markMessageRead(m.id); });
            updateBadge(); renderList();
        }
    }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && _open) renderThread(); });

// ── Group members & settings ──────────────────────────────────────────────────
window.toggleGroupPanel = function() {
    const p = document.getElementById('groupPanel');
    p.style.display = p.style.display === 'none' ? '' : 'none';
    if (p.style.display !== 'none') renderGroupPanel();
};

function renderGroupPanel() {
    const g = currentGroup();
    if (!g) return;
    const panel = document.getElementById('groupPanel');
    const isOwner = g.ownerId === _me;
    // Build the panel once per group; live updates only refresh the parts that
    // change, so a half-chosen list of friends or a rename in progress survives
    if (panel.dataset.group !== g.id || panel.dataset.owner !== String(isOwner)) {
        panel.dataset.group = g.id; panel.dataset.owner = String(isOwner);
        panel.innerHTML = `<div class="msg-label">MEMBERS</div><div id="groupMembers"></div>` +
            (isOwner ? `<div class="msg-label msg-gap">RENAME</div>
                <div class="msg-picker-row"><input type="text" id="groupRename" maxlength="60" value="${escapeAttr(g.name)}"><button onclick="renameGroup()">SAVE</button></div>
                <div class="msg-label msg-gap" id="groupAddLabel">ADD FRIENDS</div>
                <div id="groupAddPicker"></div>
                <button class="msg-small" id="groupAddBtn" onclick="addMembers()">ADD CHOSEN</button>
                <div class="msg-danger"><button class="msg-small danger" onclick="deleteThisGroup()">DELETE GROUP</button>
                <span class="msg-hint">Deletes the group and all its messages for everyone.</span></div>`
            : '<div class="msg-danger"><button class="msg-small danger" onclick="leaveThisGroup()">LEAVE GROUP</button></div>') +
            '<p id="groupPanelMsg" class="msg-status"></p>';
        _addPicker = null; _addPickerGroup = null;
    }
    const names = g.memberNames || {};
    document.getElementById('groupMembers').innerHTML = (g.members || []).map(uid => `<div class="msg-member">
        <span>${escapeHtml(names[uid] || '?')}${uid === g.ownerId ? ' <em>(created the group)</em>' : ''}${uid === _me ? ' <em>(you)</em>' : ''}</span>
        ${isOwner && uid !== _me ? `<button class="msg-small" onclick="removeMember('${escapeAttr(uid)}')">REMOVE</button>` : ''}
        ${uid !== _me ? `<button class="msg-small" onclick="reportWriter('${escapeAttr(uid)}', '${escapeAttr(names[uid] || '?')}')">REPORT</button>` : ''}
    </div>`).join('');
    if (isOwner) {
        const room = GROUP_MAX - (g.members || []).length;
        document.getElementById('groupAddLabel').textContent = room > 0 ? `ADD FRIENDS (UP TO ${room} MORE)` : 'ADD FRIENDS (GROUP IS FULL)';
        document.getElementById('groupAddBtn').style.display = room > 0 ? '' : 'none';
        document.getElementById('groupAddPicker').style.display = room > 0 ? '' : 'none';
        if (!_addPicker || _addPickerGroup !== g.id) {
            _addPicker = createFriendPicker(document.getElementById('groupAddPicker'), { friends: friendList(), exclude: g.members || [], max: Math.max(1, room) });
            _addPickerGroup = g.id;
        } else {
            _addPicker.setFriends(friendList(), g.members || []);
        }
    }
}

function groupMembersList(g) { return (g.members || []).map(uid => ({ uid, username: (g.memberNames || {})[uid] || '?' })); }
function panelMsg(t) { const el = document.getElementById('groupPanelMsg'); if (el) el.textContent = t; }

window.renameGroup = async function() {
    const g = currentGroup(); const name = document.getElementById('groupRename').value.trim();
    if (!g || !name) return;
    const r = await window.updateGroup(g.id, { name });
    panelMsg(r && r.success ? 'RENAMED' : (r && r.error) || 'COULD NOT RENAME');
};
window.addMembers = async function() {
    const g = currentGroup(); if (!g) return;
    const picked = _addPicker ? _addPicker.getSelected() : [];
    if (!picked.length) { panelMsg('CHOOSE SOMEONE TO ADD'); return; }
    if ((g.members || []).length + picked.length > GROUP_MAX) { panelMsg(`A GROUP CAN HAVE UP TO ${GROUP_MAX} PEOPLE`); return; }
    const r = await window.updateGroup(g.id, { members: [...groupMembersList(g), ...picked] });
    if (r && r.success) { _addPicker = null; _addPickerGroup = null; }
    panelMsg(r && r.success ? 'ADDED' : (r && r.error) || 'COULD NOT ADD');
};
window.removeMember = async function(uid) {
    const g = currentGroup(); if (!g) return;
    const name = (g.memberNames || {})[uid] || 'this member';
    if (!confirm(`Remove ${name} from "${g.name}"?\n\nTheir past messages stay in the group.`)) return;
    const r = await window.updateGroup(g.id, { members: groupMembersList(g).filter(m => m.uid !== uid) });
    panelMsg(r && r.success ? 'REMOVED' : (r && r.error) || 'COULD NOT REMOVE');
};
window.leaveThisGroup = async function() {
    const g = currentGroup(); if (!g) return;
    if (!confirm(`Leave "${g.name}"?\n\nYou won't see its messages any more unless you're added again. Your past messages stay in the group.`)) return;
    const r = await window.leaveGroup(g.id);
    if (r && r.success) closeThread(); else panelMsg((r && r.error) || 'COULD NOT LEAVE');
};
window.deleteThisGroup = async function() {
    const g = currentGroup(); if (!g) return;
    if (!confirm(`Delete "${g.name}" for everyone?\n\nAll of its messages will be deleted. This can't be undone.`)) return;
    const r = await window.deleteGroup(g.id);
    if (r && r.success) closeThread(); else panelMsg((r && r.error) || 'COULD NOT DELETE');
};

// ── Sending ───────────────────────────────────────────────────────────────────
window.doSendMessage = async function() {
    const textarea = document.getElementById('composeBody');
    const status   = document.getElementById('composeMsg');
    const btn      = document.getElementById('sendBtn');
    const body     = textarea.value.trim();
    if (!body) { status.style.color = '#ff4500'; status.textContent = 'MESSAGE CANNOT BE EMPTY'; return; }

    let send;
    if (_open.type === 'group') {
        const gid = _open.id;
        send = () => window.sendGroupMessage(gid, body);
    } else {
        const friend = _friends.find(f => f.uid === _open.uid);
        if (!friend) { status.style.color = '#ff4500'; status.textContent = 'YOU CAN ONLY MESSAGE FRIENDS'; return; }
        send = () => window.sendMessage(friend.uid, friend.username, body);
    }
    status.style.color = ''; status.textContent = 'SENDING...';
    btn.disabled = true;
    try {
        const result = await send();
        if (result && result.success) {
            textarea.value = ''; updateCharCount(textarea); status.textContent = '';
            if (_open && _open.type === 'dm' && !_stopWatch) fallbackLoad();
        } else {
            status.style.color = '#ff4500';
            status.textContent = (result && result.error) || 'COULD NOT SEND — YOUR MESSAGE IS STILL HERE';
        }
    } catch (err) {
        status.style.color = '#ff4500';
        status.textContent = 'COULD NOT SEND — YOUR MESSAGE IS STILL HERE';
    }
    btn.disabled = false;
};

window.replyKey = function(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSendMessage(); }
};

window.updateCharCount = function(el) {
    const count = document.getElementById('composeCharCount');
    if (count) count.textContent = el.value.length + ' / 500';
};

// ── Deleting ──────────────────────────────────────────────────────────────────
window.doDeleteMessage = async function(id) {
    const isGroup = _open && _open.type === 'group';
    const text = isGroup
        ? 'Delete this message for everyone in the group?\n\nThis can\'t be undone.'
        : 'Delete this message for both of you?\n\nIt will disappear from both your conversation and theirs. This can\'t be undone.';
    if (!confirm(text)) return;
    const result = isGroup ? await window.deleteGroupMessage(_open.id, id) : await window.deleteMessage(id);
    if (result && result.success) { if (!isGroup && !_stopWatch) fallbackLoad(); }
    else alert('Could not delete the message.');
};

// ── Formatting ────────────────────────────────────────────────────────────────
// ── Report and block ─────────────────────────────────────────────────────────
window.reportMessage = function(id) {
    const isGroup = _open && _open.type === 'group';
    const list = isGroup ? (_groupMsgs[_open.id] || []) : _all;
    const m = list.find(x => x.id === id);
    if (!m) return;
    const group = currentGroup();
    window.openReportDialog({
        type: isGroup ? 'groupMessage' : 'message',
        uid: m.from,
        username: m.fromUsername || (group && (group.memberNames || {})[m.from]) || '?',
        path: isGroup ? `groups/${_open.id}/messages/${id}` : `messages/${id}`,
        excerpt: m.body
    });
};
window.reportWriter = function(uid, username) {
    window.openReportDialog({ type: 'writer', uid, username });
};
window.blockFromThread = async function(uid, username) {
    if (await window.confirmBlock(uid, username)) closeThread();
};
window.onDpBlockChange = async function() {
    await loadFriends();
    if (_open && _open.type !== 'group' && window.dpIsBlocked(_open.uid)) closeThread();
    refresh();
};

function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(str) { return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

// Turn web addresses in a message into clickable links. Every piece of text is
// still escaped; only http(s):// and www. addresses become links, so nothing
// like javascript: can ever be produced.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
function linkify(str) {
    const text = String(str == null ? '' : str);
    let out = '', last = 0, m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text))) {
        let url = m[0];
        // Leave sentence punctuation (and an unmatched closing bracket) outside the link.
        while (/[.,!?;:)\]}]$/.test(url)) {
            const ch = url.slice(-1);
            if (ch === ')' && (url.match(/\(/g) || []).length >= (url.match(/\)/g) || []).length) break;
            url = url.slice(0, -1);
        }
        if (!url || /^(?:https?:\/\/|www\.)$/i.test(url)) continue;
        const href = /^https?:\/\//i.test(url) ? url : 'https://' + url;
        out += escapeHtml(text.slice(last, m.index));
        out += `<a class="msg-url" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(url)}</a>`;
        last = m.index + url.length;
        URL_RE.lastIndex = last;
    }
    return out + escapeHtml(text.slice(last));
}
function snippet(body) { const t = String(body || '').replace(/\s+/g, ' ').trim(); return t.length > 70 ? t.slice(0, 70) + '…' : t; }
function sameDay(a, b) { return a.toDateString() === b.toDateString(); }
function dayLabel(t) {
    const d = new Date(t), now = new Date(), y = new Date(); y.setDate(now.getDate() - 1);
    if (sameDay(d, now)) return 'Today';
    if (sameDay(d, y))   return 'Yesterday';
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
function timeOnly(t) { return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
function shortTime(t) {
    const d = new Date(t), now = new Date();
    if (sameDay(d, now)) return timeOnly(t);
    if (now - d < 6 * 86400000) return d.toLocaleDateString('en-GB', { weekday: 'short' });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
