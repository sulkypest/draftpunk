import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, deleteUser }
    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
    getFirestore, doc, setDoc, getDoc, deleteDoc, writeBatch,
    collection, query, orderBy, limit, where, getDocs, arrayUnion, arrayRemove, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { initializeAppCheck, ReCaptchaV3Provider }
    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js';

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

// ── App Check — prevents API abuse from scripts / bots ────────────────────────
// 1. Go to https://www.google.com/recaptcha/admin/create
// 2. Choose reCAPTCHA v3, add draft-punk.com as a domain
// 3. Copy the site key and paste below
// 4. In Firebase console → App Check → Apps → register your web app
const RECAPTCHA_KEY = '6LfWQZ4sAAAAAMnYSJFsFsCDB2PCHCBFAkwyvT3z';
if (RECAPTCHA_KEY !== 'YOUR_RECAPTCHA_V3_SITE_KEY') {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = true; // prints debug token to console
    }
    initializeAppCheck(app, {
        provider:                 new ReCaptchaV3Provider(RECAPTCHA_KEY),
        isTokenAutoRefreshEnabled: true
    });
}

const DATA_KEYS = ['draftPunkData', 'beatNotesData', 'charactersData', 'wordRunnerData', 'notesData', 'dpStreak'];

// ── Period boundaries for the public week/month/year counts ──────────────────
// Each writer's counters reset at their own local midnight (Monday for the
// week). A writer's stored counts are only cleared when they next open the
// app, so a profile can still hold last week's total after the week is over.
// To keep group and leaderboard comparisons fair, each push records when its
// counts expire (in the writer's own local time), and readers show 0 once that
// moment has passed.
function _dpWeekKey() {
    const d = new Date();
    const day = d.getDay() || 7;
    d.setDate(d.getDate() + 4 - day);
    const yr = new Date(d.getFullYear(), 0, 1);
    return d.getFullYear() + '-W' + Math.ceil(((d - yr) / 86400000 + 1) / 7);
}
function _dpMonthKey() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function _dpYearKey()  { return '' + new Date().getFullYear(); }
function _dpWeekStart() {               // this Monday, 00:00 local
    const d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() || 7) - 1));
    return d;
}
function _dpPeriodBounds() {
    const now = new Date();
    const weekStart  = _dpWeekStart();
    const weekEnd    = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const yearStart  = new Date(now.getFullYear(), 0, 1);
    const yearEnd    = new Date(now.getFullYear() + 1, 0, 1);
    return {
        wordsThisWeek:  { start: weekStart.getTime(),  end: weekEnd.getTime(),  endField: 'weekEndsAt'  },
        wordsThisMonth: { start: monthStart.getTime(), end: monthEnd.getTime(), endField: 'monthEndsAt' },
        wordsThisYear:  { start: yearStart.getTime(),  end: yearEnd.getTime(),  endField: 'yearEndsAt'  },
    };
}
// The count to show for someone else's profile: 0 if it belongs to a period
// that has already ended. Profiles saved before this change have no end
// marker, so fall back to "last saved before this period began" (viewer's clock).
function _dpCurrentCount(u, field) {
    const b = _dpPeriodBounds()[field];
    const val = u[field] || 0;
    if (!b) return val;                                  // totalWords: never resets
    const endsAt = u[b.endField];
    if (typeof endsAt === 'number' && endsAt > 0) return Date.now() < endsAt ? val : 0;
    return (u.updatedAt || 0) >= b.start ? val : 0;
}

// Notifications live in push.js, loaded on demand so that if it ever fails to
// load, syncing carries on unaffected.
let _pushModule = null;
function loadPush() {
    if (!_pushModule) _pushModule = import('./push.js').catch(err => { console.warn('Notifications unavailable:', err); return null; });
    return _pushModule;
}
// Called by the Write page and dashboard after words are saved
window.dpOfferNotifications = function() {
    if (!currentUser) return;
    loadPush().then(m => {
        if (!m) return;
        m.initPush(app, () => auth.currentUser);
        m.maybeOfferNotifications().catch(() => {});
    });
};

let currentUser = undefined; // undefined = auth not yet resolved; null = resolved, not signed in
let syncTimeout = null;

// ── Push local data up to Firestore ──────────────────────────────────────────
async function pushToCloud(user) {
    // Stamp the cloud copy with the SAME timestamp the local copy carries, so
    // after a push the two compare as equal. (Previously this used Date.now(),
    // which made the cloud look newer than local after every push — the next
    // load would then pull a stale cloud copy over fresh local changes, e.g.
    // wiping a project created just before the push could run.)
    let stamp = parseInt(localStorage.getItem('dpLastUpdated') || '0');
    if (!stamp) {
        stamp = Date.now();
        _setItem('dpLastUpdated', String(stamp));
    }
    const payload = { updatedAt: stamp };
    DATA_KEYS.forEach(k => {
        const raw = localStorage.getItem(k);
        payload[k] = raw ? JSON.parse(raw) : null;
    });
    // Compute totals across all projects for leaderboard fields
    const dpData   = payload.draftPunkData || {};
    const projects = Object.values(dpData.projects || {});
    payload.totalWords     = projects.reduce((s, p) => s + (p.total          || 0), 0);
    // Only count a project's period words if they belong to the current period
    // (a project that hasn't been opened since the week rolled over still holds
    // last week's figure locally until its own reset runs).
    const wk = _dpWeekKey(), mo = _dpMonthKey(), yr = _dpYearKey();
    payload.wordsThisWeek  = projects.reduce((s, p) => s + (p.lastWeekReset  === wk ? (p.wordsThisWeek  || 0) : 0), 0);
    payload.wordsThisMonth = projects.reduce((s, p) => s + (p.lastMonthReset === mo ? (p.wordsThisMonth || 0) : 0), 0);
    payload.wordsThisYear  = projects.reduce((s, p) => s + (p.lastYearReset  === yr ? (p.wordsThisYear  || 0) : 0), 0);
    const bounds = _dpPeriodBounds();
    payload.weekEndsAt     = bounds.wordsThisWeek.end;
    payload.monthEndsAt    = bounds.wordsThisMonth.end;
    payload.yearEndsAt     = bounds.wordsThisYear.end;
    payload.displayName    = user.displayName || '';
    payload.photoURL       = user.photoURL    || '';
    await setDoc(doc(db, 'users', user.uid), payload, { merge: true });

    // PRIVACY MIGRATION, STEP 2 (copy only): also keep an identical copy of the
    // private material, with the same timestamp, in an owner-only record. The
    // profile copy above is unchanged and still complete. If this copy can't be
    // saved, nothing else is affected.
    const privatePayload = { updatedAt: stamp };
    DATA_KEYS.forEach(k => { privatePayload[k] = payload[k]; });
    try {
        await setDoc(doc(db, 'users', user.uid, 'private', 'data'), privatePayload, { merge: true });
        await verifyPrivateCopy(user, privatePayload);
    } catch (err) {
        console.warn('Private copy not saved (profile copy is fine):', err);
    }
    setSyncStatus('synced');
}

// Once per visit, read the private copy back and check it matches exactly what
// was just saved. If it does, stamp the profile with privateCopyVerifiedAt so
// it's visible in the Firestore console which writers are safely migrated
// (needed before the old copy can ever be removed). Only that one field is
// written — updatedAt and everything else in the profile are untouched.
let privateCopyVerified = false;
// JSON with object keys sorted, so the comparison doesn't depend on the order
// Firestore happens to return fields in
function canonical(v) {
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
    return JSON.stringify(v);
}
async function verifyPrivateCopy(user, expected) {
    if (privateCopyVerified) return;
    const snap = await getDoc(doc(db, 'users', user.uid, 'private', 'data'));
    if (!snap.exists()) return;
    const saved = snap.data();
    const same = (saved.updatedAt === expected.updatedAt) &&
        DATA_KEYS.every(k => canonical(saved[k] ?? null) === canonical(expected[k] ?? null));
    if (!same) { console.warn('Private copy did not match; not marking as verified.'); return; }
    await setDoc(doc(db, 'users', user.uid), { privateCopyVerifiedAt: Date.now() }, { merge: true });
    privateCopyVerified = true;
}

// ── Pull cloud data down; returns true if page needs a reload ─────────────────
async function pullFromCloud(user) {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) {
        await pushToCloud(user);
        return false;
    }
    // Use whichever cloud copy is newer: the profile copy, or the owner-only
    // private copy (step 2 of the privacy migration). When they're equal, or the
    // private copy is missing or can't be read, the profile copy is used,
    // exactly as before.
    let cloud = snap.data();
    try {
        const privSnap = await getDoc(doc(db, 'users', user.uid, 'private', 'data'));
        if (privSnap.exists()) {
            const priv = privSnap.data();
            if ((priv.updatedAt || 0) > (cloud.updatedAt || 0)) cloud = priv;
        }
    } catch (err) {
        console.warn('Private copy not read (using profile copy):', err);
    }
    const localTime = parseInt(localStorage.getItem('dpLastUpdated') || '0');
    const cloudTime = cloud.updatedAt || 0;

    if (cloudTime > localTime) {
        // Cancel any pending push and use the raw _setItem to bypass the
        // localStorage override — otherwise each key set triggers schedulePush,
        // which pushes to Firestore with updatedAt=now, making the cloud newer
        // again on the next load and causing an infinite reload loop.
        clearTimeout(syncTimeout);
        syncTimeout = null;
        DATA_KEYS.forEach(k => {
            if (cloud[k] != null) _setItem(k, JSON.stringify(cloud[k]));
        });
        // Record the cloud's stamp (not "now") so local and cloud now match.
        _setItem('dpLastUpdated', String(cloudTime));
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

// On page close, cancel the debounce so it doesn't fire after the page is gone.
// localStorage is always current (every change is written synchronously via the
// setItem override), so the next session will push it to cloud on sign-in.
window.addEventListener('beforeunload', () => {
    if (syncTimeout) clearTimeout(syncTimeout);
});

const _setItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(key, value) {
    _setItem(key, value);
    if (!DATA_KEYS.includes(key)) return;
    if (currentUser) {
        schedulePush();
    } else if (currentUser === undefined && localStorage.getItem('dpUserId')) {
        // Signed-in user, but Firebase auth hasn't resolved yet on this page
        // load. Still stamp the change so pullFromCloud treats local as newer
        // and pushes it, rather than overwriting it with the older cloud copy.
        _setItem('dpLastUpdated', Date.now().toString());
    }
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
    loadPush().then(m => { if (m) m.initPush(app, () => auth.currentUser); });

    let hasUsername = false;
    try {
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        hasUsername = userSnap.exists() && userSnap.data().username;
    } catch (e) {
        console.warn('Could not check username (Firestore unavailable):', e);
        // Fall through — treat as if username exists so we don't block the user
        hasUsername = true;
    }

    if (!hasUsername) {
        showUsernamePrompt(() => continueAfterAuth(user));
    } else {
        continueAfterAuth(user);
    }
}

async function continueAfterAuth(user) {
    let needsReload = false;
    try {
        needsReload = await pullFromCloud(user);
    } catch (e) {
        console.warn('pullFromCloud failed, using local data:', e);
        setSyncStatus('error');
    }

    if (needsReload && !window.location.pathname.includes('write.html')) {
        location.reload();
    } else {
        const dpData    = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
        const hasActive = dpData.activeProjectId &&
                          dpData.projects &&
                          dpData.projects[dpData.activeProjectId] &&
                          dpData.projects[dpData.activeProjectId].active;
        if (hasActive && (window.goHome || window.showDashboard)) (window.goHome || window.showDashboard)();
        else if (!hasActive && window.showProjectForm) window.showProjectForm();
        try {
            checkPendingRequests(user);
            processFriendAcceptances(user);
            checkUnreadMessages(user);
        } catch (e) {
            console.warn('Non-critical post-auth check failed:', e);
        }
    }
}

// ── Auth state changes ────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
    currentUser = user; // null when not signed in, User object when signed in
    updateNavUI(user);
    // Let other scripts (e.g. groups.js) react to auth state
    document.dispatchEvent(new CustomEvent('dpAuthChanged', { detail: { user } }));
    if (user) {
        try {
            await handleSignedIn(user);
        } catch (e) {
            console.error('handleSignedIn failed:', e);
            // Last-resort fallback: show whatever local data we have
            const dpData    = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
            const hasActive = dpData.activeProjectId && dpData.projects &&
                              dpData.projects[dpData.activeProjectId]?.active;
            if (hasActive && (window.goHome || window.showDashboard)) (window.goHome || window.showDashboard)();
            else if (window.showProjectForm) window.showProjectForm();
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
    // Flush any pending debounced changes BEFORE wiping local data.
    if (currentUser && syncTimeout) {
        clearTimeout(syncTimeout);
        syncTimeout = null;
        try { await pushToCloud(currentUser); } catch (e) { console.warn('Pre-signout push failed', e); }
    }
    // Stop this device getting the signed-out writer's notifications
    try { const m = await loadPush(); if (m) await m.forgetThisDevice(); } catch (e) { /* not set up */ }
    await signOut(auth);
    // Clear all local data so the next user (or same user on next sign-in)
    // starts clean — prevents stale data flashing before auth resolves.
    DATA_KEYS.forEach(k => localStorage.removeItem(k));
    localStorage.removeItem('dpLastUpdated');
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

            <div id="dpNotifySection"></div>

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
    loadPush().then(m => {
        if (!m) return;
        m.initPush(app, () => auth.currentUser);
        m.renderNotificationSettings(document.getElementById('dpNotifySection')).catch(() => {});
    });

    window._dpResetCloudData = async function() {
        if (!confirm('Reset all cloud data? Your local data will be preserved but your cloud backup will be wiped.')) return;
        const btn = document.getElementById('dpResetBtn');
        btn.disabled = true; btn.textContent = 'RESETTING...';
        try {
            // Delete chapters, Writing Record figures and share links
            const owned = await collectOwnedDocRefs(user.uid);
            await deleteShareLinks(owned.shareIds);
            await deleteInBatches(owned.refs);
            const batch = writeBatch(db);
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
            // Groups, shared chapters and messages first (needs the private
            // group history, which is removed with the rest below)
            await deleteSocialData(user.uid);
            // Delete chapters, Writing Record figures and share links
            const owned = await collectOwnedDocRefs(user.uid);
            await deleteShareLinks(owned.shareIds);
            await deleteInBatches(owned.refs);
            const batch = writeBatch(db);
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
        // Query directly by the requested field so period leaderboards
        // aren't limited to users who happen to have high total words.
        const q    = query(collection(db, 'users'), orderBy(field, 'desc'), limit(50));
        const snap = await getDocs(q);
        // Counts from a period that has already ended show as 0 (and drop off),
        // even if that writer hasn't opened the app since to reset them.
        return snap.docs
            .map(d => { const u = { uid: d.id, ...d.data() }; u[field] = _dpCurrentCount(u, field); return u; })
            .filter(u => u.username && (u[field] || 0) > 0)
            .sort((a, b) => (b[field] || 0) - (a[field] || 0))
            .slice(0, 25);
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

// ── Writing Record (evidence of how text was entered) ─────────────────────────
// Each device writes only its own figures (devices.<deviceId>), merged into one
// document per chapter, so devices never overwrite each other.
window.pushEvidenceToCloud = async function(chapterId, meta, deviceId, counters) {
    if (!currentUser) return;
    try {
        await setDoc(doc(db, 'users', currentUser.uid, 'evidence', chapterId),
            { ...meta, devices: { [deviceId]: counters }, updatedAt: Date.now() }, { merge: true });
    } catch (err) { console.warn('Writing Record push error:', err); }
};

window.pullEvidenceFromCloud = async function(projectId) {
    if (!currentUser) return null;
    const snap = await getDocs(collection(db, 'users', currentUser.uid, 'evidence'));
    return snap.docs.map(d => ({ ...d.data(), id: d.id })).filter(d => d.projectId === projectId);
};

// Read-only share links: a snapshot of the report (figures only, no chapter
// text) that anyone with the link can view.
window.createEvidenceShare = async function(snapshot) {
    if (!currentUser) throw new Error('Sign in to create a share link.');
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
    await setDoc(doc(db, 'evidenceShares', id), { ...snapshot, uid: currentUser.uid, createdAt: Date.now() });
    // Private list of this writer's share links, so account deletion can remove them
    // (share links can't be searched for). Kept in the owner-only evidence area.
    await setDoc(doc(db, 'users', currentUser.uid, 'evidence', '_shares'), { ids: arrayUnion(id) }, { merge: true });
    return id;
};
window.updateEvidenceShare = async function(id, snapshot) {
    if (!currentUser) throw new Error('Sign in to update the share link.');
    await setDoc(doc(db, 'evidenceShares', id), { ...snapshot, uid: currentUser.uid, createdAt: Date.now() });
};
window.deleteEvidenceShare = async function(id) {
    if (!currentUser) throw new Error('Sign in to stop sharing.');
    await deleteDoc(doc(db, 'evidenceShares', id));
    try { await setDoc(doc(db, 'users', currentUser.uid, 'evidence', '_shares'), { ids: arrayRemove(id) }, { merge: true }); } catch (e) {}
};

// Every cloud document belonging to this writer that sits outside the user doc:
// chapters, Writing Record figures, and Writing Record share links.
async function collectOwnedDocRefs(uid) {
    const refs = [];
    const writingSnap  = await getDocs(collection(db, 'users', uid, 'writing'));
    writingSnap.docs.forEach(d => refs.push(d.ref));
    // Private copy of notes/projects (privacy migration) and the version index
    const privateSnap  = await getDocs(collection(db, 'users', uid, 'private'));
    const chapterIds   = new Set(writingSnap.docs.map(d => d.id));
    privateSnap.docs.forEach(d => {
        if (d.id === 'versionIndex') (d.data().chapterIds || []).forEach(c => chapterIds.add(c));
        refs.push(d.ref);
    });
    // Saved versions of every chapter, including chapters since deleted
    for (const cid of chapterIds) {
        const vs = await getDocs(collection(db, 'users', uid, 'writing', cid, 'versions'));
        vs.docs.forEach(d => refs.push(d.ref));
    }
    const evidenceSnap = await getDocs(collection(db, 'users', uid, 'evidence'));
    const shareIds = new Set();
    evidenceSnap.docs.forEach(d => {
        if (d.id === '_shares') (d.data().ids || []).forEach(i => shareIds.add(i));
        refs.push(d.ref);
    });
    // Share links created on this device (also covers any made before the list existed)
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('dpRecordShare_')) { const v = localStorage.getItem(k); if (v) shareIds.add(v); }
    }
    return { refs, shareIds: [...shareIds] };
}

// Social data for account deletion: leave groups (deleting those I created),
// remove my messages in every group I've been in, chapters I've shared, and
// direct messages to or from me. Each step is tolerant: anything already gone
// or not removable is skipped so it can't block the rest.
async function deleteSocialData(uid) {
    const tryDo = async f => { try { await f(); } catch (e) { console.warn('Account deletion step skipped:', e); } };
    let groupIds = new Set();
    await tryDo(async () => {
        const h = await getDoc(doc(db, 'users', uid, 'private', 'groupHistory'));
        if (h.exists()) (h.data().ids || []).forEach(id => groupIds.add(id));
    });
    let current = [];
    await tryDo(async () => {
        const snap = await getDocs(query(collection(db, 'groups'), where('members', 'array-contains', uid)));
        current = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        current.forEach(g => groupIds.add(g.id));
    });
    for (const g of current) {
        if (g.ownerId === uid) {
            await tryDo(async () => {
                const msgs = await getDocs(collection(db, 'groups', g.id, 'messages'));
                await deleteInBatches(msgs.docs.map(d => d.ref));
                await deleteDoc(doc(db, 'groups', g.id));
            });
        }
    }
    for (const gid of groupIds) {
        await tryDo(async () => {
            const mine = await getDocs(query(collection(db, 'groups', gid, 'messages'), where('from', '==', uid)));
            await deleteInBatches(mine.docs.map(d => d.ref));
        });
    }
    for (const g of current) {
        if (g.ownerId !== uid) await tryDo(() => setDoc(doc(db, 'groups', g.id), { members: arrayRemove(uid) }, { merge: true }));
    }
    await tryDo(async () => {
        const shares = await getDocs(query(collection(db, 'shares'), where('ownerId', '==', uid)));
        await deleteInBatches(shares.docs.map(d => d.ref));
    });
    for (const field of ['from', 'to']) {
        await tryDo(async () => {
            const msgs = await getDocs(query(collection(db, 'messages'), where(field, '==', uid)));
            await deleteInBatches(msgs.docs.map(d => d.ref));
        });
    }
}

// Remove share links one at a time: one that's already gone (or isn't this
// writer's) is refused by the rules, and must not stop everything else.
async function deleteShareLinks(ids) {
    for (const id of ids) {
        try { await deleteDoc(doc(db, 'evidenceShares', id)); } catch (e) { /* already gone */ }
    }
}

// Firestore batches hold at most 500 writes, so delete in chunks
async function deleteInBatches(refs) {
    for (let i = 0; i < refs.length; i += 400) {
        const batch = writeBatch(db);
        refs.slice(i, i + 400).forEach(r => batch.delete(r));
        await batch.commit();
    }
}
window.getEvidenceShare = async function(id) {
    const snap = await getDoc(doc(db, 'evidenceShares', id));
    return snap.exists() ? snap.data() : null;
};

// ── Version history (owner-only, under each chapter) ──────────────────────────
// users/{uid}/writing/{chapterId}/versions/{versionId}. A private index of
// chapters that have versions is kept so account deletion can find versions
// of chapters that were themselves deleted.
window.pushVersionToCloud = async function(chapterId, v) {
    if (!currentUser) return false;
    const { stored, ...data } = v;
    await setDoc(doc(db, 'users', currentUser.uid, 'writing', chapterId, 'versions', v.id), data);
    try { await setDoc(doc(db, 'users', currentUser.uid, 'private', 'versionIndex'), { chapterIds: arrayUnion(chapterId) }, { merge: true }); } catch (e) {}
    return true;
};
window.listCloudVersions = async function(chapterId) {
    if (!currentUser) return [];
    const snap = await getDocs(collection(db, 'users', currentUser.uid, 'writing', chapterId, 'versions'));
    return snap.docs.map(d => d.data());
};
window.deleteCloudVersion = async function(chapterId, versionId) {
    if (!currentUser) return;
    await deleteDoc(doc(db, 'users', currentUser.uid, 'writing', chapterId, 'versions', versionId));
};

// ── Writing groups ────────────────────────────────────────────────────────────
// groups/{id}: { name, ownerId, ownerUsername, members: [uids], memberNames:
// { uid: username }, createdAt }. groups/{id}/messages/{id}: { from,
// fromUsername, body, createdAt }. Read status lives in the owner-only
// users/{uid}/private/groupReads; groups ever joined are listed in
// users/{uid}/private/groupHistory so account deletion can find them.
const GROUP_MAX = 12;

async function myUsername() {
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    return snap.exists() ? (snap.data().username || '') : '';
}

window.createGroup = async function(name, friends) {
    if (!currentUser) return { error: 'Not signed in.' };
    const me = currentUser.uid;
    const members = [me, ...friends.map(f => f.uid).filter(u => u !== me)].slice(0, GROUP_MAX);
    const memberNames = { [me]: await myUsername() };
    friends.forEach(f => { if (members.includes(f.uid)) memberNames[f.uid] = f.username; });
    try {
        const ref = doc(collection(db, 'groups'));
        await setDoc(ref, { name: String(name).trim().slice(0, 60) || 'Writing group', ownerId: me,
                            ownerUsername: memberNames[me], members, memberNames, createdAt: Date.now() });
        return { success: true, id: ref.id };
    } catch (err) { return { error: err.message }; }
};

// Live list of my groups. Also records each group in my private history.
window.watchGroups = function(callback, onError) {
    if (!currentUser) return () => {};
    const uid = currentUser.uid;
    const seen = new Set();
    return onSnapshot(query(collection(db, 'groups'), where('members', 'array-contains', uid)), snap => {
        const groups = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const fresh = groups.map(g => g.id).filter(id => !seen.has(id));
        fresh.forEach(id => seen.add(id));
        if (fresh.length) {
            setDoc(doc(db, 'users', uid, 'private', 'groupHistory'), { ids: arrayUnion(...fresh) }, { merge: true }).catch(() => {});
        }
        callback(groups);
    }, err => { if (onError) onError(err); });
};

window.getMyGroups = async function() {
    if (!currentUser) return [];
    try {
        const snap = await getDocs(query(collection(db, 'groups'), where('members', 'array-contains', currentUser.uid)));
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) { return { error: err.message }; }
};

// Creator only: rename, or set the member list
window.updateGroup = async function(groupId, changes) {
    if (!currentUser) return { error: 'Not signed in.' };
    try {
        const snap = await getDoc(doc(db, 'groups', groupId));
        if (!snap.exists()) return { error: 'Group not found.' };
        const g = snap.data();
        const next = { ...g };
        if (changes.name != null) next.name = String(changes.name).trim().slice(0, 60) || g.name;
        if (changes.members) {
            next.members = [currentUser.uid, ...changes.members.map(m => m.uid).filter(u => u !== currentUser.uid)].slice(0, GROUP_MAX);
            const names = { ...(g.memberNames || {}) };
            changes.members.forEach(m => { names[m.uid] = m.username; });
            Object.keys(names).forEach(u => { if (!next.members.includes(u)) delete names[u]; });
            next.memberNames = names;
        }
        await setDoc(doc(db, 'groups', groupId), next);
        return { success: true };
    } catch (err) { return { error: err.message }; }
};

window.leaveGroup = async function(groupId) {
    if (!currentUser) return { error: 'Not signed in.' };
    try {
        await setDoc(doc(db, 'groups', groupId), { members: arrayRemove(currentUser.uid) }, { merge: true });
        return { success: true };
    } catch (err) { return { error: err.message }; }
};

// Creator only: removes every message, then the group
window.deleteGroup = async function(groupId) {
    if (!currentUser) return { error: 'Not signed in.' };
    try {
        const msgs = await getDocs(collection(db, 'groups', groupId, 'messages'));
        await deleteInBatches(msgs.docs.map(d => d.ref));
        await deleteDoc(doc(db, 'groups', groupId));
        return { success: true };
    } catch (err) { return { error: err.message }; }
};

window.watchGroupMessages = function(groupId, callback, onError) {
    if (!currentUser) return () => {};
    return onSnapshot(collection(db, 'groups', groupId, 'messages'), snap => {
        const list = snap.docs.map(d => ({ id: d.id, groupId, ...d.data() }));
        list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        callback(list);
    }, err => { if (onError) onError(err); });
};

window.sendGroupMessage = async function(groupId, body) {
    if (!currentUser) return { error: 'Not signed in.' };
    try {
        await setDoc(doc(collection(db, 'groups', groupId, 'messages')), {
            from: currentUser.uid, fromUsername: await myUsername(),
            body: String(body).trim().slice(0, 500), createdAt: Date.now()
        });
        return { success: true };
    } catch (err) { return { error: err.message }; }
};

window.deleteGroupMessage = async function(groupId, messageId) {
    if (!currentUser) return { error: 'Not signed in.' };
    try { await deleteDoc(doc(db, 'groups', groupId, 'messages', messageId)); return { success: true }; }
    catch (err) { return { error: err.message }; }
};

window.getGroupReads = async function() {
    if (!currentUser) return {};
    try { const s = await getDoc(doc(db, 'users', currentUser.uid, 'private', 'groupReads')); return s.exists() ? s.data() : {}; }
    catch (err) { return {}; }
};
window.markGroupRead = async function(groupId, time) {
    if (!currentUser) return;
    try { await setDoc(doc(db, 'users', currentUser.uid, 'private', 'groupReads'), { [groupId]: time }, { merge: true }); } catch (err) {}
};

// Word counts for each member (profile totals are already public to signed-in writers)
window.getGroupStats = async function(group) {
    const rows = await Promise.all((group.members || []).map(async uid => {
        try {
            const s = await getDoc(doc(db, 'users', uid));
            const d = s.exists() ? s.data() : {};
            return { uid, username: d.username || (group.memberNames || {})[uid] || '?',
                     totalWords: d.totalWords || 0,
                     wordsThisWeek:  _dpCurrentCount(d, 'wordsThisWeek'),
                     wordsThisMonth: _dpCurrentCount(d, 'wordsThisMonth'),
                     wordsThisYear:  _dpCurrentCount(d, 'wordsThisYear'),
                     updatedAt: d.updatedAt || 0 };
        } catch (e) { return { uid, username: (group.memberNames || {})[uid] || '?', totalWords: 0, wordsThisWeek: 0, wordsThisMonth: 0, wordsThisYear: 0 }; }
    }));
    return rows;
};

// Share a chapter with every current member of a group (an ordinary share,
// labelled with the group; members who join later don't get it automatically)
window.createGroupShare = async function({ projectId, projectTitle, chapterId, chapterTitle, content, wordCount, group }) {
    if (!currentUser) return { error: 'Not signed in.' };
    try {
        const others = (group.members || []).filter(u => u !== currentUser.uid);
        if (!others.length) return { error: 'There is no one else in this group yet.' };
        await setDoc(doc(db, 'shares', `${currentUser.uid}_${chapterId}_group_${group.id}`), {
            ownerId: currentUser.uid, ownerUsername: await myUsername(),
            projectId, projectTitle, chapterId, chapterTitle, content, wordCount,
            sharedWith: others,
            sharedWithUsernames: others.map(u => (group.memberNames || {})[u] || '?'),
            groupId: group.id, groupName: group.name,
            updatedAt: Date.now()
        });
        return { success: true };
    } catch (err) { return { error: err.message }; }
};

window.getCurrentUsername = async function() {
    if (!currentUser) return null;
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    return snap.exists() ? snap.data().username : null;
};

// ── Messaging ─────────────────────────────────────────────────────────────────

window.sendMessage = async function(toUid, toUsername, body) {
    if (!currentUser) return { error: 'Not signed in.' };
    try {
        const snap         = await getDoc(doc(db, 'users', currentUser.uid));
        const fromUsername = snap.exists() ? (snap.data().username || '') : '';
        const msgRef       = doc(collection(db, 'messages'));
        await setDoc(msgRef, {
            from:         currentUser.uid,
            to:           toUid,
            fromUsername,
            toUsername,
            body:         body.trim().slice(0, 500),
            read:         false,
            createdAt:    Date.now()
        });
        return { success: true };
    } catch (err) {
        return { error: err.message };
    }
};

window.getInbox = async function() {
    if (!currentUser) return [];
    try {
        const q    = query(collection(db, 'messages'), where('to', '==', currentUser.uid));
        const snap = await getDocs(q);
        const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return msgs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch (err) {
        return { error: err.message };
    }
};

window.getSent = async function() {
    if (!currentUser) return [];
    try {
        const q    = query(collection(db, 'messages'), where('from', '==', currentUser.uid));
        const snap = await getDocs(q);
        const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return msgs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch (err) {
        return { error: err.message };
    }
};

// Live view of every message to or from the signed-in writer. Calls back with
// the full combined list (newest last) whenever anything changes. Read-only.
// Returns a function that stops listening.
window.watchMessages = function(callback, onError) {
    if (!currentUser) return () => {};
    const uid = currentUser.uid;
    let incoming = [], outgoing = [], ready = { in: false, out: false };
    const emit = () => {
        if (!ready.in || !ready.out) return;
        const all = [...incoming, ...outgoing];
        all.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        callback(all);
    };
    const asList = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const fail = err => { if (onError) onError(err); };
    const stopIn  = onSnapshot(query(collection(db, 'messages'), where('to', '==', uid)),
        snap => { incoming = asList(snap); ready.in = true; emit(); }, fail);
    const stopOut = onSnapshot(query(collection(db, 'messages'), where('from', '==', uid)),
        snap => { outgoing = asList(snap); ready.out = true; emit(); }, fail);
    return () => { stopIn(); stopOut(); };
};

window.markMessageRead = async function(messageId) {
    if (!currentUser) return;
    try {
        await setDoc(doc(db, 'messages', messageId), { read: true }, { merge: true });
    } catch (err) { /* silent */ }
};

window.deleteMessage = async function(messageId) {
    if (!currentUser) return { error: 'Not signed in.' };
    try {
        await deleteDoc(doc(db, 'messages', messageId));
        return { success: true };
    } catch (err) {
        return { error: err.message };
    }
};

async function checkUnreadMessages(user) {
    try {
        const q    = query(collection(db, 'messages'), where('to', '==', user.uid), where('read', '==', false));
        const snap = await getDocs(q);
        updateMessageBadge(snap.size);
    } catch (err) { /* silent */ }
}

function updateMessageBadge(count) {
    document.querySelectorAll('a[href="messages.html"]').forEach(link => {
        link.textContent = count > 0 ? `MESSAGES (${count})` : 'MESSAGES';
        link.style.color = count > 0 ? 'var(--neon)' : '';
    });
}
window.updateMessageBadge = updateMessageBadge;

// ── Chapter sharing ────────────────────────────────────────────────────────────

window.createShare = async function({ projectId, projectTitle, chapterId, chapterTitle, content, wordCount, sharedWithUid, sharedWithUsername }) {
    if (!currentUser) return { error: 'Not signed in.' };
    try {
        const snap         = await getDoc(doc(db, 'users', currentUser.uid));
        const ownerUsername = snap.exists() ? (snap.data().username || '') : '';

        // Re-use same shareId per owner+chapter+recipient so re-shares just update
        const shareId = `${currentUser.uid}_${chapterId}_${sharedWithUid}`;
        await setDoc(doc(db, 'shares', shareId), {
            ownerId:             currentUser.uid,
            ownerUsername,
            projectId,
            projectTitle,
            chapterId,
            chapterTitle,
            content,
            wordCount,
            sharedWith:          [sharedWithUid],
            sharedWithUsernames: [sharedWithUsername],
            updatedAt:           Date.now()
        });
        return { success: true };
    } catch (err) {
        return { error: err.message };
    }
};

window.getSharedWithMe = async function() {
    if (!currentUser) return [];
    try {
        const q    = query(collection(db, 'shares'), where('sharedWith', 'array-contains', currentUser.uid));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
        return { error: err.message };
    }
};

window.deleteShare = async function(shareId) {
    if (!currentUser) return { error: 'Not signed in.' };
    try {
        await deleteDoc(doc(db, 'shares', shareId));
        return { success: true };
    } catch (err) {
        return { error: err.message };
    }
};

window.getMySharesForChapter = async function(chapterId) {
    if (!currentUser) return [];
    try {
        const q    = query(collection(db, 'shares'),
                           where('ownerId',   '==', currentUser.uid),
                           where('chapterId', '==', chapterId));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
        return [];
    }
};
