import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
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

let currentUser = null;
let syncTimeout = null;

// ── Push local data up to Firestore ──────────────────────────────────────────
async function pushToCloud(user) {
    const payload = { updatedAt: Date.now() };
    DATA_KEYS.forEach(k => {
        const raw = localStorage.getItem(k);
        payload[k] = raw ? JSON.parse(raw) : null;
    });
    const dpData = payload.draftPunkData;
    payload.totalWords  = (dpData && dpData.total) || 0;
    payload.displayName = user.displayName || '';
    payload.photoURL    = user.photoURL    || '';
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
        <h2 style="color:var(--neon,#e8e8e8);margin-bottom:8px;letter-spacing:2px;">CHOOSE A USERNAME</h2>
        <p style="font-size:0.75rem;opacity:0.5;letter-spacing:1px;margin-bottom:24px;text-align:center;max-width:320px;">
            This is how you'll appear on leaderboards and to friends.<br>
            Letters, numbers and _ only. 3–20 characters.
        </p>
        <input id="dpUsernameInput" type="text" maxlength="20" placeholder="USERNAME"
            style="width:100%;max-width:320px;margin-bottom:8px;
                   font-family:'Courier New',monospace;font-size:1rem;
                   background:var(--panel,#161616);border:1px solid var(--border,#2a2a2a);
                   color:var(--text,#fff);padding:10px;text-transform:uppercase;letter-spacing:2px;"
            oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9_]/g,'')">
        <p id="dpUsernameError" style="color:#ff4500;font-size:0.75rem;height:1.4em;margin-bottom:12px;letter-spacing:1px;"></p>
        <button id="dpUsernameBtn" onclick="window._dpSubmitUsername()"
            style="width:100%;max-width:320px;
                   background:var(--neon,#e8e8e8);color:var(--bg,#0a0a0a);
                   font-family:'Courier New',monospace;font-weight:900;
                   font-size:0.85rem;letter-spacing:2px;padding:12px;
                   border:none;cursor:pointer;">
            CONFIRM USERNAME
        </button>
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
                username:    name,
                displayName: currentUser.displayName || '',
                photoURL:    currentUser.photoURL    || '',
                totalWords:  0,
                friends:     []
            }, { merge: true });
            await batch.commit();

            overlay.style.display = 'none';
            onComplete();
        } catch (err) {
            errorEl.textContent = 'Error — try again.';
            console.error(err);
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
        const dpData = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
        if (!dpData.active && window.showProjectForm) window.showProjectForm();
        // Social housekeeping — run in background
        checkPendingRequests(user);
        processFriendAcceptances(user);
    }
}

// ── Auth state changes ────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
    currentUser = user;
    updateNavUI(user);
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
    localStorage.setItem('justSignedOut', '1');
    window.location.href = 'index.html?' + Date.now();
};

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

window.getLeaderboard = async function() {
    if (!currentUser) return { error: 'not-signed-in' };
    try {
        const q    = query(collection(db, 'users'), orderBy('totalWords', 'desc'), limit(25));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ uid: d.id, ...d.data() })).filter(u => u.username);
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

window.getCurrentUsername = async function() {
    if (!currentUser) return null;
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    return snap.exists() ? snap.data().username : null;
};
