import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, deleteUser }
    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
    getFirestore, doc, setDoc, getDoc, deleteDoc, writeBatch,
    collection, query, orderBy, limit, where, getDocs, arrayUnion, arrayRemove
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
    apiKey:            "AIzaSyA6UdbZT_t5gNuhQ3W6mMgzxrsB9y87ozE",
    authDomain:        "draft-punk-a0735.firebaseapp.com",
    projectId:         "draft-punk-a0735",
    storageBucket:     "draft-punk-a0735.firebasestorage.app",
    messagingSenderId: "771798680673",
    appId:             "1:771798680673:web:65cf1424be555814d4d620"
};

const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const db       = getFirestore(app);
const provider = new GoogleAuthProvider();

const DATA_KEYS = ['draftPunkData', 'beatNotesData', 'charactersData', 'wordRunnerData'];

let currentUser = undefined; // undefined = auth not yet resolved; null = resolved, not signed in
let syncTimeout = null;

// ── Push local data up to Firestore ──────────────────────────────────────────
async function pushToCloud(user) {
    const payload = { updatedAt: Date.now() };
    DATA_KEYS.forEach(k => {
        const raw = localStorage.getItem(k);
        payload[k] = raw ? JSON.parse(raw) : null;
    });
    // Compute totals across all projects for leaderboard fields
    const dpData   = payload.draftPunkData || {};
    const projects = Object.values(dpData.projects || {});
    payload.totalWords     = projects.reduce((s, p) => s + (p.total          || 0), 0);
    payload.wordsThisWeek  = projects.reduce((s, p) => s + (p.wordsThisWeek  || 0), 0);
    payload.wordsThisMonth = projects.reduce((s, p) => s + (p.wordsThisMonth || 0), 0);
    payload.wordsThisYear  = projects.reduce((s, p) => s + (p.wordsThisYear  || 0), 0);
    payload.displayName    = user.displayName || '';
    payload.photoURL       = user.photoURL    || '';
    await setDoc(doc(db, 'users', user.uid), payload, { merge: true });
    setSyncStatus('synced');
}

// ── Pull cloud data down; returns true if page needs a reload ─────────────────
async function pullFromCloud(user) {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) {
        await pushToCloud(user);
        return false;
    }
    const cloud     = snap.data();
    const localTime = parseInt(localStorage.getItem('dpLastUpdated') || '0');
    const cloudTime = cloud.updatedAt || 0;

    if (cloudTime > localTime) {
        DATA_KEYS.forEach(k => {
            if (cloud[k] != null) localStorage.setItem(k, JSON.stringify(cloud[k]));
        });
        localStorage.setItem('dpLastUpdated', cloudTime.toString());
        return true;
    } else {
        await pushToCloud(user);
        return false;
    }
}

// ── Debounced push ────────────────────────────────────────────────────────────
function schedulePush() {
    if (!currentUser) return;
    localStorage.setItem('dpLastUpdated', Date.now().toString());
    setSyncStatus('pending');
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => pushToCloud(currentUser), 2500);
}
window.schedulePush = schedulePush;

// Flush any pending sync immediately when the page is closing
window.addEventListener('beforeunload', () => {
    if (currentUser && syncTimeout) {
        clearTimeout(syncTimeout);
        pushToCloud(currentUser);
    }
});

const _setItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(key, value) {
    _setItem(key, value);
    if (DATA_KEYS.includes(key) && currentUser) schedulePush();
};

// ── Username prompt ───────────────────────────────────────────────────────────
function showUsernamePrompt(onComplete) {
    let overlay = document.getElementById('dpUsernameOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'dpUsernameOverlay';
        document.body.appendChild(overlay);
    }
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:600;
        background:var(--bg,#0a0a0a);
        display:flex;flex-direction:column;
        align-items:center;justify-content:center;
        padding:20px;font-family:'Courier New',monospace;
        color:var(--text,#fff);
    `;
    overlay.innerHTML = `
        <div style="width:100%;max-width:340px;padding:0 10px;box-sizing:border-box;">
            <h2 style="color:var(--neon,#e8e8e8);margin:0 0 8px;letter-spacing:2px;font-size:1.1rem;">CHOOSE A USERNAME</h2>
            <p style="font-size:0.72rem;opacity:0.5;letter-spacing:1px;margin:0 0 20px;line-height:1.6;">
                This is how you'll appear on leaderboards and to friends.<br>
                Letters, numbers and _ only. 3–20 characters.
            </p>
            <input id="dpUsernameInput" type="text" maxlength="20" placeholder="USERNAME"
                style="width:100%;box-sizing:border-box;margin-bottom:6px;
                       font-family:'Courier New',monospace;font-size:0.9rem;
                       background:var(--panel,#161616);border:1px solid var(--border,#2a2a2a);
                       color:var(--text,#fff);padding:10px;text-transform:uppercase;letter-spacing:2px;"
                oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9_]/g,'')">
            <p id="dpUsernameError" style="color:#ff4500;font-size:0.72rem;height:1.2em;margin:0 0 10px;letter-spacing:1px;"></p>
            <button id="dpUsernameBtn" onclick="window._dpSubmitUsername()"
                style="width:100%;box-sizing:border-box;
                       background:var(--neon,#e8e8e8);color:var(--bg,#0a0a0a);
                       font-family:'Courier New',monospace;font-weight:900;
                       font-size:0.85rem;letter-spacing:2px;padding:12px;
                       border:none;cursor:pointer;">
                CONFIRM USERNAME
            </button>
        </div>
    `;

    window._dpSubmitUsername = async function() {
        const input   = document.getElementById('dpUsernameInput');
        const errorEl = document.getElementById('dpUsernameError');
        const btn     = document.getElementById('dpUsernameBtn');
        const name    = input.value.trim();

        if (name.length < 3) { errorEl.textContent = 'Must be at least 3 characters.'; return; }

        btn.disabled        = true;
        btn.textContent     = 'CHECKING...';
        errorEl.textContent = '';

        try {
            const existing = await getDoc(doc(db, 'usernames', name));
            if (existing.exists() && existing.data().uid !== currentUser.uid) {
                errorEl.textContent = 'Username taken. Try another.';
                btn.disabled        = false;
                btn.textContent     = 'CONFIRM USERNAME';
                return;
            }

            const batch = writeBatch(db);
            batch.set(doc(db, 'usernames', name), { uid: currentUser.uid });
            batch.set(doc(db, 'users', currentUser.uid), {
                username:       name,
                displayName:    currentUser.displayName || '',
                photoURL:       currentUser.photoURL    || '',
                totalWords:     0,
                wordsThisWeek:  0,
                wordsThisMonth: 0,
                wordsThisYear:  0,
                friends:        []
            }, { merge: true });
            await batch.commit();

            overlay.style.display = 'none';
            onComplete();
        } catch (err) {
            console.error('Username save error:', err);
            errorEl.textContent = err.code === 'permission-denied'
                ? 'Permission denied — check Firestore rules.'
                : (err.message || 'Error — try again.');
            btn.disabled    = false;
            btn.textContent = 'CONFIRM USERNAME';
        }
    };
}

// ── Friend request badge ──────────────────────────────────────────────────────
function updateRequestBadge(count) {
    const btn = document.querySelector('[onclick*="toggleDraftMenu"]');
    if (!btn) return;
    let badge = btn.querySelector('.nav-badge');
    if (count > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'nav-badge';
            btn.appendChild(badge);
        }
        badge.textContent = count;
    } else {
        if (badge) badge.remove();
    }
}
window.updateRequestBadge = updateRequestBadge;

// ── Check & process social notifications ─────────────────────────────────────
async function checkPendingRequests(user) {
    try {
        const q    = query(collection(db, 'friendRequests'), where('to', '==', user.uid));
        const snap = await getDocs(q);
        updateRequestBadge(snap.size);
    } catch (err) { /* silent */ }
}

// When a friend accepts your request they write a friendAcceptance so you
// can add them back to your own friends array (cross-user write workaround).
async function processFriendAcceptances(user) {
    try {
        const q    = query(collection(db, 'friendAcceptances'), where('addTo', '==', user.uid));
        const snap = await getDocs(q);
        if (snap.empty) return;

        const batch = writeBatch(db);
        const newFriends = [];
        snap.docs.forEach(d => {
            newFriends.push(d.data().addFriend);
            batch.delete(doc(db, 'friendAcceptances', d.id));
        });
        batch.set(doc(db, 'users', user.uid),
            { friends: arrayUnion(...newFriends) }, { merge: true });
        await batch.commit();
    } catch (err) { /* silent */ }
}

// ── Post-sign-in flow ─────────────────────────────────────────────────────────
async function handleSignedIn(user) {
    localStorage.setItem('authDecisionMade', '1');
    const authScreen = document.getElementById('authScreen');
    if (authScreen) authScreen.style.display = 'none';
    setSyncStatus('pending');

    // If a different user was previously stored locally, wipe their data first
    const storedUid = localStorage.getItem('dpUserId');
    if (storedUid && storedUid !== user.uid) {
        DATA_KEYS.forEach(k => localStorage.removeItem(k));
        localStorage.removeItem('dpLastUpdated');
    }
    localStorage.setItem('dpUserId', user.uid);

    const userSnap    = await getDoc(doc(db, 'users', user.uid));
    const hasUsername = userSnap.exists() && userSnap.data().username;

    if (!hasUsername) {
        showUsernamePrompt(() => continueAfterAuth(user));
    } else {
        continueAfterAuth(user);
    }
}

async function continueAfterAuth(user) {
    const needsReload = await pullFromCloud(user);
    if (needsReload) {
        location.reload();
    } else {
        const dpData    = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
        const hasActive = dpData.activeProjectId &&
                          dpData.projects &&
                          dpData.projects[dpData.activeProjectId] &&
                          dpData.projects[dpData.activeProjectId].active;
        if (!hasActive && window.showProjectForm) window.showProjectForm();
        checkPendingRequests(user);
        processFriendAcceptances(user);
    }
}

// ── Auth state changes ────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
    currentUser = user; // null when not signed in, User object when signed in
    updateNavUI(user);
    // Let other scripts (e.g. groups.js) react to auth state
    document.dispatchEvent(new CustomEvent('dpAuthChanged', { detail: { user } }));
    if (user) {
        await handleSignedIn(user);
    } else if (localStorage.getItem('justSignedOut')) {
        localStorage.removeItem('justSignedOut');
        const authScreen = document.getElementById('authScreen');
        if (authScreen) {
            authScreen.style.display = 'flex';
            const nav = document.querySelector('.app-nav');
            if (nav) nav.style.display = 'none';
        } else {
            localStorage.setItem('justSignedOut', '1');
            window.location.href = 'index.html';
        }
    }
});

// ── Public sign-in / sign-out ─────────────────────────────────────────────────
window.signInWithGoogle = async function() {
    try {
        await signInWithPopup(auth, provider);
    } catch (err) {
        console.error('Sign-in error:', err.message);
        alert('Sign-in failed: ' + err.message);
    }
};

window.signOutUser = async function() {
    if (!confirm('Sign out?')) return;
    clearTimeout(syncTimeout);
    await signOut(auth);
    localStorage.removeItem('authDecisionMade');
    localStorage.removeItem('dpUserId');
    localStorage.setItem('justSignedOut', '1');
    window.location.href = 'index.html?' + Date.now();
};

// ── Account overlay ───────────────────────────────────────────────────────────
async function showAccountOverlay() {
    const user = currentUser;
    if (!user) return;

    const snap       = await getDoc(doc(db, 'users', user.uid));
    const data       = snap.exists() ? snap.data() : {};
    const username   = data.username || '—';
    const totalWords = (data.totalWords || 0).toLocaleString();

    let overlay = document.getElementById('dpAccountOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'dpAccountOverlay';
        document.body.appendChild(overlay);
    }

    overlay.style.cssText = `
        position:fixed;inset:0;z-index:600;background:rgba(0,0,0,0.85);
        display:flex;align-items:center;justify-content:center;padding:20px;
        font-family:'Courier New',monospace;color:var(--text,#fff);
    `;

    overlay.innerHTML = `
        <div style="width:100%;max-width:360px;background:var(--panel,#161616);
                    border:1px solid var(--border,#2a2a2a);padding:28px 24px;box-sizing:border-box;">
            <div style="text-align:center;margin-bottom:24px;">
                ${user.photoURL
                    ? `<img src="${user.photoURL}" style="width:72px;height:72px;border-radius:50%;border:2px solid var(--neon,#0ff);display:block;margin:0 auto 12px;">`
                    : `<div style="width:72px;height:72px;border-radius:50%;border:2px solid var(--neon,#0ff);margin:0 auto 12px;display:flex;align-items:center;justify-content:center;font-size:1.8rem;">◎</div>`
                }
                <div style="font-size:1rem;font-weight:900;letter-spacing:2px;">${(user.displayName || 'USER').toUpperCase()}</div>
                <div style="font-size:0.7rem;opacity:0.5;letter-spacing:1px;margin-top:4px;">@${username}</div>
                <div style="font-size:0.7rem;opacity:0.4;letter-spacing:1px;margin-top:4px;">${totalWords} WORDS WRITTEN</div>
            </div>

            <button onclick="signOutUser()" style="width:100%;margin-bottom:6px;">⊖ SIGN OUT</button>

            <div style="border-top:1px solid var(--border,#2a2a2a);margin:20px 0 16px;"></div>
            <div style="font-size:0.6rem;opacity:0.4;letter-spacing:2px;margin-bottom:12px;">DANGER ZONE</div>

            <button id="dpResetBtn" onclick="window._dpResetCloudData()"
                style="width:100%;margin-bottom:6px;background:#333;">
                ⚠ RESET CLOUD DATA
            </button>
            <p style="font-size:0.62rem;opacity:0.4;letter-spacing:1px;margin:0 0 14px;line-height:1.5;">
                Wipes your cloud backup. Local data is preserved. Useful for testing a fresh sign-up.
            </p>

            <button id="dpDeleteBtn" onclick="window._dpDeleteAccount()"
                style="width:100%;margin-bottom:6px;background:#ff4500;">
                ✕ DELETE ACCOUNT
            </button>
            <p style="font-size:0.62rem;opacity:0.4;letter-spacing:1px;margin:0 0 20px;line-height:1.5;">
                Permanently deletes your account, username, and all cloud data.
            </p>

            <button onclick="document.getElementById('dpAccountOverlay').style.display='none'"
                style="width:100%;background:#222;">CLOSE</button>

            <p id="dpAccountError" style="color:#ff4500;font-size:0.7rem;margin:10px 0 0;text-align:center;min-height:1.2em;letter-spacing:1px;"></p>
        </div>
    `;

    overlay.style.display = 'flex';

    window._dpResetCloudData = async function() {
        if (!confirm('Reset all cloud data? Your local data will be preserved but your cloud backup will be wiped.')) return;
        const btn = document.getElementById('dpResetBtn');
        btn.disabled = true; btn.textContent = 'RESETTING...';
        try {
            // Delete writing subcollection
            const writingSnap = await getDocs(collection(db, 'users', user.uid, 'writing'));
            const batch = writeBatch(db);
            writingSnap.docs.forEach(d => batch.delete(d.ref));
            // Reset user doc (keep username and auth fields, wipe data)
            batch.set(doc(db, 'users', user.uid), {
                username:    data.username || '',
                displayName: user.displayName || '',
                photoURL:    user.photoURL || '',
                totalWords: 0, wordsThisWeek: 0, wordsThisMonth: 0, wordsThisYear: 0,
                updatedAt:   0
            });
            await batch.commit();
            btn.textContent = 'RESET COMPLETE';
        } catch (err) {
            console.error(err);
            document.getElementById('dpAccountError').textContent = err.message || 'Error — try again.';
            btn.disabled = false; btn.textContent = '⚠ RESET CLOUD DATA';
        }
    };

    window._dpDeleteAccount = async function() {
        if (!confirm('Delete your account? This permanently removes your account, username, and all cloud data. This cannot be undone.')) return;
        const btn = document.getElementById('dpDeleteBtn');
        btn.disabled = true; btn.textContent = 'DELETING...';
        try {
            // Delete writing subcollection
            const writingSnap = await getDocs(collection(db, 'users', user.uid, 'writing'));
            const batch = writeBatch(db);
            writingSnap.docs.forEach(d => batch.delete(d.ref));
            // Delete username reservation
            if (data.username) batch.delete(doc(db, 'usernames', data.username));
            // Delete user doc
            batch.delete(doc(db, 'users', user.uid));
            await batch.commit();
            // Delete Firebase Auth account
            await deleteUser(user);
            // Clear local storage and redirect
            localStorage.clear();
            window.location.href = 'index.html?' + Date.now();
        } catch (err) {
            console.error(err);
            const msg = err.code === 'auth/requires-recent-login'
                ? 'Please sign out and sign back in, then try again.'
                : (err.message || 'Error — try again.');
            document.getElementById('dpAccountError').textContent = msg;
            btn.disabled = false; btn.textContent = '✕ DELETE ACCOUNT';
        }
    };
}
window.showAccountOverlay = showAccountOverlay;

// ── Nav UI ────────────────────────────────────────────────────────────────────
function updateNavUI(user) {
    const signInEl   = document.getElementById('navSignIn');
    const userEl     = document.getElementById('navUserInfo');
    const avatarEl   = document.getElementById('navAvatar');
    const nameEl     = document.getElementById('navUserName');
    const dashPrompt = document.getElementById('dashSignInPrompt');

    if (user) {
        if (signInEl)    signInEl.style.display  = 'none';
        if (userEl)      userEl.style.display     = 'flex';
        if (dashPrompt)  dashPrompt.style.display = 'none';
        if (avatarEl && user.photoURL) avatarEl.src = user.photoURL;
        if (nameEl) nameEl.innerText = (user.displayName || 'USER').split(' ')[0].toUpperCase();
        // Inject account button once
        if (userEl && !document.getElementById('dpAccountNavBtn')) {
            const btn = document.createElement('button');
            btn.id        = 'dpAccountNavBtn';
            btn.className = 'nav-dropdown-item';
            btn.textContent = '⊙ ACCOUNT';
            btn.onclick   = () => { showAccountOverlay(); if (window.toggleDataMenu) toggleDataMenu(); };
            userEl.appendChild(btn);
        }
    } else {
        if (signInEl)    signInEl.style.display  = 'flex';
        if (userEl)      userEl.style.display     = 'none';
        if (dashPrompt)  dashPrompt.style.display = 'block';
        setSyncStatus(null);
    }
}

// ── Sync status dot ───────────────────────────────────────────────────────────
function setSyncStatus(state) {
    const dot = document.getElementById('syncDot');
    if (!dot) return;
    if (state === 'synced')  { dot.style.background = 'var(--neon)'; dot.title = 'Synced'; }
    if (state === 'pending') { dot.style.background = '#ffa500';     dot.title = 'Syncing…'; }
    if (!state)              { dot.style.background = 'transparent'; dot.title = ''; }
}

// ── Social functions (used by groups.js) ──────────────────────────────────────

window.getCurrentUser = function() { return currentUser; };

window.getLeaderboard = async function(field = 'totalWords') {
    if (!currentUser) return { error: 'not-signed-in' };
    try {
        // Query by totalWords (guaranteed present on all users) to avoid
        // Firestore excluding docs where the period field is missing.
        // Sort client-side by the requested period field.
        const q    = query(collection(db, 'users'), orderBy('totalWords', 'desc'), limit(100));
        const snap = await getDocs(q);
        const users = snap.docs
            .map(d => ({ uid: d.id, ...d.data() }))
            .filter(u => u.username);
        users.sort((a, b) => (b[field] || 0) - (a[field] || 0));
        return users.slice(0, 25);
    } catch (err) {
        console.error('Leaderboard error:', err);
        return { error: err.message };
    }
};

window.getFriends = async function() {
    if (!currentUser) return { error: 'not-signed-in' };
    try {
        const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
        if (!userSnap.exists()) return [];
        const friends = userSnap.data().friends || [];
        if (friends.length === 0) return [];
        const results = await Promise.all(friends.map(uid => getDoc(doc(db, 'users', uid))));
        return results.filter(s => s.exists())
                      .map(s => ({ uid: s.id, ...s.data() }))
                      .filter(u => u.username);
    } catch (err) {
        return { error: err.message };
    }
};

// Send a friend request (does NOT add directly)
window.addFriend = async function(username) {
    if (!currentUser) return { error: 'Not signed in.' };
    try {
        const unameSnap = await getDoc(doc(db, 'usernames', username));
        if (!unameSnap.exists()) return { error: 'User not found.' };

        const toUid = unameSnap.data().uid;
        if (toUid === currentUser.uid) return { error: "That's you!" };

        // Already friends?
        const mySnap   = await getDoc(doc(db, 'users', currentUser.uid));
        const myData   = mySnap.exists() ? mySnap.data() : {};
        const friends  = myData.friends || [];
        if (friends.includes(toUid)) return { error: 'Already friends.' };

        // Already sent a request?
        const reqId     = `${currentUser.uid}_${toUid}`;
        const existing  = await getDoc(doc(db, 'friendRequests', reqId));
        if (existing.exists()) return { error: 'Request already sent.' };

        await setDoc(doc(db, 'friendRequests', reqId), {
            from:         currentUser.uid,
            to:           toUid,
            fromUsername: myData.username || '',
            toUsername:   username,
            createdAt:    Date.now()
        });
        return { success: true };
    } catch (err) {
        return { error: err.message };
    }
};

window.getPendingRequests = async function() {
    if (!currentUser) return { error: 'not-signed-in' };
    try {
        const q    = query(collection(db, 'friendRequests'), where('to', '==', currentUser.uid));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
        return { error: err.message };
    }
};

// Accept: add sender to our friends, write a friendAcceptance so they auto-add us back
window.acceptFriendRequest = async function(requestId, fromUid) {
    if (!currentUser) return { error: 'Not signed in.' };
    try {
        const mySnap     = await getDoc(doc(db, 'users', currentUser.uid));
        const myUsername = mySnap.exists() ? mySnap.data().username : '';

        const batch = writeBatch(db);
        // Add sender to our friends
        batch.set(doc(db, 'users', currentUser.uid),
            { friends: arrayUnion(fromUid) }, { merge: true });
        // Let the sender auto-add us back next time they sign in
        batch.set(doc(db, 'friendAcceptances', `${fromUid}_${currentUser.uid}`), {
            addTo:       fromUid,
            addFriend:   currentUser.uid,
            byUsername:  myUsername,
            createdAt:   Date.now()
        });
        // Delete the request
        batch.delete(doc(db, 'friendRequests', requestId));
        await batch.commit();

        // Update badge
        const q    = query(collection(db, 'friendRequests'), where('to', '==', currentUser.uid));
        const snap = await getDocs(q);
        updateRequestBadge(snap.size);

        return { success: true };
    } catch (err) {
        return { error: err.message };
    }
};

window.declineFriendRequest = async function(requestId) {
    if (!currentUser) return { error: 'Not signed in.' };
    try {
        await deleteDoc(doc(db, 'friendRequests', requestId));
        // Update badge
        const q    = query(collection(db, 'friendRequests'), where('to', '==', currentUser.uid));
        const snap = await getDocs(q);
        updateRequestBadge(snap.size);
        return { success: true };
    } catch (err) {
        return { error: err.message };
    }
};

window.removeFriend = async function(friendUid) {
    if (!currentUser) return { error: 'Not signed in.' };
    try {
        await setDoc(doc(db, 'users', currentUser.uid),
            { friends: arrayRemove(friendUid) }, { merge: true });
        return { success: true };
    } catch (err) {
        return { error: err.message };
    }
};

// ── Writing subcollection sync ─────────────────────────────────────────────────
window.pushWritingChapterToCloud = async function(chapter) {
    if (!currentUser) return;
    try {
        await setDoc(doc(db, 'users', currentUser.uid, 'writing', chapter.id), chapter, { merge: true });
    } catch (err) { console.error('Writing push error:', err); }
};

window.deleteWritingChapterFromCloud = async function(chapterId) {
    if (!currentUser) return;
    try {
        await deleteDoc(doc(db, 'users', currentUser.uid, 'writing', chapterId));
    } catch (err) { console.error('Writing delete error:', err); }
};

window.pullWritingFromCloud = async function(projectId) {
    if (!currentUser) return null;
    try {
        const snap = await getDocs(collection(db, 'users', currentUser.uid, 'writing'));
        const chapters = snap.docs
            .map(d => ({ ...d.data(), id: d.id }))
            .filter(ch => ch.projectId === projectId)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
        return chapters.length ? chapters : null;
    } catch (err) { console.error('Writing pull error:', err); return null; }
};

window.getCurrentUsername = async function() {
    if (!currentUser) return null;
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    return snap.exists() ? snap.data().username : null;
};
