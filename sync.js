import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, doc, setDoc, getDoc }
    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

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
    await setDoc(doc(db, 'users', user.uid), payload, { merge: true });
    setSyncStatus('synced');
}

// ── Pull cloud data down; returns true if page needs a reload ─────────────────
async function pullFromCloud(user) {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) {
        await pushToCloud(user); // first sign-in — push local data up
        return false;
    }
    const cloud     = snap.data();
    const localTime = parseInt(localStorage.getItem('dpLastUpdated') || '0');
    const cloudTime = cloud.updatedAt || 0;

    if (cloudTime > localTime) {
        // Cloud is newer — pull it down
        DATA_KEYS.forEach(k => {
            if (cloud[k] != null) localStorage.setItem(k, JSON.stringify(cloud[k]));
        });
        localStorage.setItem('dpLastUpdated', cloudTime.toString());
        return true;
    } else {
        // Local is newer — push it up
        await pushToCloud(user);
        return false;
    }
}

// ── Debounced push triggered whenever app data changes ────────────────────────
function schedulePush() {
    if (!currentUser) return;
    localStorage.setItem('dpLastUpdated', Date.now().toString());
    setSyncStatus('pending');
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => pushToCloud(currentUser), 2500);
}
window.schedulePush = schedulePush;

// Intercept localStorage writes so any data change auto-syncs
const _setItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(key, value) {
    _setItem(key, value);
    if (DATA_KEYS.includes(key) && currentUser) schedulePush();
};

// ── Auth state changes ────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
    currentUser = user;
    updateNavUI(user);
    if (user) {
        localStorage.setItem('authDecisionMade', '1');
        const authScreen = document.getElementById('authScreen');
        if (authScreen) authScreen.style.display = 'none';
        setSyncStatus('pending');
        const needsReload = await pullFromCloud(user);
        if (needsReload) {
            location.reload();
        } else {
            const dpData = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
            if (!dpData.active && window.showProjectForm) window.showProjectForm();
        }
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
    localStorage.removeItem('authDecisionMade');
    localStorage.setItem('justSignedOut', '1');
    await signOut(auth);
};

// ── Update the nav to reflect signed-in state ─────────────────────────────────
function updateNavUI(user) {
    const signInEl = document.getElementById('navSignIn');
    const userEl   = document.getElementById('navUserInfo');
    const avatarEl = document.getElementById('navAvatar');
    const nameEl   = document.getElementById('navUserName');

    const dashPrompt = document.getElementById('dashSignInPrompt');

    if (user) {
        if (signInEl)   signInEl.style.display   = 'none';
        if (userEl)     userEl.style.display      = 'flex';
        if (dashPrompt) dashPrompt.style.display  = 'none';
        if (avatarEl && user.photoURL) avatarEl.src = user.photoURL;
        if (nameEl)     nameEl.innerText = (user.displayName || 'USER').split(' ')[0].toUpperCase();
    } else {
        if (signInEl)   signInEl.style.display   = 'flex';
        if (userEl)     userEl.style.display      = 'none';
        if (dashPrompt) dashPrompt.style.display  = 'block';
        setSyncStatus(null);
    }
}

// ── Sync status dot ───────────────────────────────────────────────────────────
function setSyncStatus(state) {
    const dot = document.getElementById('syncDot');
    if (!dot) return;
    if (state === 'synced')  { dot.style.background = 'var(--neon)';  dot.title = 'Synced'; }
    if (state === 'pending') { dot.style.background = '#ffa500';      dot.title = 'Syncing…'; }
    if (!state)              { dot.style.background = 'transparent';  dot.title = ''; }
}
