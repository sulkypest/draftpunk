(function() {
    const _dp = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
    const _ok = _dp.activeProjectId && _dp.projects && _dp.projects[_dp.activeProjectId] && _dp.projects[_dp.activeProjectId].active;
    if (!_ok) window.location.replace('index.html');
})();

// ── Messages as conversations ─────────────────────────────────────────────────
// Messages are stored exactly as before (one record per message, with from/to).
// This page groups them by the other person into conversations, shows each as a
// back-and-forth thread, and updates live while open. Nothing is moved or
// rewritten; the only writes are sending, marking read, and deleting.

let _all       = [];      // every message to or from me, oldest first
let _friends   = [];      // [{ uid, username }]
let _openUid   = null;    // conversation currently open
let _stopWatch = null;
let _me        = null;

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

document.addEventListener('dpAuthChanged', function(e) {
    if (e.detail.user) showContent();
    else { if (_stopWatch) { _stopWatch(); _stopWatch = null; } _me = null; showGate(); }
});

window.addEventListener('load', function() {
    const user = window.getCurrentUser && window.getCurrentUser();
    if (user)               showContent();
    else if (user === null) showGate();
});

// ── Data ──────────────────────────────────────────────────────────────────────
async function loadFriends() {
    const select = document.getElementById('composeToSelect');
    const friends = await window.getFriends();
    _friends = Array.isArray(friends) ? friends.map(f => ({ uid: f.uid, username: f.username })) : [];
    if (select) {
        select.innerHTML = _friends.length
            ? '<option value="">— CHOOSE A FRIEND —</option>' + _friends.map(f => `<option value="${escapeAttr(f.uid)}">${escapeHtml(f.username)}</option>`).join('')
            : '<option value="">NO FRIENDS YET — ADD THEM IN WRITING GROUPS</option>';
    }
    if (_openUid) renderThread();
}

function startWatching() {
    if (_stopWatch) _stopWatch();
    if (window.watchMessages) {
        _stopWatch = window.watchMessages(list => { _all = list; refresh(); }, () => fallbackLoad());
    } else {
        fallbackLoad();
    }
}

// If live updates aren't available, load once (as the old page did)
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
    return m.from === _me
        ? { uid: m.to,   username: m.toUsername   || '?' }
        : { uid: m.from, username: m.fromUsername || '?' };
}

function conversations() {
    const map = new Map();
    _all.forEach(m => {
        const o = otherOf(m);
        if (!o.uid) return;
        const c = map.get(o.uid) || { uid: o.uid, username: o.username, messages: [], unread: 0 };
        c.messages.push(m);
        if (m.to === _me && !m.read) c.unread++;
        if (o.username && o.username !== '?') c.username = o.username;   // latest known name
        map.set(o.uid, c);
    });
    return [...map.values()].sort((a, b) => last(b).createdAt - last(a).createdAt);
}
function last(c) { return c.messages[c.messages.length - 1] || { createdAt: 0 }; }

function refresh() {
    renderList();
    if (_openUid) renderThread();
    updateBadge();
}

function updateBadge() {
    const unread = _all.filter(m => m.to === _me && !m.read).length;
    if (window.updateMessageBadge) window.updateMessageBadge(unread);
}

// ── Conversation list ─────────────────────────────────────────────────────────
function renderList() {
    const el = document.getElementById('convList');
    const convs = conversations();
    if (!convs.length) {
        el.innerHTML = '<div class="lb-empty">NO CONVERSATIONS YET — START ONE WITH ＋ NEW MESSAGE</div>';
        return;
    }
    el.innerHTML = convs.map(c => {
        const m = last(c);
        const mine = m.from === _me;
        return `<button class="msg-conv${c.unread ? ' unread' : ''}" onclick="openThread('${escapeAttr(c.uid)}')">
            <span class="msg-conv-top">
                <span class="msg-conv-name">${escapeHtml(c.username)}</span>
                ${c.unread ? `<span class="msg-unread">${c.unread} NEW</span>` : ''}
                <span class="msg-conv-time">${escapeHtml(shortTime(m.createdAt))}</span>
            </span>
            <span class="msg-conv-snippet">${mine ? 'You: ' : ''}${escapeHtml(snippet(m.body))}</span>
        </button>`;
    }).join('');
}

window.showNewMessage = function() {
    const p = document.getElementById('newMsgPicker');
    p.style.display = p.style.display === 'none' ? '' : 'none';
};

window.startConversation = function() {
    const uid = document.getElementById('composeToSelect').value;
    if (!uid) return;
    document.getElementById('newMsgPicker').style.display = 'none';
    openThread(uid);
};

// ── Thread ────────────────────────────────────────────────────────────────────
window.openThread = function(uid) {
    _openUid = uid;
    document.getElementById('convListView').style.display = 'none';
    document.getElementById('threadView').style.display   = '';
    document.getElementById('composeMsg').textContent = '';
    renderThread(true);
    const box = document.getElementById('composeBody');
    if (box && window.matchMedia('(pointer: fine)').matches) box.focus();
};

window.closeThread = function() {
    _openUid = null;
    document.getElementById('threadView').style.display   = 'none';
    document.getElementById('convListView').style.display = '';
    renderList();
};

function renderThread(scrollToEnd) {
    const uid = _openUid;
    const msgs = _all.filter(m => (m.from === uid && m.to === _me) || (m.from === _me && m.to === uid));
    const friend = _friends.find(f => f.uid === uid);
    const name = (friend && friend.username) || (msgs.length ? otherOf(msgs[msgs.length - 1]).username : '?');
    document.getElementById('threadName').textContent = name;

    const box = document.getElementById('threadMessages');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    if (!msgs.length) {
        box.innerHTML = '<div class="lb-empty">NO MESSAGES YET — SAY HELLO</div>';
    } else {
        let html = '', lastDay = '';
        msgs.forEach(m => {
            const day = dayLabel(m.createdAt);
            if (day !== lastDay) { html += `<div class="msg-day">${escapeHtml(day)}</div>`; lastDay = day; }
            const mine = m.from === _me;
            html += `<div class="msg-bubble-row ${mine ? 'mine' : 'theirs'}">
                <div class="msg-bubble">
                    <div class="msg-text">${escapeHtml(m.body)}</div>
                    <div class="msg-meta">
                        <span>${escapeHtml(timeOnly(m.createdAt))}${mine ? (m.read ? ' · Read' : ' · Sent') : ''}</span>
                        <button class="msg-del" onclick="doDeleteMessage('${escapeAttr(m.id)}')" title="Delete for both of you" aria-label="Delete for both of you">✕</button>
                    </div>
                </div>
            </div>`;
        });
        box.innerHTML = html;
    }
    if (scrollToEnd || atBottom) box.scrollTop = box.scrollHeight;

    // Replies only to current friends (as the old compose list allowed)
    document.getElementById('replyBox').style.display     = friend ? '' : 'none';
    document.getElementById('replyBlocked').style.display = friend ? 'none' : '';

    // Mark only this conversation's messages to me as read
    const unread = msgs.filter(m => m.to === _me && !m.read);
    if (unread.length && document.visibilityState === 'visible') {
        unread.forEach(m => { m.read = true; window.markMessageRead(m.id); });
        updateBadge();
        renderList();
    }
}

// Opening the page in the background shouldn't mark messages read; do it on return
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && _openUid) renderThread(); });

// ── Sending ───────────────────────────────────────────────────────────────────
window.doSendMessage = async function() {
    const textarea  = document.getElementById('composeBody');
    const status    = document.getElementById('composeMsg');
    const btn       = document.getElementById('sendBtn');
    const friend    = _friends.find(f => f.uid === _openUid);
    const body      = textarea.value.trim();

    if (!friend) { status.style.color = '#ff4500'; status.textContent = 'YOU CAN ONLY MESSAGE FRIENDS'; return; }
    if (!body)   { status.style.color = '#ff4500'; status.textContent = 'MESSAGE CANNOT BE EMPTY'; return; }

    status.style.color = ''; status.textContent = 'SENDING...';
    btn.disabled = true;
    try {
        const result = await window.sendMessage(friend.uid, friend.username, body);
        if (result && result.success) {
            textarea.value = '';
            updateCharCount(textarea);
            status.textContent = '';
            if (!_stopWatch) fallbackLoad();   // live view picks it up otherwise
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
    if (!confirm('Delete this message for both of you?\n\nIt will disappear from both your conversation and theirs. This can\'t be undone.')) return;
    const result = await window.deleteMessage(id);
    if (result && result.success) {
        if (!_stopWatch) fallbackLoad();
    } else {
        alert('Could not delete the message.');
    }
};

// ── Formatting ────────────────────────────────────────────────────────────────
function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(str) { return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
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
