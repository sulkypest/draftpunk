import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, deleteUser,
    signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
    sendEmailVerification, signInWithCustomToken }
    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
    getFirestore, doc, setDoc, getDoc, deleteDoc, writeBatch, deleteField,
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

let _myLbUsername = '';           // set once known; used for the leaderboard record
let currentUser = undefined; // undefined = auth not yet resolved; null = resolved, not signed in
let syncTimeout = null;

// ── Sync: combine this device's data with the cloud's ───────────────────────
// Projects, notes, beat notes, characters, Word Runner and the streak are
// synced together. Every sync reads the cloud copy first and combines it with
// this device's copy (data-merge.js), using the copy both last agreed on (the
// "sync base", kept on this device) to tell which side changed what. So a
// change made on another device is never overwritten by this one, and the
// other way round. If the same item was changed on both, the newer version is
// used and the other is kept as a recovered copy (Account → Recovered copies).

const BASE_KEY = 'dpSyncBase';
function readBase(uid) {
    try { const b = JSON.parse(localStorage.getItem(BASE_KEY) || 'null'); return (b && b.uid === uid && b.data) ? b : null; }
    catch (e) { return null; }
}
function writeBase(uid, stamp, data) {
    try { _setItem(BASE_KEY, JSON.stringify({ uid, stamp, data })); }
    catch (e) {
        // Storage full: drop the base. The next sync then combines without it,
        // which never deletes anything (a deletion may come back once).
        try { localStorage.removeItem(BASE_KEY); } catch (e2) {}
        console.warn('Sync base not saved (storage full):', e);
    }
}
function readLocalData() {
    const data = {};
    DATA_KEYS.forEach(k => {
        const raw = localStorage.getItem(k);
        try { data[k] = raw ? JSON.parse(raw) : null; } catch (e) { data[k] = null; }
    });
    return data;
}
const hasAnyData = d => !!d && DATA_KEYS.some(k => d[k] != null);

// The cloud copy: the owner-only record, or (for writers who have never had
// one) the old copy in the profile. Returns null if the cloud holds no data.
// Throws if the owner-only record can't be read: syncing then waits rather
// than combining with something that might be out of date.
async function readCloud(user) {
    const pubSnap  = await getDoc(doc(db, 'users', user.uid));
    const privSnap = await getDoc(doc(db, 'users', user.uid, 'private', 'data'));
    const pub  = pubSnap.exists()  ? pubSnap.data()  : null;
    const priv = privSnap.exists() ? privSnap.data() : null;
    if (priv && hasAnyData(priv) && (!pub || !hasAnyData(pub) || (priv.updatedAt || 0) >= (pub.updatedAt || 0))) return priv;
    if (pub && hasAnyData(pub)) return pub;
    return null;
}

// Keep a recovered copy of anything that had to give way to a newer version.
async function saveRecoveries(user, recs, source) {
    if (!recs.length) return;
    const entry = { createdAt: Date.now(), source, items: recs };
    try {
        const list = JSON.parse(localStorage.getItem('dpRecovered') || '[]');
        list.push(entry);
        _setItem('dpRecovered', JSON.stringify(list.slice(-30)));
    } catch (e) { console.warn('Recovered copy not kept on this device:', e); }
    try {
        await setDoc(doc(db, 'users', user.uid, 'private', 'recovery-' + entry.createdAt + '-' + Math.random().toString(36).slice(2, 6)), entry);
    } catch (e) { console.warn('Recovered copy not saved to the cloud:', e); }
}

// Pages keep their own copy of this data in memory. If a sync brings in
// changes from another device while a page is open, the page's next save is
// combined with what's stored instead of overwriting it (see setItem below).
//
// Only for data a page keeps in memory and saves from memory. Other saves
// (e.g. the Write page) read what's stored just before saving, so they already
// include anything a sync brought in and are written as they are.
const PAGE_MEMORY_KEYS = {
    'notes.html': ['notesData'], 'beat-notes.html': ['beatNotesData'], 'characters.html': ['charactersData'],
    'wordrunner.html': ['wordRunnerData'], 'index.html': ['draftPunkData'], '': ['draftPunkData']
};
const pageMemoryKeys = PAGE_MEMORY_KEYS[location.pathname.split('/').pop()] || [];
const pageSeen = {};
DATA_KEYS.forEach(k => { pageSeen[k] = localStorage.getItem(k); });
let mergedSinceLoad = false;

// The one place this device and the cloud are combined. Returns true if this
// device's data changed (some pages then reload to show it).
async function syncNow(user) {
    // Without the merge code nothing is synced at all (never a blind overwrite)
    if (!window.DPDataMerge) throw new Error('Sync paused: data-merge.js not loaded');
    const cloud     = await readCloud(user);
    const local     = readLocalData();
    const base      = readBase(user.uid);
    const localTime = parseInt(localStorage.getItem('dpLastUpdated') || '0');

    if (!cloud) {                                    // nothing in the cloud yet
        const stamp = Date.now();
        await writeCloud(user, local, stamp);
        _setItem('dpLastUpdated', String(stamp));
        writeBase(user.uid, stamp, local);
        return false;
    }

    const cloudTime = cloud.updatedAt || 0;
    const cloudData = {};
    DATA_KEYS.forEach(k => { cloudData[k] = cloud[k] === undefined ? null : cloud[k]; });

    let result = local;
    if (!hasAnyData(local)) {
        // SAFETY: a device with no data at all (new device, cleared browser,
        // just signed in) takes the cloud copy as it is. An empty device is
        // never treated as "deleted everything".
        result = cloudData;
    } else if (!(base && base.stamp === cloudTime)) {       // the cloud changed since this device last synced
        result = {};
        const recs = [];
        DATA_KEYS.forEach(k => {
            const m = window.DPDataMerge.merge(k, base ? base.data[k] : undefined, local[k], cloudData[k], localTime > cloudTime);
            result[k] = m.value === undefined ? null : m.value;
            recs.push(...m.recoveries);
        });
        await saveRecoveries(user, recs, 'sync');
    }

    const eq = window.DPDataMerge.eq;
    const localChanged = DATA_KEYS.filter(k => !eq(result[k], local[k]));
    const cloudChanged = DATA_KEYS.some(k => !eq(result[k], cloudData[k]));

    if (localChanged.length) {
        clearTimeout(syncTimeout);
        syncTimeout = null;
        localChanged.forEach(k => _setItem(k, JSON.stringify(result[k])));
        mergedSinceLoad = true;
        document.dispatchEvent(new CustomEvent('dpDataMerged', { detail: { keys: localChanged } }));
    }
    if (cloudChanged) {
        const stamp = Date.now();
        await writeCloud(user, result, stamp);
        _setItem('dpLastUpdated', String(stamp));
        writeBase(user.uid, stamp, result);
    } else {
        _setItem('dpLastUpdated', String(cloudTime));
        writeBase(user.uid, cloudTime, result);
        // Already in step: still run the once-a-visit check of the owner-only
        // record (it counts towards removing the old public copy, PR #9).
        const expected = { updatedAt: cloudTime };
        DATA_KEYS.forEach(k => { expected[k] = result[k]; });
        try { await verifyPrivateCopy(user, expected); }
        catch (err) { console.warn('Private copy check failed (nothing removed):', err); }
        // Already in step: make sure the leaderboard shows these figures
        if (!leaderboardChecked) {
            leaderboardChecked = true;
            await updateLeaderboard(user, wordFigures(result), true);
        }
    }
    setSyncStatus('synced');
    return localChanged.length > 0;
}

async function pushToCloud(user) { await syncNow(user); }

async function writeCloud(user, data, stamp) {
    if (_suspended) return;   // suspended: nothing new is saved (the database would refuse it)
    // PRIVACY MIGRATION, STEP 3: projects, notes, beat notes, characters, Word
    // Runner and the streak are saved ONLY to the owner-only record. It's saved
    // first; if it fails, nothing else is written and the sync dot shows the
    // error (the work is still safe on this device).
    const privatePayload = { updatedAt: stamp };
    DATA_KEYS.forEach(k => { privatePayload[k] = data[k] === undefined ? null : data[k]; });
    await setDoc(doc(db, 'users', user.uid, 'private', 'data'), privatePayload, { merge: true });

    // The public profile now carries only what the leaderboard, groups and
    // friends need: word totals, period counts, name and photo. It no longer
    // carries updatedAt, so a cleared profile can never look newer than the
    // owner-only copy (to this code or to an older cached copy of the app).
    const payload = wordFigures(data);
    payload.displayName    = user.displayName || '';
    payload.photoURL       = user.photoURL    || '';
    await setDoc(doc(db, 'users', user.uid), payload, { merge: true });

    // Leaderboard record: username and word counts only, the one thing other
    // writers can read (Nov 2026; the profile above is now owner-only).
    // Never allowed to fail the save.
    await updateLeaderboard(user, payload, false);

    // Once per visit: read the owner-only record back, and only if it matches
    // exactly what was just saved, count towards removing the old public copy.
    try {
        await verifyPrivateCopy(user, privatePayload);
    } catch (err) {
        console.warn('Private copy check failed (nothing removed):', err);
    }
}

// Word totals and this week/month/year's words across all projects, as shown
// on the leaderboard, in groups and to friends.
function wordFigures(data) {
    const payload  = {};
    const dpData   = (data && data.draftPunkData) || {};
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
    return payload;
}

// Write the leaderboard record (Nov 2026 fix). Previously it was only written
// when this device changed the cloud copy, and skipped without a word if the
// username hadn't been looked up yet, so one missed write left groups and the
// leaderboard showing old figures until the writer next added words.
// Now the username is looked up if needed, and once per visit the record is
// checked against the (in-step) figures and rewritten if it's out of date.
// It only ever writes the figures already in the writer's own data; it never
// changes that data. Never throws.
let leaderboardChecked = false;
async function updateLeaderboard(user, figures, onlyIfDifferent) {
    if (_suspended) return;
    try {
        if (!_myLbUsername) {
            const s = await getDoc(doc(db, 'users', user.uid));
            if (s.exists() && s.data().username) _myLbUsername = s.data().username;
        }
        if (!_myLbUsername) return;            // no username yet: not on the leaderboard
        const rec = {
            username: _myLbUsername,
            totalWords: figures.totalWords, wordsThisWeek: figures.wordsThisWeek,
            wordsThisMonth: figures.wordsThisMonth, wordsThisYear: figures.wordsThisYear,
            weekEndsAt: figures.weekEndsAt, monthEndsAt: figures.monthEndsAt, yearEndsAt: figures.yearEndsAt
        };
        if (onlyIfDifferent) {
            const cur = await getDoc(doc(db, 'leaderboard', user.uid));
            if (cur.exists() && canonical(cur.data()) === canonical(rec)) return;
        }
        await setDoc(doc(db, 'leaderboard', user.uid), rec);
    } catch (e) { console.warn('Leaderboard update skipped:', e); }
}

// Once per visit, read the private copy back and check it matches exactly what
// was just saved. The public copy is removed only when this check has passed
// on two visits at least a day apart (cleanupFirstCheckAt, then
// publicCopyClearedAt, both visible in the Firestore console). If the check
// fails or can't run, nothing is removed and it's tried again next visit.
let privateCopyVerified = false;
const CLEANUP_WAIT_MS = 24 * 60 * 60 * 1000;   // a day between the two checks
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
    privateCopyVerified = true;
    // PRIVACY MIGRATION, STEP 3 (clean-up), deliberately slow: the old public
    // copy is removed only after the owner-only record has passed this exact
    // check on two separate visits at least a day apart. The first passing
    // visit only records the time; nothing is removed until a later visit,
    // 24 hours or more afterwards, passes the same check again.
    const now = Date.now();
    const pubSnap = await getDoc(doc(db, 'users', user.uid));
    const pub = pubSnap.exists() ? pubSnap.data() : {};
    if (pub.publicCopyClearedAt) return;                          // already done
    const first = pub.cleanupFirstCheckAt || 0;
    if (!first) {
        await setDoc(doc(db, 'users', user.uid), { privateCopyVerifiedAt: now, cleanupFirstCheckAt: now }, { merge: true });
        return;
    }
    if (now - first < CLEANUP_WAIT_MS) {
        await setDoc(doc(db, 'users', user.uid), { privateCopyVerifiedAt: now }, { merge: true });
        return;
    }
    // Second passing check, a day or more after the first: remove the six
    // private fields (and updatedAt) from the public profile, which any
    // signed-in user can read. Username, friends, word totals and everything
    // else in the profile are untouched.
    const clear = { privateCopyVerifiedAt: now, publicCopyClearedAt: now, updatedAt: deleteField() };
    DATA_KEYS.forEach(k => { clear[k] = deleteField(); });
    await setDoc(doc(db, 'users', user.uid), clear, { merge: true });
}

// ── Recovered copies (Account panel) ────────────────────────────────────────
// Shown only when there is something: versions of notes, characters etc. that
// gave way when the same thing was edited on two devices. Downloaded as plain text.
const RECOVERY_LABELS = { draftPunkData: 'Project data', notesData: 'Notes', beatNotesData: 'Beat notes',
                          charactersData: 'Characters', wordRunnerData: 'Word Runner', dpStreak: 'Streak' };
async function listRecoveries(user) {
    const found = {};
    try { JSON.parse(localStorage.getItem('dpRecovered') || '[]').forEach(e => { found[e.createdAt + ':' + JSON.stringify(e.items).length] = e; }); } catch (e) {}
    try {
        const snap = await getDocs(collection(db, 'users', user.uid, 'private'));
        snap.docs.filter(d => d.id.startsWith('recovery-')).forEach(d => { const e = d.data(); found[e.createdAt + ':' + JSON.stringify(e.items).length] = e; });
    } catch (e) { console.warn('Cloud recovered copies not read:', e); }
    return Object.values(found).sort((a, b) => a.createdAt - b.createdAt);
}
function recoveriesAsText(entries) {
    const lines = ['DRAFT PUNK — RECOVERED COPIES', 'When the same thing was edited on two devices, the newer edit was kept. These are the other versions.', ''];
    entries.forEach(e => (e.items || []).forEach(i => {
        const where = [RECOVERY_LABELS[i.key] || i.key].concat((i.path || []).slice(1)).join(' › ');
        const val = typeof i.other === 'string' ? i.other : JSON.stringify(i.other, null, 2);
        lines.push('── ' + new Date(e.createdAt).toLocaleString() + ' · ' + where, val, '');
    }));
    return lines.join('\n');
}
async function renderRecoverySection(user) {
    const el = document.getElementById('dpRecoverySection');
    if (!el) return;
    const entries = await listRecoveries(user);
    const count = entries.reduce((s, e) => s + (e.items || []).length, 0);
    if (!count) { el.innerHTML = ''; return; }
    el.innerHTML = `
        <div style="border-top:1px solid var(--border,#2a2a2a);margin:20px 0 12px;"></div>
        <div style="font-size:0.75rem;color:var(--text-dim);letter-spacing:2px;margin-bottom:8px;">RECOVERED COPIES (${count})</div>
        <p style="font-size:0.875rem;color:var(--text-dim);letter-spacing:1px;margin:0 0 8px;line-height:1.5;">
            When the same thing was edited on two devices, the newer edit was kept. These are the other versions.</p>
        <button class="btn-secondary" id="dpRecoveryBtn" style="width:100%;margin-bottom:6px;">⬇ DOWNLOAD RECOVERED COPIES</button>`;
    document.getElementById('dpRecoveryBtn').onclick = () => {
        const blob = new Blob([recoveriesAsText(entries)], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'draft-punk-recovered-copies.txt';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
}

// ── Pull cloud data down; returns true if page needs a reload ─────────────────
async function pullFromCloud(user) {
    try {
        return await syncNow(user);
    } catch (err) {
        // The cloud couldn't be read or written. This device keeps its data and
        // tries again on the next change or visit; nothing is overwritten.
        console.warn('Sync failed (work is safe on this device):', err);
        setSyncStatus('error');
        return false;
    }
}

// ── Debounced push ────────────────────────────────────────────────────────────
function schedulePush() {
    if (!currentUser) return;
    localStorage.setItem('dpLastUpdated', Date.now().toString());
    setSyncStatus('pending');
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => pushToCloud(currentUser).catch(err => {
        console.warn('Cloud backup failed (saved on this device):', err);
        setSyncStatus('error');
    }), 2500);
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
    if (DATA_KEYS.includes(key)) {
        const stored = localStorage.getItem(key);
        if (mergedSinceLoad && pageMemoryKeys.includes(key) && window.DPDataMerge && stored !== pageSeen[key] && stored !== value) {
            // A sync has brought in changes this page hasn't seen. Combine this
            // page's edit (made on top of what it last saw) with what's stored,
            // so the other device's changes aren't overwritten.
            try {
                const parse = v => (v == null ? null : JSON.parse(v));
                const m = window.DPDataMerge.merge(key, parse(pageSeen[key]), parse(value), parse(stored), true);
                pageSeen[key] = value;
                _setItem(key, JSON.stringify(m.value));
                if (m.recoveries.length && currentUser) saveRecoveries(currentUser, m.recoveries, 'page').catch(() => {});
            } catch (e) {
                console.warn('Could not combine page save; saving as-is:', e);
                pageSeen[key] = value;
                _setItem(key, value);
            }
        } else {
            pageSeen[key] = value;
            _setItem(key, value);
        }
    } else {
        _setItem(key, value);
    }
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
            <p style="font-size:0.875rem;color:var(--text-dim);letter-spacing:1px;margin:0 0 20px;line-height:1.6;">
                This is how you'll appear on leaderboards and to friends.<br>
                Letters, numbers and _ only. 3–20 characters.
            </p>
            <input id="dpUsernameInput" type="text" maxlength="20" placeholder="USERNAME"
                style="width:100%;box-sizing:border-box;margin-bottom:6px;
                       font-family:'Courier New',monospace;font-size:0.9rem;
                       background:var(--panel,#161616);border:1px solid var(--border,#2a2a2a);
                       color:var(--text,#fff);padding:10px;text-transform:uppercase;letter-spacing:2px;"
                oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9_]/g,'')">
            <p id="dpUsernameError" style="color:#ff4500;font-size:0.75rem;height:1.2em;margin:0 0 10px;letter-spacing:1px;"></p>
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
            _myLbUsername = name;

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

// ── Age and terms ────────────────────────────────────────────────────────────
// One step asking for month + year of birth and acceptance of the Terms and
// Privacy Policy, stored in users/{uid}/private/account. The database rules
// lock the birth date once given and use it to gate social features.
//   - Under 13, new account: Draft Punk can't be used (UK/EU consent age).
//   - Under 13, account from before the age step: treated as under 16 for now
//     (writing kept); Ross to decide what happens next.
//   - Under 16: no groups, messages, friend requests or chapter sharing.
//   - 16 and over: everything.
// Writing, the dashboard, Word Runner, the Writing Record and export are never
// blocked for anyone who already has an account.
const TERMS_VERSION = '2026-11';
const MIN_AGE = 16;            // social features
const MIN_AGE_ACCOUNT = 13;    // any new account
// Accounts created on or after this moment must answer before using the app.
// SET TO THE LIVE RELEASE DATE when this ships.
const AGE_STEP_START = Date.parse('2026-11-22T17:02:00Z');
const SOCIAL_PAGES = ['groups.html', 'messages.html'];
function isSocialPage() { return SOCIAL_PAGES.includes(location.pathname.split('/').pop()); }
function ageFromYM(y, m) {
    // Month precision only: during the birth month the birthday counts as not
    // yet reached (errs towards younger). The database rules use the same sum.
    const now = new Date();
    let a = now.getFullYear() - y;
    if (now.getMonth() + 1 <= m) a--;
    return a;
}
function isNewAccount(user) {
    const t = user && user.metadata && Date.parse(user.metadata.creationTime);
    return !!t && t >= AGE_STEP_START;
}
function readAccountCache() { try { return JSON.parse(localStorage.getItem('dpAccount') || 'null'); } catch (e) { return null; } }
window.dpAccount = {
    MIN_AGE: MIN_AGE,
    info() { return readAccountCache(); },
    accepted() { const a = readAccountCache(); return !!(a && a.birthYear && a.termsVersion === TERMS_VERSION); },
    age() { const a = readAccountCache(); return a && a.birthYear ? ageFromYM(a.birthYear, a.birthMonth) : null; },
    band() {
        const age = this.age();
        if (age === null) return null;
        return age < MIN_AGE ? 'under-min' : age < 18 ? 'teen' : 'adult';
    },
    blocked() { const a = readAccountCache(); const age = this.age(); return !!(a && a.newAccount && age !== null && age < MIN_AGE_ACCOUNT); },
    open() { showAccountPrompt({ dismissible: !isSocialPage() && !isNewAccount(currentUser) }); }
};
function cacheAccount(rec, user) {
    localStorage.setItem('dpAccount', JSON.stringify(rec
        ? { birthYear: rec.birthYear, birthMonth: rec.birthMonth, termsVersion: rec.termsVersion, newAccount: isNewAccount(user) }
        : null));
}
function applyAgeBand() {
    const under = window.dpAccount.band() === 'under-min';
    document.body.classList.toggle('dp-under-min', under);
    if (under) { updateRequestBadge(0); updateMessageBadge(0); }
    if (window.dpAccount.blocked()) showAccountBlocked();
}
document.addEventListener('DOMContentLoaded', () => { try { applyAgeBand(); } catch (e) {} });
async function checkAccount(user) {
    let acc = readAccountCache();
    try {
        const snap = await getDoc(doc(db, 'users', user.uid, 'private', 'account'));
        acc = snap.exists() ? snap.data() : null;
        cacheAccount(acc, user);
    } catch (e) {
        console.warn('Account check skipped (offline?):', e);
        if (!acc) return;   // can't tell; don't nag offline
    }
    applyAgeBand();
    if (window.dpAccount.blocked()) return;
    if (!window.dpAccount.accepted()) {
        // New accounts and the social pages must answer; existing writers
        // elsewhere can put it off for the session.
        const must = isSocialPage() || isNewAccount(user);
        if (must) showAccountPrompt({ dismissible: false });
        else if (!sessionStorage.getItem('dpAccountLater')) showAccountPrompt({ dismissible: true });
    } else if (isSocialPage() && window.dpAccount.band() === 'under-min') {
        showSocialClosed();
    }
}
function showSocialClosed() {
    if (document.getElementById('dpSocialClosed')) return;
    const o = document.createElement('div');
    o.id = 'dpSocialClosed';
    o.className = 'dp-acct-overlay';
    o.innerHTML = `<div class="dp-acct-box">
        <h2>Writing groups, messages and sharing are for writers ${MIN_AGE} and over</h2>
        <p>Everything else in Draft Punk works as normal: your projects, the dashboard, Word Runner and your Writing Record.</p>
        <a class="dp-acct-btn" href="write.html">BACK TO WRITING</a>
    </div>`;
    document.body.appendChild(o);
}
function showAccountBlocked() {
    if (document.getElementById('dpAcctBlocked')) return;
    const p = document.getElementById('dpAcctOverlay'); if (p) p.remove();
    const o = document.createElement('div');
    o.id = 'dpAcctBlocked';
    o.className = 'dp-acct-overlay';
    o.innerHTML = `<div class="dp-acct-box">
        <h2>Sorry, Draft Punk is for writers aged ${MIN_AGE_ACCOUNT} and over</h2>
        <p>You can't use this account. If you think this is a mistake, contact us through the details in our <a href="privacy.html">Privacy Policy</a>.</p>
        <button type="button" class="dp-acct-btn" id="dpAcctBlockedOut">SIGN OUT</button>
    </div>`;
    document.body.appendChild(o);
    o.querySelector('#dpAcctBlockedOut').onclick = async () => {
        try { await signOut(auth); } catch (e) {}
        location.href = 'index.html';
    };
}
function showAccountPrompt(opts) {
    if (document.getElementById('dpAcctOverlay') || document.getElementById('dpAcctBlocked')) return;
    const dismissible = !!(opts && opts.dismissible);
    const now = new Date();
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    let years = '';
    for (let y = now.getFullYear(); y >= now.getFullYear() - 110; y--) years += `<option value="${y}">${y}</option>`;
    const o = document.createElement('div');
    o.id = 'dpAcctOverlay';
    o.className = 'dp-acct-overlay';
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.setAttribute('aria-labelledby', 'dpAcctTitle');
    o.innerHTML = `<div class="dp-acct-box">
        <h2 id="dpAcctTitle">One quick thing</h2>
        <p>To finish setting up your account, tell us the month and year you were born and accept our terms.</p>
        <div class="dp-acct-row">
            <label>Month<select id="dpAcctMonth"><option value="">—</option>${months.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select></label>
            <label>Year<select id="dpAcctYear"><option value="">—</option>${years}</select></label>
        </div>
        <label class="dp-acct-tick"><input type="checkbox" id="dpAcctTerms">
            <span>I accept the <a href="terms.html" target="_blank" rel="noopener">Terms of Service</a> and <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a></span></label>
        <p class="dp-acct-err" id="dpAcctErr" aria-live="polite"></p>
        <button type="button" class="dp-acct-btn" id="dpAcctSave" disabled>CONTINUE</button>
        ${dismissible
            ? '<button type="button" class="dp-acct-later" id="dpAcctLater">NOT NOW</button>'
            : (isSocialPage() ? '<a class="dp-acct-later" href="write.html">BACK TO WRITING</a>' : '')}
    </div>`;
    document.body.appendChild(o);
    const m = o.querySelector('#dpAcctMonth'), y = o.querySelector('#dpAcctYear'), t = o.querySelector('#dpAcctTerms');
    const save = o.querySelector('#dpAcctSave'), err = o.querySelector('#dpAcctErr');
    const known = !!(readAccountCache() || {}).birthYear;   // terms update only
    if (known) {
        o.querySelector('.dp-acct-row').style.display = 'none';
        o.querySelector('#dpAcctTitle').textContent = 'Our terms have changed';
        o.querySelector('.dp-acct-box > p').textContent = 'Please read and accept the updated terms to carry on.';
    }
    const ready = () => { save.disabled = !((known || (m.value && y.value)) && t.checked); };
    [m, y, t].forEach(el => el.addEventListener('change', ready));
    const later = o.querySelector('#dpAcctLater');
    if (later) later.onclick = () => { sessionStorage.setItem('dpAccountLater', '1'); o.remove(); };
    save.onclick = async () => {
        if (!currentUser) { err.textContent = 'Sign in first, then try again.'; return; }
        save.disabled = true; save.textContent = 'SAVING...'; err.textContent = '';
        // Keep an existing birth date (it's locked); only the terms are re-accepted
        const prev = readAccountCache();
        const keep = prev && prev.birthYear;
        const rec = {
            birthYear:  keep ? prev.birthYear  : parseInt(y.value, 10),
            birthMonth: keep ? prev.birthMonth : parseInt(m.value, 10),
            termsVersion: TERMS_VERSION,
            acceptedAt: Date.now()
        };
        try {
            await setDoc(doc(db, 'users', currentUser.uid, 'private', 'account'), rec, { merge: true });
            cacheAccount(rec, currentUser);
            o.remove();
            applyAgeBand();
            if (window.dpAccount.blocked()) return;
            if (window.dpAccount.band() === 'under-min' && isSocialPage()) showSocialClosed();
            else if (isSocialPage()) location.reload();
        } catch (e) {
            console.error('Account save error:', e);
            err.textContent = 'Could not save, please try again.';
            save.disabled = false; save.textContent = 'CONTINUE';
        }
    };
}

// ── Block and report ─────────────────────────────────────────────────────────
// Blocks live in users/{uid}/private/blocks: { uids: [...], names: {uid: username} }.
// Blocking removes the friend, deletes friend requests between you, and the
// database rules stop them sending you messages or friend requests. Anything
// they sent before is hidden in the app.
// Reports go to reports/{id}; a server function emails them to Sulk Media.
let _blocks = null;
function blocksRef(uid) { return doc(db, 'users', uid, 'private', 'blocks'); }
async function loadBlocks(force) {
    if (!currentUser) return { uids: [], names: {} };
    if (_blocks && !force) return _blocks;
    try {
        const snap = await getDoc(blocksRef(currentUser.uid));
        const d = snap.exists() ? snap.data() : {};
        _blocks = { uids: d.uids || [], names: d.names || {} };
    } catch (e) { _blocks = _blocks || { uids: [], names: {} }; }
    return _blocks;
}
function isBlocked(uid) { return !!(_blocks && uid && _blocks.uids.includes(uid)); }
window.dpIsBlocked = isBlocked;
window.getBlocked = async function() {
    const b = await loadBlocks(true);
    return b.uids.map(uid => ({ uid, username: b.names[uid] || '?' }));
};
window.blockWriter = async function(uid, username) {
    if (!currentUser || !uid || uid === currentUser.uid) return { error: 'Not possible.' };
    try {
        await setDoc(blocksRef(currentUser.uid), { uids: arrayUnion(uid), names: { [uid]: username || '' } }, { merge: true });
        await setDoc(doc(db, 'users', currentUser.uid), { friends: arrayRemove(uid) }, { merge: true });
        for (const id of [`${uid}_${currentUser.uid}`, `${currentUser.uid}_${uid}`]) {
            try { await deleteDoc(doc(db, 'friendRequests', id)); } catch (e) { /* none */ }
        }
        await loadBlocks(true);
        return { success: true };
    } catch (err) { return { error: err.message }; }
};
window.unblockWriter = async function(uid) {
    if (!currentUser) return { error: 'Not signed in.' };
    try {
        await setDoc(blocksRef(currentUser.uid), { uids: arrayRemove(uid), names: { [uid]: deleteField() } }, { merge: true });
        await loadBlocks(true);
        return { success: true };
    } catch (err) { return { error: err.message }; }
};
const REPORT_REASONS = [
    ['harassment', 'Bullying or harassment'],
    ['sexual', 'Sexual content or unwanted advances'],
    ['child-safety', 'I think this person may be a risk to children'],
    ['underage', 'I think this person is under 16'],
    ['hate', 'Hate or abuse'],
    ['spam', 'Spam or scams'],
    ['other', 'Something else']
];
// what: { type: 'message'|'groupMessage'|'friendRequest'|'share'|'writer', uid, username, path, excerpt }
window.reportContent = async function(what, reason, note) {
    if (!currentUser) return { error: 'Not signed in.' };
    try {
        await setDoc(doc(collection(db, 'reports')), {
            from: currentUser.uid,
            type: String(what.type || 'writer').slice(0, 20),
            targetUid: String(what.uid || '').slice(0, 128),
            targetUsername: String(what.username || '').slice(0, 40),
            path: String(what.path || '').slice(0, 300),
            excerpt: String(what.excerpt || '').slice(0, 600),
            reason: String(reason || 'other').slice(0, 20),
            note: String(note || '').slice(0, 1000),
            createdAt: Date.now()
        });
        return { success: true };
    } catch (err) { return { error: err.message }; }
};
// One dialog for reporting (and optionally blocking) a writer or something they sent.
window.openReportDialog = function(what) {
    if (document.getElementById('dpReportOverlay')) return;
    const esc = t => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const o = document.createElement('div');
    o.id = 'dpReportOverlay';
    o.className = 'dp-acct-overlay';
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.setAttribute('aria-labelledby', 'dpReportTitle');
    o.innerHTML = `<div class="dp-acct-box">
        <h2 id="dpReportTitle">Report ${esc(what.username || 'this writer')}</h2>
        <p>Reports go to the Draft Punk team, not to the writer.</p>
        <fieldset class="dp-report-reasons"><legend class="dp-report-legend">WHAT'S WRONG?</legend>
            ${REPORT_REASONS.map(([v, l], i) => `<label class="dp-acct-tick"><input type="radio" name="dpReportReason" value="${v}"${i === 0 ? '' : ''}><span>${l}</span></label>`).join('')}
        </fieldset>
        <label class="dp-report-legend" for="dpReportNote">ANYTHING ELSE? (OPTIONAL)</label>
        <textarea id="dpReportNote" class="dp-report-note" maxlength="1000" rows="3"></textarea>
        <label class="dp-acct-tick"><input type="checkbox" id="dpReportBlock" checked><span>Also block ${esc(what.username || 'them')}</span></label>
        <p class="dp-acct-err" id="dpReportErr" aria-live="polite"></p>
        <button type="button" class="dp-acct-btn" id="dpReportSend" disabled>SEND REPORT</button>
        <button type="button" class="dp-acct-later" id="dpReportCancel">CANCEL</button>
    </div>`;
    document.body.appendChild(o);
    const send = o.querySelector('#dpReportSend'), err = o.querySelector('#dpReportErr');
    o.querySelectorAll('input[name=dpReportReason]').forEach(r => r.addEventListener('change', () => { send.disabled = false; }));
    o.querySelector('#dpReportCancel').onclick = () => o.remove();
    send.onclick = async () => {
        const reason = (o.querySelector('input[name=dpReportReason]:checked') || {}).value;
        send.disabled = true; send.textContent = 'SENDING...'; err.textContent = '';
        const r = await window.reportContent(what, reason, o.querySelector('#dpReportNote').value);
        if (r.error) { err.textContent = 'Could not send, please try again.'; send.disabled = false; send.textContent = 'SEND REPORT'; return; }
        if (o.querySelector('#dpReportBlock').checked && what.uid) await window.blockWriter(what.uid, what.username);
        o.querySelector('.dp-acct-box').innerHTML = `<h2>Thanks, we've got it</h2>
            <p>We'll look into it. If someone is in danger right now, contact the police.</p>
            <button type="button" class="dp-acct-btn" id="dpReportDone">DONE</button>`;
        o.querySelector('#dpReportDone').onclick = () => { o.remove(); if (typeof window.onDpBlockChange === 'function') window.onDpBlockChange(); };
    };
};
window.confirmBlock = async function(uid, username) {
    if (!confirm(`Block ${username || 'this writer'}? They'll be removed from your friends and won't be able to message you or send you friend requests. They aren't told.`)) return false;
    const r = await window.blockWriter(uid, username);
    if (r.error) { alert('Could not block, please try again.'); return false; }
    if (typeof window.onDpBlockChange === 'function') window.onDpBlockChange();
    return true;
};

// Account panel: blocked writers, shown only when there are any
async function renderBlockedSection() {
    const el = document.getElementById('dpBlockedSection');
    if (!el) return;
    const list = await window.getBlocked();
    if (!list.length) { el.innerHTML = ''; return; }
    const esc = t => String(t || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    el.innerHTML = `<div style="border-top:1px solid var(--border,#2a2a2a);margin:20px 0 12px;"></div>
        <div style="font-size:0.75rem;color:var(--text-dim);letter-spacing:2px;margin-bottom:8px;">BLOCKED WRITERS</div>
        ${list.map(b => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="flex:1;font-size:0.85rem;">${esc(b.username)}</span>
            <button type="button" class="btn-secondary" data-uid="${esc(b.uid)}" style="width:auto;min-width:unset;padding:4px 10px;font-size:0.75rem;">UNBLOCK</button>
        </div>`).join('')}`;
    el.querySelectorAll('button[data-uid]').forEach(btn => btn.onclick = async () => {
        btn.disabled = true;
        await window.unblockWriter(btn.dataset.uid);
        renderBlockedSection();
    });
}

// ── Suspension ───────────────────────────────────────────────────────────────
// A suspended writer can sign in, read and export their writing, but not add
// to it or use social features. Set and lifted in the admin area.
let _suspended = localStorage.getItem('dpSuspended') === '1';
function applySuspended() {
    document.body.classList.toggle('dp-suspended', _suspended);
    let bar = document.getElementById('dpSuspendedBar');
    if (!_suspended) { if (bar) bar.remove(); return; }
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'dpSuspendedBar';
        bar.setAttribute('role', 'status');
        bar.innerHTML = `Your account is suspended. You can read and export your writing, but not add to it.
            Questions: <a href="mailto:support@draft-punk.com">support@draft-punk.com</a>`;
        document.body.appendChild(bar);
    }
    lockEditing();
}
function lockEditing() {
    document.querySelectorAll('[contenteditable="true"]').forEach(el => { if (!el.closest('.dp-acct-overlay')) el.setAttribute('contenteditable', 'false'); });
    document.querySelectorAll('textarea').forEach(el => { if (!el.closest('.dp-acct-overlay')) el.readOnly = true; });
}
let _lockObserver = null;
function watchForEditors() {
    if (_lockObserver || !_suspended) return;
    _lockObserver = new MutationObserver(() => { if (_suspended) lockEditing(); });
    _lockObserver.observe(document.body, { childList: true, subtree: true });
}
async function checkSuspended(user) {
    try {
        const snap = await getDoc(doc(db, 'suspended', user.uid));
        _suspended = snap.exists();
        localStorage.setItem('dpSuspended', _suspended ? '1' : '0');
    } catch (e) { return; }   // offline: keep what we knew
    applySuspended();
    watchForEditors();
}
window.dpIsSuspended = () => _suspended;
document.addEventListener('DOMContentLoaded', () => { if (_suspended) { applySuspended(); watchForEditors(); } });

// ── Admin area ───────────────────────────────────────────────────────────────
// Used by admin.html only. The database rules decide what the admin can do;
// these helpers just call it.
window.dpAdmin = {
    async check() {
        if (!currentUser) return false;
        const has = async force => { try { const t = await currentUser.getIdTokenResult(force); return !!(t.claims && t.claims.admin); } catch (e) { return false; } };
        if (await has(false)) return true;
        try { const r = await callFn('claimAdmin', {}); if (!r || !r.admin) return false; } catch (e) { return false; }
        return has(true);
    },
    async reports() {
        const snap = await getDocs(query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(300)));
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async markReport(id, status, adminNote) {
        await setDoc(doc(db, 'reports', id), { status, adminNote: String(adminNote || '').slice(0, 1000), handledAt: Date.now() }, { merge: true });
    },
    async item(path) {
        if (!/^(messages\/[\w-]+|groups\/[\w-]+\/messages\/[\w-]+|shares\/[\w-]+)$/.test(path || '')) return null;
        const snap = await getDoc(doc(db, ...path.split('/')));
        return snap.exists() ? snap.data() : null;
    },
    async deleteItem(path) {
        if (!/^(messages\/[\w-]+|groups\/[\w-]+\/messages\/[\w-]+|shares\/[\w-]+)$/.test(path || '')) throw new Error('Not allowed');
        await deleteDoc(doc(db, ...path.split('/')));
    },
    async suspended() {
        const snap = await getDocs(collection(db, 'suspended'));
        return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    },
    async suspend(uid, username, reason, reportId) {
        await setDoc(doc(db, 'suspended', uid), { at: Date.now(), username: username || '', reason: String(reason || '').slice(0, 500), reportId: reportId || '' });
    },
    async unsuspend(uid) { await deleteDoc(doc(db, 'suspended', uid)); },
    async username(uid) {
        try { const s = await getDoc(doc(db, 'leaderboard', uid)); return s.exists() ? (s.data().username || '') : ''; } catch (e) { return ''; }
    },
    async notices() {
        const snap = await getDocs(query(collection(db, 'announcements'), orderBy('startAt', 'desc'), limit(100)));
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async saveNotice(n) {
        const ref = n.id ? doc(db, 'announcements', n.id) : doc(collection(db, 'announcements'));
        const rec = {
            type: ['update', 'competition', 'offer'].includes(n.type) ? n.type : 'update',
            title: String(n.title || '').slice(0, 120), body: String(n.body || '').slice(0, 1500),
            buttonText: String(n.buttonText || '').slice(0, 40), buttonUrl: String(n.buttonUrl || '').slice(0, 300),
            startAt: Number(n.startAt) || Date.now(), endAt: Number(n.endAt) || 0, createdAt: n.createdAt || Date.now()
        };
        await setDoc(ref, rec);
        return ref.id;
    },
    async deleteNotice(id) { await deleteDoc(doc(db, 'announcements', id)); },
    async weekly() {
        try { const s = await getDoc(doc(db, 'ops', 'weeklyNumbers')); return s.exists() ? s.data() : null; } catch (e) { return null; }
    }
};

// A writer's leaderboard record (username and word counts). Until the
// Nov 2026 database rules are live it can't be read, so fall back to their
// profile record, which other writers could read under the old rules.
async function readLeaderboardDoc(uid) {
    try { return await getDoc(doc(db, 'leaderboard', uid)); }
    catch (e) { return getDoc(doc(db, 'users', uid)); }
}

// ── Notices ──────────────────────────────────────────────────────────────────
// Short announcements written in the admin area (updates, competitions,
// offers). Each shows once per account, the next time the app opens, and
// never while the writer is typing. Seen notices and the "no offers" choice
// live in users/{uid}/private/notices.
let _lastKeyAt = 0;
const _loadedAt = Date.now();
['keydown', 'input'].forEach(ev => window.addEventListener(ev, () => { _lastKeyAt = Date.now(); }, true));
// Wait until the writer hasn't typed for 8 seconds. If they're in a text box
// (the Write page puts the cursor in the editor), also wait 8 seconds from
// page load, so a notice never lands just as they start typing.
function whenNotTyping(cb) {
    const ok = () => {
        const a = document.activeElement;
        const inText = a && (a.isContentEditable || /^(TEXTAREA|INPUT)$/.test(a.tagName));
        const since = Math.max(_lastKeyAt, inText ? _loadedAt : 0);
        return Date.now() - since > 8000 && !document.querySelector('.dp-acct-overlay');
    };
    if (ok()) return cb();
    const t = setInterval(() => { if (ok()) { clearInterval(t); cb(); } }, 2000);
}
function noticesRef(uid) { return doc(db, 'users', uid, 'private', 'notices'); }
async function checkNotices(user) {
    let prefs = { seen: [], offersOff: false };
    try { const s = await getDoc(noticesRef(user.uid)); if (s.exists()) prefs = { seen: [], ...s.data() }; } catch (e) { return; }
    let list;
    try {
        const snap = await getDocs(query(collection(db, 'announcements'), orderBy('startAt', 'desc'), limit(20)));
        list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { return; }   // not available yet (e.g. before the rules are live)
    const now = Date.now();
    const due = list
        .filter(n => n.startAt <= now && (!n.endAt || n.endAt > now))
        .filter(n => !(prefs.seen || []).includes(n.id))
        .filter(n => !(n.type === 'offer' && prefs.offersOff))
        .sort((a, b) => a.startAt - b.startAt);
    if (!due.length) return;
    const showNext = () => {
        const n = due.shift();
        if (!n) return;
        whenNotTyping(() => showNotice(n, () => {
            setDoc(noticesRef(user.uid), { seen: arrayUnion(n.id) }, { merge: true }).catch(() => {});
            if (due.length) setTimeout(showNext, 400);
        }));
    };
    showNext();
}
function showNotice(n, done) {
    const esc = t => String(t || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const kicker = { update: 'WHAT’S NEW', competition: 'COMPETITION', offer: 'OFFER' }[n.type] || 'NEWS';
    const safeUrl = /^(https:\/\/|[a-z0-9-]+\.html)/i.test(n.buttonUrl || '') ? n.buttonUrl : '';
    const o = document.createElement('div');
    o.className = 'dp-acct-overlay';
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.setAttribute('aria-labelledby', 'dpNoticeTitle');
    o.innerHTML = `<div class="dp-acct-box dp-notice">
        <p class="dp-notice-kicker">${kicker}</p>
        <h2 id="dpNoticeTitle">${esc(n.title)}</h2>
        <p class="dp-notice-body">${esc(n.body)}</p>
        ${n.buttonText && safeUrl ? `<a class="dp-acct-btn" id="dpNoticeGo" href="${esc(safeUrl)}">${esc(n.buttonText).toUpperCase()}</a>` : ''}
        <button type="button" class="${n.buttonText && safeUrl ? 'dp-acct-later' : 'dp-acct-btn'}" id="dpNoticeOk">GOT IT</button>
        ${n.type === 'offer' ? '<p class="dp-notice-small">You can turn off offers in Account.</p>' : ''}
    </div>`;
    document.body.appendChild(o);
    const close = () => { o.remove(); done(); };
    o.querySelector('#dpNoticeOk').onclick = close;
    const go = o.querySelector('#dpNoticeGo');
    if (go) go.addEventListener('click', () => { done(); });
    o.querySelector('#dpNoticeOk').focus();
}
window.dpShowNotice = showNotice;   // used by the admin area's preview
// Account panel: the one notice setting
async function renderNoticePrefs() {
    const el = document.getElementById('dpNoticePrefs');
    if (!el || !currentUser) return;
    let off = false;
    try { const s = await getDoc(noticesRef(currentUser.uid)); off = s.exists() && !!s.data().offersOff; } catch (e) { return; }
    el.innerHTML = `<div style="border-top:1px solid var(--border,#2a2a2a);margin:20px 0 12px;"></div>
        <div style="font-size:0.75rem;color:var(--text-dim);letter-spacing:2px;margin-bottom:8px;">NOTICES</div>
        <label class="dp-acct-tick" style="font-size:0.85rem;"><input type="checkbox" id="dpOffersOn"${off ? '' : ' checked'}>
            <span>Show offers from Draft Punk. Updates and competition news always show.</span></label>`;
    el.querySelector('#dpOffersOn').onchange = e => {
        setDoc(noticesRef(currentUser.uid), { offersOff: !e.target.checked }, { merge: true }).catch(() => { e.target.checked = !e.target.checked; });
    };
}

// ── Friend request badge ──────────────────────────────────────────────────────
function updateRequestBadge(count) {
    if (document.body.classList.contains('dp-under-min')) count = 0;
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
        DATA_KEYS.forEach(k => { localStorage.removeItem(k); pageSeen[k] = null; });
        localStorage.removeItem('dpLastUpdated');
        localStorage.removeItem(BASE_KEY);
        localStorage.removeItem('dpRecovered');
        localStorage.removeItem('dpAccount');
        localStorage.removeItem('dpSuspended');
        _suspended = false;
    }
    localStorage.setItem('dpUserId', user.uid);
    loadPush().then(m => { if (m) m.initPush(app, () => auth.currentUser); });

    let hasUsername = false;
    try {
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        hasUsername = userSnap.exists() && userSnap.data().username;
        if (hasUsername) _myLbUsername = userSnap.data().username;
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
    let needsReload = false, synced = false;
    try {
        needsReload = await pullFromCloud(user);
        synced = true;
    } catch (e) {
        console.warn('pullFromCloud failed, using local data:', e);
        setSyncStatus('error');
    }

    if (needsReload && !window.location.pathname.includes('write.html')) {
        location.reload();
    } else {
        // One-off November 2026 monthly-count repair — only once this device
        // is in step with the cloud, so it can't overwrite newer data.
        if (synced) runNovemberRepair();
        const dpData    = JSON.parse(localStorage.getItem('draftPunkData') || '{}');
        const hasActive = dpData.activeProjectId &&
                          dpData.projects &&
                          dpData.projects[dpData.activeProjectId] &&
                          dpData.projects[dpData.activeProjectId].active;
        // A failure drawing the page (e.g. the chart library not loading)
        // mustn't stop the account checks below
        try {
            if (hasActive && (window.goHome || window.showDashboard)) (window.goHome || window.showDashboard)();
            else if (!hasActive && window.showProjectForm) window.showProjectForm();
        } catch (e) { console.warn('Showing the page failed:', e); }
        try {
            checkPendingRequests(user);
            processFriendAcceptances(user);
            checkUnreadMessages(user);
        } catch (e) {
            console.warn('Non-critical post-auth check failed:', e);
        }
        checkAccount(user);
        checkSuspended(user);
        checkNotices(user);
    }
}

function runNovemberRepair() {
    const now = new Date();
    if (now.getFullYear() !== 2026 || now.getMonth() !== 10) return;
    import('./repair-nov2026.js').then(({ repairNovember2026 }) => {
        let dp;
        try { dp = JSON.parse(localStorage.getItem('draftPunkData') || 'null'); } catch (e) { return; }
        if (!dp || !repairNovember2026(dp, new Date())) return;
        localStorage.setItem('draftPunkData', JSON.stringify(dp));   // saves + syncs as normal
        document.dispatchEvent(new CustomEvent('dpMonthlyRepaired'));
    }).catch(err => console.warn('November repair skipped:', err));
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

// ── Sign-in panel: Google, an emailed code, or email + password ─────────────
// Every route ends in onAuthStateChanged → handleSignedIn, exactly as Google
// sign-in always has, so syncing and merging are unchanged. Codes are sent and
// checked by Cloud Functions (requestSignInCode / verifySignInCode), which sign
// a writer into the account that already uses their address, if there is one.
let functionsApi = null;
async function callFn(name, data) {
    if (!functionsApi) {
        const m = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js');
        functionsApi = { m, fns: m.getFunctions(app, 'us-central1') };
    }
    const res = await functionsApi.m.httpsCallable(functionsApi.fns, name)(data);
    return res.data;
}

function signInMessage(err) {
    const code = (err && err.code) || '';
    const why = (err && err.details && err.details.reason) || '';
    // Cloud Function errors (codes)
    if (code === 'functions/invalid-argument' && why === 'wrong') {
        const left = err.details.left;
        return `That code isn’t right. ${left} ${left === 1 ? 'try' : 'tries'} left.`;
    }
    if (code === 'functions/invalid-argument' && why === 'format') return 'The code is the 6 numbers in the email.';
    if (code === 'functions/invalid-argument') return 'That doesn’t look like an email address.';
    if (code === 'functions/not-found') return 'That code has expired or been used. Send a new one.';
    if (code === 'functions/permission-denied') return 'Too many wrong tries for that code. Send a new one.';
    if (code === 'functions/resource-exhausted' && why === 'cooldown') return `A code was sent a moment ago. You can ask for another in ${err.details.waitSeconds} seconds.`;
    if (code === 'functions/resource-exhausted' && why === 'hourly') return 'Too many codes for this address in the last hour. Try again later, or use Google.';
    if (code === 'functions/resource-exhausted') return 'Codes can’t be sent right now. Please use Google or a password, or try again later.';
    if (code === 'functions/failed-precondition') return 'This account has been switched off. Contact Draft Punk for help.';
    if (code === 'functions/unavailable' || code === 'functions/internal') return 'The code couldn’t be sent. Try again in a minute.';
    switch (code) {
        case 'auth/invalid-email':
            return 'That doesn’t look like an email address.';
        case 'auth/missing-password':
            return 'Type your password, or choose “Email me a code” instead.';
        case 'auth/weak-password':
            return 'Choose a password of at least 6 characters.';
        case 'auth/email-already-in-use':
            return 'There’s already an account with this email. Choose “Email me a code” to sign into it, or use the Google button if that’s how you usually sign in.';
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
        case 'auth/user-not-found':
            return 'That email and password don’t match. Choose “Email me a code” to sign in without a password, or use the Google button.';
        case 'auth/too-many-requests':
            return 'Too many tries. Wait a few minutes, or choose “Email me a code”.';
        case 'auth/network-request-failed':
        case 'functions/deadline-exceeded':
            return 'No connection. Check you’re online and try again.';
        case 'auth/operation-not-allowed':
            return 'This sign-in option isn’t switched on yet.';
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
            return '';
        default:
            return 'Sign-in didn’t work: ' + ((err && err.message) || 'unknown error');
    }
}

function buildSignInOverlay() {
    let ov = document.getElementById('dpSignInOverlay');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'dpSignInOverlay';
    ov.className = 'overlay dp-signin-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', 'dpSignInTitle');
    ov.innerHTML = `
        <div class="congrats-box dp-signin">
            <button type="button" class="dp-signin-close" aria-label="Close" data-act="close">✕</button>
            <h2 id="dpSignInTitle">Sign in</h2>
            <p class="dp-signin-sub" id="dpSignInSub"></p>
            <div id="dpSignInMain">
                <button type="button" class="dp-signin-google" data-act="google">Continue with Google</button>
                <div class="dp-signin-or"><span>or use your email</span></div>
                <form id="dpSignInEmailForm" novalidate>
                    <label class="field"><span class="field-label">Email</span>
                    <input type="email" id="dpSignInEmail" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false"></label>
                    <button type="submit" class="btn-primary dp-signin-wide">Email me a code</button>
                </form>
                <button type="button" class="dp-signin-link" data-act="show-password" id="dpSignInPwToggle">Use a password instead</button>
                <form id="dpSignInPwForm" novalidate style="display:none;">
                    <label class="field"><span class="field-label">Password</span>
                    <input type="password" id="dpSignInPassword" autocomplete="current-password"></label>
                    <div class="dp-signin-row">
                        <button type="submit" class="btn-secondary">Sign in</button>
                        <button type="button" class="btn-secondary" data-act="create">Create account</button>
                    </div>
                    <button type="button" class="dp-signin-link" data-act="reset">Forgot password?</button>
                </form>
            </div>
            <div id="dpSignInCodeStep" style="display:none;">
                <form id="dpSignInCodeForm" novalidate>
                    <label class="field"><span class="field-label">6-digit code</span>
                    <input type="text" id="dpSignInCode" class="dp-signin-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" pattern="[0-9 ]*"></label>
                    <button type="submit" class="btn-primary dp-signin-wide">Sign in</button>
                </form>
                <div class="dp-signin-links">
                    <button type="button" class="dp-signin-link" data-act="resend" id="dpSignInResend">Send a new code</button>
                    <button type="button" class="dp-signin-link" data-act="back">Use a different email</button>
                </div>
            </div>
            <p class="dp-signin-status" id="dpSignInStatus" role="status" aria-live="polite"></p>
        </div>`;
    document.body.appendChild(ov);

    const $ = id => document.getElementById(id);
    const status = (msg, kind) => {
        const el = $('dpSignInStatus');
        el.textContent = msg || '';
        el.className = 'dp-signin-status' + (kind ? ' is-' + kind : '');
    };
    let resendTimer = null;
    const busy = on => ov.querySelectorAll('button, input').forEach(b => {
        if (b.dataset.act === 'close') return;
        if (b.id === 'dpSignInResend' && resendTimer) return;   // the countdown owns it
        b.disabled = on;
    });
    const emailVal = () => $('dpSignInEmail').value.trim();
    const passVal  = () => $('dpSignInPassword').value;
    let codeEmail = '';

    function showStep(step) {
        $('dpSignInMain').style.display     = step === 'main' ? '' : 'none';
        $('dpSignInCodeStep').style.display = step === 'code' ? '' : 'none';
        $('dpSignInSub').textContent = step === 'code'
            ? `We’ve emailed a 6-digit code to ${codeEmail}. It works for 10 minutes.`
            : 'Your writing syncs to every device you sign in on.';
        setTimeout(() => $(step === 'code' ? 'dpSignInCode' : 'dpSignInEmail')?.focus(), 30);
    }
    function startResendCountdown(seconds) {
        const btn = $('dpSignInResend');
        clearInterval(resendTimer);
        let left = seconds;
        btn.disabled = true;
        btn.textContent = `Send a new code (${left}s)`;
        resendTimer = setInterval(() => {
            left--;
            if (left <= 0) { clearInterval(resendTimer); resendTimer = null; btn.disabled = false; btn.textContent = 'Send a new code'; }
            else btn.textContent = `Send a new code (${left}s)`;
        }, 1000);
    }
    async function sendCode(email) {
        try {
            await callFn('requestSignInCode', { email });
        } catch (err) {
            // 'not-found' here means the function itself isn't deployed
            if (err && err.code === 'functions/not-found') throw { code: 'functions/unavailable' };
            throw err;
        }
        codeEmail = email;
        $('dpSignInCode').value = '';
        showStep('code');
        startResendCountdown(60);
    }

    async function run(fn) {
        status('');
        busy(true);
        try { await fn(); }
        catch (err) {
            console.warn('Sign-in:', err && err.code);
            if (err && err.code === 'functions/resource-exhausted' && err.details && err.details.reason === 'cooldown') {
                startResendCountdown(err.details.waitSeconds || 60);
            }
            status(signInMessage(err), 'error');
        }
        finally { busy(false); }
    }

    ov.addEventListener('click', e => {
        if (e.target === ov) { window.dpCloseSignIn(); return; }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        if (act === 'close') window.dpCloseSignIn();
        else if (act === 'google') run(async () => {
            await signInWithPopup(auth, provider);
            window.dpCloseSignIn();
        });
        else if (act === 'show-password') {
            $('dpSignInPwForm').style.display = '';
            $('dpSignInPwToggle').style.display = 'none';
            $('dpSignInPassword').focus();
        }
        else if (act === 'create') run(async () => {
            if (!emailVal()) throw { code: 'auth/invalid-email' };
            const cred = await createUserWithEmailAndPassword(auth, emailVal(), passVal());
            // Best effort: a verified address keeps its password if the same
            // email is later used with Google.
            try { await sendEmailVerification(cred.user); } catch (e) { /* not essential */ }
            window.dpCloseSignIn();
        });
        else if (act === 'reset') run(async () => {
            if (!emailVal()) throw { code: 'auth/invalid-email' };
            await sendPasswordResetEmail(auth, emailVal());
            status('If there’s an account for ' + emailVal() + ', a reset link is on its way. Check your inbox.', 'ok');
        });
        else if (act === 'resend') run(async () => {
            await sendCode(codeEmail);
            status('New code sent. Only the newest code works.', 'ok');
        });
        else if (act === 'back') { status(''); showStep('main'); }
    });
    $('dpSignInEmailForm').addEventListener('submit', e => {
        e.preventDefault();
        run(async () => {
            if (!emailVal()) throw { code: 'auth/invalid-email' };
            await sendCode(emailVal());
        });
    });
    $('dpSignInPwForm').addEventListener('submit', e => {
        e.preventDefault();
        run(async () => {
            if (!emailVal()) throw { code: 'auth/invalid-email' };
            await signInWithEmailAndPassword(auth, emailVal(), passVal());
            window.dpCloseSignIn();
        });
    });
    $('dpSignInCodeForm').addEventListener('submit', e => {
        e.preventDefault();
        run(async () => {
            const code = $('dpSignInCode').value.replace(/\s+/g, '');
            if (!/^\d{6}$/.test(code)) throw { code: 'functions/invalid-argument', details: { reason: 'format' } };
            const { token } = await callFn('verifySignInCode', { email: codeEmail, code });
            await signInWithCustomToken(auth, token);
            window.dpCloseSignIn();
        });
    });
    // Submit as soon as six digits are typed or pasted
    $('dpSignInCode').addEventListener('input', e => {
        const digits = e.target.value.replace(/\D/g, '');
        if (digits.length === 6) $('dpSignInCodeForm').requestSubmit();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && ov.style.display === 'flex') window.dpCloseSignIn();
    });
    ov._status = status;
    ov._showStep = showStep;
    return ov;
}

window.dpOpenSignIn = function() {
    const ov = buildSignInOverlay();
    ov._status('');
    ov._showStep('main');
    ov.style.display = 'flex';
};
window.dpCloseSignIn = function() {
    const ov = document.getElementById('dpSignInOverlay');
    if (ov) ov.style.display = 'none';
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
    localStorage.removeItem(BASE_KEY);          // must go with the data (see syncNow)
    localStorage.removeItem('dpRecovered');
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
                <div style="font-size:0.75rem;color:var(--text-dim);letter-spacing:1px;margin-top:4px;">@${username}</div>
                <div style="font-size:0.75rem;color:var(--text-dim);letter-spacing:1px;margin-top:4px;">${totalWords} WORDS WRITTEN</div>
            </div>

            <button onclick="signOutUser()" style="width:100%;margin-bottom:6px;">⊖ SIGN OUT</button>

            <div id="dpNotifySection"></div>
            <div style="border-top:1px solid var(--border,#2a2a2a);margin:20px 0 12px;"></div>
            <div style="font-size:0.75rem;color:var(--text-dim);letter-spacing:2px;margin-bottom:8px;">EDITOR FONT</div>
            <div style="display:flex;gap:8px;">
                <button type="button" class="dp-font-opt" data-font="literata" onclick="window.dpSetEditorFont('literata')" style="flex:1;font-family:Literata,Georgia,serif;text-transform:none;letter-spacing:0;font-size:1rem;">Literata</button>
                <button type="button" class="dp-font-opt" data-font="georgia" onclick="window.dpSetEditorFont('georgia')" style="flex:1;font-family:Georgia,'Times New Roman',serif;text-transform:none;letter-spacing:0;font-size:1rem;">Georgia</button>
            </div>
            <div id="dpRecoverySection"></div>
            <div id="dpBlockedSection"></div>
            <div id="dpNoticePrefs"></div>

            <div style="border-top:1px solid var(--border,#2a2a2a);margin:20px 0 16px;"></div>
            <div style="font-size:0.75rem;color:var(--text-dim);letter-spacing:2px;margin-bottom:12px;">DANGER ZONE</div>

            <button class="btn-secondary" id="dpResetBtn" onclick="window._dpResetCloudData()"
                style="width:100%;margin-bottom:6px;">
                ⚠ RESET CLOUD DATA
            </button>
            <p style="font-size:0.875rem;color:var(--text-dim);letter-spacing:1px;margin:0 0 14px;line-height:1.5;">
                Wipes your cloud backup. Local data is preserved. Useful for testing a fresh sign-up.
            </p>

            <button id="dpDeleteBtn" onclick="window._dpDeleteAccount()"
                style="width:100%;margin-bottom:6px;background:#ff4500;">
                ✕ DELETE ACCOUNT
            </button>
            <p style="font-size:0.875rem;color:var(--text-dim);letter-spacing:1px;margin:0 0 20px;line-height:1.5;">
                Permanently deletes your account, username, and all cloud data.
            </p>

            <button onclick="document.getElementById('dpAccountOverlay').style.display='none'"
                style="width:100%;background:#222;">CLOSE</button>

            <p id="dpAccountError" style="color:#ff4500;font-size:0.75rem;margin:10px 0 0;text-align:center;min-height:1.2em;letter-spacing:1px;"></p>
        </div>
    `;

    overlay.style.display = 'flex';
    if (window.dpMarkEditorFont) window.dpMarkEditorFont();
    renderRecoverySection(user).catch(err => console.warn('Recovered copies not listed:', err));
    renderBlockedSection().catch(err => console.warn('Blocked list not shown:', err));
    renderNoticePrefs().catch(err => console.warn('Notice settings not shown:', err));
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
            // Delete chapters, Writing Record figures and share links. The
            // birth date and blocked list stay (a reset isn't a new account).
            const owned = await collectOwnedDocRefs(user.uid, { keep: ['account', 'blocks'] });
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
// The dot next to ··· and the matching line at the top of that menu (added by
// sidebar.js) say where the writer's work is backed up.
const SYNC_STATES = {
    synced:  { bg: 'var(--neon)',  ring: false, text: 'BACKED UP TO THE CLOUD' },
    pending: { bg: '#ffa500',      ring: false, text: 'SAVING TO THE CLOUD…' },
    error:   { bg: '#ff4444',      ring: false, text: 'CLOUD BACKUP FAILED — SAVED ON THIS DEVICE' },
    none:    { bg: 'transparent',  ring: true,  text: 'NOT SIGNED IN — SAVED ON THIS DEVICE ONLY' }
};
function setSyncStatus(state) {
    window._dpSyncState = state;
    const st  = SYNC_STATES[state] || SYNC_STATES.none;
    const dot = document.getElementById('syncDot');
    if (dot) {
        dot.style.background = st.bg;
        dot.style.boxShadow  = st.ring ? 'inset 0 0 0 1px var(--text-dim)' : 'none';
        dot.title = st.text.charAt(0) + st.text.slice(1).toLowerCase();
    }
    const line = document.getElementById('syncStatusLine');
    if (line) {
        line.querySelector('.sync-status-dot').style.background = st.bg;
        line.querySelector('.sync-status-dot').style.boxShadow  = st.ring ? 'inset 0 0 0 1px var(--text-dim)' : 'none';
        line.querySelector('.sync-status-text').textContent = st.text;
    }
}
window.dpSetSyncStatus = setSyncStatus;

// ── Social functions (used by groups.js) ──────────────────────────────────────

window.getCurrentUser = function() { return currentUser; };

window.getLeaderboard = async function(field = 'totalWords') {
    if (!currentUser) return { error: 'not-signed-in' };
    try {
        // Query directly by the requested field so period leaderboards
        // aren't limited to users who happen to have high total words.
        // Until the Nov 2026 database rules are live, the leaderboard
        // collection can't be read yet: fall back to the old profile records
        let snap;
        try { snap = await getDocs(query(collection(db, 'leaderboard'), orderBy(field, 'desc'), limit(50))); }
        catch (e) { snap = await getDocs(query(collection(db, 'users'), orderBy(field, 'desc'), limit(50))); }
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
        // A friend stays a friend even if their leaderboard record isn't
        // there yet (writers who haven't opened the app since profiles became
        // owner-only in Nov 2026, until the nightly fill creates it). Their
        // name then comes from the usernames list, with word counts at 0.
        // Read-only: nothing here changes anyone's friends list.
        const results = await Promise.all(friends.map(async uid => {
            let s = null;
            try { s = await readLeaderboardDoc(uid); } catch (e) { s = null; }
            if (s && s.exists() && s.data().username) return { uid, ...s.data() };
            try {
                const names = await getDocs(query(collection(db, 'usernames'), where('uid', '==', uid), limit(1)));
                if (!names.empty) return { uid, username: names.docs[0].id, totalWords: 0, wordsThisWeek: 0, wordsThisMonth: 0, wordsThisYear: 0 };
            } catch (e) { /* fall through */ }
            return null;
        }));
        return results.filter(u => u && u.username);
    } catch (err) {
        return { error: err.message };
    }
};

// Send a friend request (does NOT add directly)
window.addFriend = async function(username) {
    if (!currentUser) return { error: 'Not signed in.' };
    try {
        // The same answer whether the name doesn't exist or the database
        // refuses the request (blocked, or a writer who can't receive
        // requests), so it never reveals anything about the other writer
        const NOPE = { error: 'No writer you can add with that username.' };
        const unameSnap = await getDoc(doc(db, 'usernames', username));
        if (!unameSnap.exists()) return NOPE;

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
        if (err && err.code === 'permission-denied') return { error: 'No writer you can add with that username.' };
        return { error: err.message };
    }
};

window.getPendingRequests = async function() {
    if (!currentUser) return { error: 'not-signed-in' };
    try {
        const q    = query(collection(db, 'friendRequests'), where('to', '==', currentUser.uid));
        const snap = await getDocs(q);
        await loadBlocks();
        return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => !isBlocked(r.from));
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
    if (_suspended) return;
    if (!currentUser) return;
    try {
        await setDoc(doc(db, 'users', currentUser.uid, 'writing', chapter.id), chapter, { merge: true });
    } catch (err) {
        console.error('Writing push error:', err);
        // Re-throw so the Write page can show "SAVED LOCALLY — cloud sync
        // failed" instead of "SAVED". The chapter is still safe in this
        // browser; callers decide what to tell the writer.
        throw err;
    }
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
        return chapters;              // [] = the cloud has no chapters for this project
    } catch (err) { console.error('Writing pull error:', err); return null; }   // null = couldn't read the cloud
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

// One chapter's cloud record: its data, null if there is none, or undefined
// when signed out. Throws if the cloud couldn't be read.
window.pullEvidenceChapter = async function(chapterId) {
    if (!currentUser) return undefined;
    const snap = await getDoc(doc(db, 'users', currentUser.uid, 'evidence', chapterId));
    return snap.exists() ? snap.data() : null;
};

window.pullEvidenceFromCloud = async function(projectId) {
    if (!currentUser) return null;
    const snap = await getDocs(collection(db, 'users', currentUser.uid, 'evidence'));
    return snap.docs.map(d => ({ ...d.data(), id: d.id })).filter(d => d.projectId === projectId);
};

// Read-only share links: a snapshot of the report (figures only, no chapter
// text) that anyone with the link can view. Since Nov 2026 the server builds
// and stamps the report from the writer's saved cloud copy (Cloud Function
// issueWritingRecord); the browser can no longer write one itself.
window.issueEvidenceShare = async function(projectId, shareId) {
    if (!currentUser) throw new Error('Sign in to create a share link.');
    try {
        return await callFn('issueWritingRecord', shareId ? { projectId, shareId } : { projectId });
    } catch (err) {
        const code = (err && err.code) || '';
        if (/not-found/.test(code)) throw new Error('This project hasn’t been saved to the cloud yet. Open Write, press SYNC AND SAVE, then try again.');
        if (/permission-denied/.test(code)) throw new Error('This link belongs to another account.');
        throw new Error('Draft Punk couldn’t issue the record just now. Check your connection and try again.');
    }
};
window.deleteEvidenceShare = async function(id) {
    if (!currentUser) throw new Error('Sign in to stop sharing.');
    await deleteDoc(doc(db, 'evidenceShares', id));
    try { await setDoc(doc(db, 'users', currentUser.uid, 'evidence', '_shares'), { ids: arrayRemove(id) }, { merge: true }); } catch (e) {}
};

// Every cloud document belonging to this writer that sits outside the user doc:
// chapters, Writing Record figures, and Writing Record share links.
async function collectOwnedDocRefs(uid, opts) {
    const keep = (opts && opts.keep) || [];
    const refs = [doc(db, 'leaderboard', uid)];
    const writingSnap  = await getDocs(collection(db, 'users', uid, 'writing'));
    writingSnap.docs.forEach(d => refs.push(d.ref));
    // Private copy of notes/projects (privacy migration) and the version index
    const privateSnap  = await getDocs(collection(db, 'users', uid, 'private'));
    const chapterIds   = new Set(writingSnap.docs.map(d => d.id));
    privateSnap.docs.forEach(d => {
        if (d.id === 'versionIndex') (d.data().chapterIds || []).forEach(c => chapterIds.add(c));
        if (!keep.includes(d.id)) refs.push(d.ref);
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
// Deleted chapters' last copies, for "Recently deleted" on the Write page.
// Read-only: looks only at chapters listed in the version index that aren't
// current chapters, and only at their "chapter-deleted" versions.
window.listCloudDeletedChapters = async function(currentIds) {
    if (!currentUser) return [];
    const skip = new Set(currentIds || []);
    const idx = await getDoc(doc(db, 'users', currentUser.uid, 'private', 'versionIndex'));
    const ids = ((idx.exists() && idx.data().chapterIds) || []).filter(c => !skip.has(c));
    const out = [];
    for (const cid of ids) {
        const snap = await getDocs(query(collection(db, 'users', currentUser.uid, 'writing', cid, 'versions'),
            where('reason', '==', 'chapter-deleted')));
        snap.docs.forEach(d => out.push(d.data()));
    }
    return out;
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

// Word counts for each member, from their leaderboard record
window.getGroupStats = async function(group) {
    const rows = await Promise.all((group.members || []).map(async uid => {
        try {
            const s = await readLeaderboardDoc(uid);
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
window.createGroupShare = async function({ projectId, projectTitle, chapterId, chapterTitle, chapterOrder, content, wordCount, group }) {
    if (!currentUser) return { error: 'Not signed in.' };
    try {
        const others = (group.members || []).filter(u => u !== currentUser.uid);
        if (!others.length) return { error: 'There is no one else in this group yet.' };
        await setDoc(doc(db, 'shares', `${currentUser.uid}_${chapterId}_group_${group.id}`), {
            ownerId: currentUser.uid, ownerUsername: await myUsername(),
            projectId, projectTitle, chapterId, chapterTitle, content, wordCount,
            ...(Number.isFinite(chapterOrder) ? { chapterOrder } : {}),
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

// `about` (optional) ties a message to something, e.g. feedback on a shared
// chapter: { kind: 'chapter', projectTitle, chapterTitle, chapterId }
window.sendMessage = async function(toUid, toUsername, body, about) {
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
            ...(about && about.kind === 'chapter' ? { about: {
                kind: 'chapter',
                chapterId:    String(about.chapterId || '').slice(0, 100),
                chapterTitle: String(about.chapterTitle || '').slice(0, 200),
                projectTitle: String(about.projectTitle || '').slice(0, 200) } } : {}),
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
        await loadBlocks();
        const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => !isBlocked(m.from));
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
        const all = [...incoming.filter(m => !isBlocked(m.from)), ...outgoing];
        all.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        callback(all);
    };
    const asList = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const fail = err => { if (onError) onError(err); };
    loadBlocks().then(emit);
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
    if (document.body.classList.contains('dp-under-min')) count = 0;
    document.querySelectorAll('a[href="messages.html"]').forEach(link => {
        link.textContent = count > 0 ? `MESSAGES (${count})` : 'MESSAGES';
        link.style.color = count > 0 ? 'var(--neon)' : '';
    });
}
window.updateMessageBadge = updateMessageBadge;

// ── Chapter sharing ────────────────────────────────────────────────────────────

window.createShare = async function({ projectId, projectTitle, chapterId, chapterTitle, chapterOrder, content, wordCount, sharedWithUid, sharedWithUsername }) {
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
            ...(Number.isFinite(chapterOrder) ? { chapterOrder } : {}),
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
        await loadBlocks();
        return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(sh => !isBlocked(sh.ownerId));
    } catch (err) {
        return { error: err.message };
    }
};

// What this reader has opened and tidied away in "Shared with me". Kept in the
// reader's own private area (users/{uid}/private/shareSeen and shareHidden);
// nothing here touches the share itself, so the writer and other group
// members are never affected.
//   shareSeen:   { '<ownerId>|<chapterId>': updatedAt of the version read }
//   shareReadAt: { '<ownerId>|<chapterId>': when it was last opened }
//   shareHidden: { '<ownerId>|<projectId>': time hidden (0 = shown again) }
window.getShareReads = async function() {
    if (!currentUser) return { seen: {}, readAt: {}, hidden: {}, fresh: false };
    try {
        const [s, r, h] = await Promise.all([
            getDoc(doc(db, 'users', currentUser.uid, 'private', 'shareSeen')),
            getDoc(doc(db, 'users', currentUser.uid, 'private', 'shareReadAt')),
            getDoc(doc(db, 'users', currentUser.uid, 'private', 'shareHidden'))
        ]);
        return { seen: s.exists() ? s.data() : {}, readAt: r.exists() ? r.data() : {}, hidden: h.exists() ? h.data() : {}, fresh: !s.exists() };
    } catch (err) { return { seen: {}, readAt: {}, hidden: {}, fresh: false, error: err.message }; }
};
// map: { key: updatedAt seen }. Pass openedAt when the reader actually opened
// the chapter (not for the first-visit baseline).
window.markSharesSeen = async function(map, openedAt) {
    if (!currentUser || !map || !Object.keys(map).length) return;
    try { await setDoc(doc(db, 'users', currentUser.uid, 'private', 'shareSeen'), map, { merge: true }); } catch (err) {}
    if (!openedAt) return;
    const at = {}; Object.keys(map).forEach(k => { at[k] = openedAt; });
    try { await setDoc(doc(db, 'users', currentUser.uid, 'private', 'shareReadAt'), at, { merge: true }); } catch (err) {}
};
window.setShareProjectHidden = async function(key, time) {
    if (!currentUser) return { error: 'Not signed in.' };
    try { await setDoc(doc(db, 'users', currentUser.uid, 'private', 'shareHidden'), { [key]: time }, { merge: true }); return { success: true }; }
    catch (err) { return { error: err.message }; }
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
