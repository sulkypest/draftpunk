(function() {
    const _dp = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
    const _ok = _dp.activeProjectId && _dp.projects && _dp.projects[_dp.activeProjectId] && _dp.projects[_dp.activeProjectId].active;
    if (!_ok) window.location.replace('index.html');
})();

let _view = 'inbox';

// ── Auth ──────────────────────────────────────────────────────────────────────

function showGate() {
    document.getElementById('messagesGate').style.display    = 'block';
    document.getElementById('messagesContent').style.display = 'none';
}

function showContent() {
    document.getElementById('messagesGate').style.display    = 'none';
    document.getElementById('messagesContent').style.display = 'block';
    loadFriendsForCompose();
    loadMessages();
}

document.addEventListener('dpAuthChanged', function(e) {
    if (e.detail.user) showContent(); else showGate();
});

// Fallback if auth already resolved before listener registered
window.addEventListener('load', function() {
    const user = window.getCurrentUser && window.getCurrentUser();
    if (user)            showContent();
    else if (user === null) showGate();
    // if undefined, auth hasn't resolved yet — dpAuthChanged will fire
});

// ── Compose ───────────────────────────────────────────────────────────────────

async function loadFriendsForCompose() {
    const select = document.getElementById('composeToSelect');
    if (!select) return;
    select.innerHTML = '<option value="">LOADING...</option>';

    const friends = await window.getFriends();
    if (!friends || friends.error || friends.length === 0) {
        select.innerHTML = '<option value="">NO FRIENDS YET — ADD THEM IN WRITING GROUPS</option>';
        return;
    }
    select.innerHTML = '<option value="">— SELECT RECIPIENT —</option>' +
        friends.map(f => `<option value="${f.uid}" data-username="${f.username}">${f.username}</option>`).join('');
}

window.doSendMessage = async function() {
    const select    = document.getElementById('composeToSelect');
    const textarea  = document.getElementById('composeBody');
    const msg       = document.getElementById('composeMsg');
    const charCount = document.getElementById('composeCharCount');

    const uid      = select.value;
    const opt      = select.options[select.selectedIndex];
    const username = (opt && opt.dataset.username) || '';
    const body     = textarea.value.trim();

    if (!uid)  { msg.style.color = '#ff4500'; msg.textContent = 'SELECT A RECIPIENT'; return; }
    if (!body) { msg.style.color = '#ff4500'; msg.textContent = 'MESSAGE CANNOT BE EMPTY'; return; }

    msg.style.color = '';
    msg.textContent = 'SENDING...';

    try {
        const result = await window.sendMessage(uid, username, body);
        if (result && result.success) {
            textarea.value  = '';
            if (charCount) charCount.textContent = '0 / 500';
            msg.style.color = 'var(--neon)';
            msg.textContent = 'SENT!';
            setTimeout(() => { msg.textContent = ''; }, 2000);
        } else {
            msg.style.color = '#ff4500';
            msg.textContent = (result && result.error) || 'COULD NOT SEND';
        }
    } catch (err) {
        msg.style.color = '#ff4500';
        msg.textContent = err.message || 'COULD NOT SEND';
    }
};

window.updateCharCount = function(el) {
    const count = document.getElementById('composeCharCount');
    if (count) count.textContent = el.value.length + ' / 500';
};

// ── Inbox / Sent ──────────────────────────────────────────────────────────────

window.setView = function(view) {
    _view = view;
    document.querySelectorAll('.msg-tab').forEach(btn => {
        btn.classList.toggle('lb-period-active', btn.dataset.view === view);
    });
    loadMessages();
};

async function loadMessages() {
    const container = document.getElementById('messagesList');
    if (!container) return;
    container.innerHTML = '<div class="lb-loading">LOADING...</div>';

    const messages = _view === 'inbox'
        ? await window.getInbox()
        : await window.getSent();

    renderMessages(messages, container);

    if (_view === 'inbox' && Array.isArray(messages)) {
        const unread = messages.filter(m => !m.read);
        if (unread.length > 0) {
            setTimeout(async () => {
                await Promise.all(unread.map(m => window.markMessageRead(m.id)));
                if (window.updateMessageBadge) window.updateMessageBadge(0);
            }, 1000);
        }
    }
}

function renderMessages(messages, container) {
    if (!messages || messages.error) {
        container.innerHTML = '<div class="lb-empty">COULD NOT LOAD MESSAGES</div>';
        return;
    }
    if (messages.length === 0) {
        container.innerHTML = `<div class="lb-empty">${_view === 'inbox' ? 'INBOX EMPTY' : 'NO SENT MESSAGES'}</div>`;
        return;
    }

    container.innerHTML = messages.map(m => {
        const date     = new Date(m.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        const isUnread = _view === 'inbox' && !m.read;
        const who      = _view === 'inbox' ? (m.fromUsername || '?') : (m.toUsername || '?');
        return `
            <div class="lb-row" style="flex-direction:column;align-items:flex-start;gap:6px;padding:12px;${isUnread ? 'border-left:3px solid var(--neon);' : 'border-left:3px solid transparent;'}">
                <div style="display:flex;width:100%;align-items:center;gap:8px;">
                    <span style="flex:1;font-size:0.8rem;font-weight:900;letter-spacing:1px;${isUnread ? 'color:var(--neon);' : ''}">${escapeHtml(who)}</span>
                    <span style="font-size:0.65rem;opacity:0.4;letter-spacing:1px;white-space:nowrap;">${date}</span>
                    <button onclick="doDeleteMessage('${m.id}')" style="font-size:0.65rem;padding:4px 8px;background:#333;letter-spacing:1px;white-space:nowrap;">✕</button>
                </div>
                <div style="font-size:0.85rem;line-height:1.6;opacity:${isUnread ? '1' : '0.7'};white-space:pre-wrap;word-break:break-word;">${escapeHtml(m.body)}</div>
            </div>`;
    }).join('');
}

function escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

window.doDeleteMessage = async function(id) {
    const result = await window.deleteMessage(id);
    if (result && result.success) loadMessages();
};
