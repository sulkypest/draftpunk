(function() {
    const d = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
    if (!d.active) window.location.replace('index.html');
})();

let groupsInitDone = false;

function waitForAuth() {
    const user = window.getCurrentUser && window.getCurrentUser();
    if (user === undefined) {
        setTimeout(waitForAuth, 100);
        return;
    }
    if (groupsInitDone) return;
    groupsInitDone = true;

    if (!user) {
        document.getElementById('groupsSignInGate').style.display = 'block';
        document.getElementById('groupsContent').style.display    = 'none';
    } else {
        document.getElementById('groupsSignInGate').style.display = 'none';
        document.getElementById('groupsContent').style.display    = 'block';
        loadAll();
    }
}

document.addEventListener('DOMContentLoaded', function() {
    waitForAuth();
    setTimeout(function() { if (!groupsInitDone) waitForAuth(); }, 2000);
});

function loadAll() {
    loadPendingRequests();
    loadFriends();
    loadLeaderboard();
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
            <span class="lb-name" style="flex:1;">${req.fromUsername || 'UNKNOWN'}</span>
            <button onclick="doAccept('${req.id}', '${req.from}')"
                style="font-size:0.7rem;padding:6px 10px;letter-spacing:1px;white-space:nowrap;">
                ✓ ACCEPT
            </button>
            <button onclick="doDecline('${req.id}')"
                style="font-size:0.7rem;padding:6px 10px;letter-spacing:1px;background:#333;white-space:nowrap;">
                ✕ DECLINE
            </button>
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
async function loadLeaderboard() {
    const container = document.getElementById('leaderboardList');
    if (!container) return;
    container.innerHTML = '<div class="lb-loading">LOADING...</div>';

    const result = await window.getLeaderboard();

    if (!result || result.error) {
        container.innerHTML = '<div class="lb-empty">COULD NOT LOAD LEADERBOARD</div>';
        return;
    }
    if (result.length === 0) {
        container.innerHTML = '<div class="lb-empty">NO ENTRIES YET — BE THE FIRST!</div>';
        return;
    }

    const currentUser = window.getCurrentUser();
    container.innerHTML = result.map((u, i) => `
        <div class="lb-row ${currentUser && u.uid === currentUser.uid ? 'lb-row-me' : ''}">
            <span class="lb-rank">#${i + 1}</span>
            <span class="lb-name">${u.username}</span>
            <span class="lb-words">${(u.totalWords || 0).toLocaleString()} WDS</span>
        </div>
    `).join('');
}

// ── Friends list ──────────────────────────────────────────────────────────────
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
        container.innerHTML = '<div class="lb-empty">NO FRIENDS YET — ADD SOME BELOW</div>';
        return;
    }

    const sorted = [...result].sort((a, b) => (b.totalWords || 0) - (a.totalWords || 0));
    container.innerHTML = sorted.map(u => `
        <div class="lb-row">
            <span class="lb-rank">✦</span>
            <span class="lb-name">${u.username}</span>
            <span class="lb-words">${(u.totalWords || 0).toLocaleString()} WDS</span>
            <button class="lb-remove-btn" onclick="doRemoveFriend('${u.uid}', '${u.username}')">✕</button>
        </div>
    `).join('');
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

// ── Remove friend ─────────────────────────────────────────────────────────────
window.doRemoveFriend = async function(uid, username) {
    if (!confirm('Remove ' + username + ' from friends?')) return;
    const result = await window.removeFriend(uid);
    if (result.success) loadFriends();
};
