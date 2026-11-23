// Draft Punk notifications — Cloud Functions (codebase "draftpunk").
//
// Deployed ONLY with:
//   firebase deploy --only functions:draftpunk --project draft-punk-a0735
// The codebase name keeps these separate from any other functions in the
// same Firebase project (e.g. Cue Fighters): deploying one never removes or
// changes the other.
//
// What these functions read and write:
//   READ   users/{uid}/private/notifications   (devices + settings, owner-only)
//   READ   users/{uid}/private/data            (to see if the writer wrote today)
//   READ   users/{uid}                         (fallback for the above, older accounts)
//   READ   groups/{groupId}                    (member list for group chat alerts)
//   WRITE  users/{uid}/private/notifications   (only: lastReminderDate, and
//                                               removing device tokens FCM says are dead)
//   WRITE  signInCodes/{hash}, ops/emailDaily-*  (email sign-in codes; server-only)
//   AUTH   creates an account only when a sign-in code is used by an email
//          address that no account has yet; marks an address verified once a
//          code proves the writer owns it.
//   WRITE  evidenceShares/{id}, recordOwners/{id}, recordCodes/{code},
//          users/{uid}/evidence/_shares  (Writing Record share links: see
//          issueWritingRecord at the end of this file)
// Nothing else is ever written. No writing, project or word-count data is changed.

'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const lib = require('./lib');

// MUST match the Firestore database location (Firebase console → Firestore →
// the location shown at the top of the Data tab). Firestore triggers can only
// run in that region. Mapping: europe-west2 → 'europe-west2';
// eur3 (multi-region) → 'europe-west1'; nam5 → 'us-central1'.
const REGION = 'us-central1';   // Firestore is in nam5

setGlobalOptions({ region: REGION, maxInstances: 5 });

admin.initializeApp();
const db = admin.firestore();
const { FieldValue, FieldPath } = admin.firestore;

const SITE = 'https://www.draft-punk.com/';

function settingsRef(uid) { return db.collection('users').doc(uid).collection('private').doc('notifications'); }

// The writer's projects and streak, from the private copy if there is one
async function writerData(uid) {
    const priv = await db.collection('users').doc(uid).collection('private').doc('data').get();
    if (priv.exists && priv.data().draftPunkData) {
        const d = priv.data();
        return { draftPunkData: d.draftPunkData, dpStreak: d.dpStreak || null };
    }
    const pub = await db.collection('users').doc(uid).get();
    const d = pub.exists ? pub.data() : {};
    return { draftPunkData: d.draftPunkData || null, dpStreak: d.dpStreak || null };
}

// Send one notification to every device a writer has turned notifications on
// for. Data-only message: the app's service worker (sw.js) shows it.
async function sendToUser(uid, settings, msg) {
    const tokens = Object.keys((settings && settings.tokens) || {});
    if (!tokens.length) return 0;
    const data = {
        title: String(msg.title || 'DRAFT PUNK'),
        body:  String(msg.body || ''),
        url:   String(msg.url || 'write.html'),
        tag:   String(msg.tag || '')
    };
    let sent = 0;
    const dead = [];
    await Promise.all(tokens.map(async token => {
        try {
            await admin.messaging().send({
                token, data,
                webpush: {
                    headers: { Urgency: 'high', TTL: '43200' },
                    fcmOptions: { link: SITE + data.url }
                }
            });
            sent++;
        } catch (err) {
            if (lib.isDeadTokenError(err.code)) dead.push(token);
            else logger.warn('FCM send failed', { uid, code: err.code, message: err.message });
        }
    }));
    if (dead.length) {
        const args = [];
        dead.forEach(t => { args.push(new FieldPath('tokens', t), FieldValue.delete()); });
        try { await settingsRef(uid).update(...args); } catch (e) { logger.warn('Token cleanup failed', { uid, e: e.message }); }
    }
    return sent;
}

// ── Daily writing reminder ───────────────────────────────────────────────────
// Every 15 minutes: for each writer with reminders on, if it's their chosen
// local time (within the hour after it, and never after 22:00), they haven't
// written today, and they haven't been reminded today, send one reminder.
exports.dailyWritingReminder = onSchedule({ schedule: 'every 15 minutes', timeZone: 'Etc/UTC' }, async () => {
    const now = new Date();
    // The number of writers is small; read each one's settings directly.
    const users = await db.collection('users').select().get();
    let sent = 0;
    for (const u of users.docs) {
        try {
            const snap = await settingsRef(u.id).get();
            if (!snap.exists) continue;
            const settings = snap.data();
            if (!settings.reminder || !settings.reminder.enabled) continue;
            const w = await writerData(u.id);
            const decision = lib.reminderDecision(settings, w.draftPunkData, now, w.dpStreak);
            if (!decision.send) {
                if (decision.reason === 'wrote-today') {
                    await settingsRef(u.id).set({ lastReminderDate: decision.local.date }, { merge: true });
                }
                continue;
            }
            const msg = lib.reminderMessage(decision.status);
            // Mark first, so a retry can never send twice.
            await settingsRef(u.id).set({ lastReminderDate: decision.local.date }, { merge: true });
            sent += await sendToUser(u.id, settings, { ...msg, url: 'write.html', tag: 'daily-reminder' });
        } catch (err) {
            logger.error('Reminder failed for user', { uid: u.id, message: err.message });
        }
    }
    logger.info('Daily reminder run', { users: users.size, sent });
});

// ── Social notifications ─────────────────────────────────────────────────────
async function notifySocial(uid, kind, info) {
    if (!uid || uid === info.from) return;
    const snap = await settingsRef(uid).get();
    if (!snap.exists) return;
    const settings = snap.data();
    if (!settings.social || settings.social.enabled === false) return;
    // Quiet hours (22:00-08:00 in the writer's time zone): skip. The app's
    // own badges still show anything that arrived overnight.
    if (lib.inQuietHours(settings.reminder && settings.reminder.tz)) return;
    const msg = lib.socialMessage(kind, info);
    if (msg) await sendToUser(uid, settings, msg);
}

exports.notifyDirectMessage = onDocumentCreated('messages/{messageId}', async event => {
    const m = event.data && event.data.data();
    if (!m) return;
    await notifySocial(m.to, 'dm', { from: m.from, fromUsername: m.fromUsername });
});

exports.notifyGroupMessage = onDocumentCreated('groups/{groupId}/messages/{messageId}', async event => {
    const m = event.data && event.data.data();
    if (!m) return;
    const gid = event.params.groupId;
    const g = await db.collection('groups').doc(gid).get();
    if (!g.exists) return;
    const group = g.data();
    await Promise.all(lib.groupRecipients(group, m.from).map(uid =>
        notifySocial(uid, 'group', { from: m.from, fromUsername: m.fromUsername, groupId: gid, groupName: group.name })
            .catch(err => logger.warn('Group notify failed', { uid, message: err.message }))));
});

exports.notifyFriendRequest = onDocumentCreated('friendRequests/{requestId}', async event => {
    const r = event.data && event.data.data();
    if (!r) return;
    await notifySocial(r.to, 'friendRequest', { from: r.from, fromUsername: r.fromUsername });
});

exports.notifyChapterShare = onDocumentCreated('shares/{shareId}', async event => {
    const s = event.data && event.data.data();
    if (!s) return;
    await Promise.all((s.sharedWith || []).map(uid =>
        notifySocial(uid, 'share', { from: s.ownerId, fromUsername: s.ownerUsername })
            .catch(err => logger.warn('Share notify failed', { uid, message: err.message }))));
});

// ── Email sign-in codes ──────────────────────────────────────────────────────
// requestSignInCode emails a 6-digit code; verifySignInCode checks it and
// returns a Firebase sign-in token for the account with that email address.
// If an account already uses the address (Google, password or an earlier
// code), the token is for THAT account, so a writer always lands in their own
// work. A new account is only created when no account has the address.
//
// Writes: signInCodes/{hash of email}  (pending code, hashed; deleted on use)
//         ops/emailDaily-YYYY-MM-DD     (count of sign-in emails that day)
// Both are server-only: firestore.rules denies every path it doesn't list.
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');   // from resend.com → API Keys
const ADMIN_UID      = defineSecret('ADMIN_UID');        // Ross's account: usage alerts go here only
const SIGNIN_FROM    = 'Draft Punk <signin@mail.draft-punk.com>';   // domain verified in Resend

const callOpts = { enforceAppCheck: true, secrets: [RESEND_API_KEY, ADMIN_UID] };

function codeRef(email) { return db.collection('signInCodes').doc(lib.emailKey(email)); }
function dayRef(key)    { return db.collection('ops').doc('emailDaily-' + key); }

// Usage alerts: push to Ross's devices only. Never throws.
async function notifyAdmin(title, body) {
    try {
        const uid = (ADMIN_UID.value() || '').trim();
        if (!uid) { logger.warn('ADMIN_UID not set; alert not sent', { title, body }); return; }
        const s = await settingsRef(uid).get();
        const sent = await sendToUser(uid, s.exists ? s.data() : null, { title, body, url: 'index.html?dashboard', tag: 'dp-admin' });
        if (!sent) logger.warn('Admin alert had no device to go to', { title, body });
    } catch (e) {
        logger.error('Admin alert failed', { title, message: e.message });
    }
}

async function sendWithResend(to, code) {
    const { subject, text, html } = lib.signInEmail(code);
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + RESEND_API_KEY.value(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: SIGNIN_FROM, to: [to], subject, text, html })
    });
    const quotaUsed = parseInt(res.headers.get('x-resend-daily-quota') || '', 10);
    let body = null;
    try { body = await res.json(); } catch (e) { /* empty */ }
    return { ok: res.ok, status: res.status, errName: body && body.name, quotaUsed: isNaN(quotaUsed) ? null : quotaUsed };
}

exports.requestSignInCode = onCall(callOpts, async request => {
    const email = lib.normaliseEmail(request.data && request.data.email);
    if (!lib.isValidEmail(email)) throw new HttpsError('invalid-argument', 'bad-email');

    const now = Date.now();
    const ref = codeRef(email);
    const snap = await ref.get();
    const decision = lib.codeRequestDecision(snap.exists ? snap.data() : null, now);
    if (!decision.ok) throw new HttpsError('resource-exhausted', decision.reason, { reason: decision.reason, waitSeconds: decision.waitSeconds || 0 });

    const code = lib.newCode();
    const salt = require('crypto').randomBytes(16).toString('hex');
    const dayKey = lib.utcDayKey(new Date(now));
    const dRef = dayRef(dayKey);

    const sent = await sendWithResend(email, code);
    if (!sent.ok) {
        const quotaHit = sent.status === 429 && /quota/i.test(sent.errName || '');
        logger.error('Sign-in email not sent', { status: sent.status, errName: sent.errName });
        if (quotaHit) {
            const d = await dRef.get();
            if (!(d.exists && d.data().limitAlerted)) {
                await dRef.set({ limitAlerted: true }, { merge: true });
                await notifyAdmin('DRAFT PUNK · EMAIL LIMIT REACHED',
                    'Sign-in codes can’t be sent until midnight UTC. Writers can still use Google or a password. Upgrading Resend lifts the limit.');
            }
            throw new HttpsError('resource-exhausted', 'quota', { reason: 'quota' });
        }
        throw new HttpsError('unavailable', 'send-failed');
    }

    // Only store the code once the email has actually gone
    await ref.set({
        salt, codeHash: lib.hashCode(salt, code),
        expiresAt: now + lib.CODE_TTL_MS, attempts: 0,
        lastSentAt: now, sentTimes: decision.sentTimes
    });

    const d = await dRef.get();
    const prev = d.exists ? d.data() : {};
    const day = { ...prev, sent: (prev.sent || 0) + 1, quotaUsed: Math.max(prev.quotaUsed || 0, sent.quotaUsed || 0) };
    if (lib.quotaWarningDue(day)) {
        day.warned = true;
        await dRef.set(day, { merge: true });
        await notifyAdmin('DRAFT PUNK · EMAIL LIMIT NEAR',
            `${Math.max(day.sent, day.quotaUsed)} sign-in emails today (UTC). The free limit is 100 a day; after that codes stop until midnight UTC.`);
    } else {
        await dRef.set(day, { merge: true });
    }
    return { ok: true };
});

exports.verifySignInCode = onCall(callOpts, async request => {
    const email = lib.normaliseEmail(request.data && request.data.email);
    const code  = String((request.data && request.data.code) || '').replace(/\s+/g, '');
    if (!lib.isValidEmail(email)) throw new HttpsError('invalid-argument', 'bad-email');
    if (!/^\d{6}$/.test(code)) throw new HttpsError('invalid-argument', 'bad-code', { reason: 'format' });

    const now = Date.now();
    const ref = codeRef(email);
    const snap = await ref.get();
    const state = snap.exists ? snap.data() : null;
    const check = lib.codeCheckDecision(state, code, now);

    if (check.result === 'expired') throw new HttpsError('not-found', 'expired', { reason: 'expired' });
    if (check.result === 'locked') {
        await ref.set({ attempts: lib.CODE_MAX_ATTEMPTS }, { merge: true });
        throw new HttpsError('permission-denied', 'locked', { reason: 'locked' });
    }
    if (check.result === 'wrong') {
        await ref.set({ attempts: (state.attempts || 0) + 1 }, { merge: true });
        throw new HttpsError('invalid-argument', 'wrong-code', { reason: 'wrong', left: check.left });
    }

    // Correct: the code is single-use
    await ref.delete();

    let user = await findAccount(email);
    if (user) {
        if (user.disabled) throw new HttpsError('failed-precondition', 'disabled', { reason: 'disabled' });
        // The writer has just proved they own the address. Only mark it
        // verified when it is exactly the address they typed.
        if (!user.emailVerified && lib.normaliseEmail(user.email) === email) {
            await admin.auth().updateUser(user.uid, { emailVerified: true });
        }
    } else {
        user = await admin.auth().createUser({ email, emailVerified: true });
        logger.info('New account from sign-in code', { uid: user.uid });
    }
    const token = await admin.auth().createCustomToken(user.uid);
    return { token };
});

// The account that already belongs to this inbox, or null.
// Exact address first. For Gmail, also any account whose address (or Google
// sign-in address) is the same inbox written with different dots or a '+'
// part, so a writer never lands in a new, empty account by typing their
// address differently. If several match, the oldest is the original.
// (Scans the user list for Gmail addresses: fine for thousands of writers;
// at much larger scale, keep a lookup of canonical addresses instead.)
async function findAccount(email) {
    let exact = null;
    try { exact = await admin.auth().getUserByEmail(email); }
    catch (err) { if (err.code !== 'auth/user-not-found') throw err; }
    if (!lib.isGmail(email)) return exact;

    const want = lib.canonicalEmail(email);
    const matches = [];
    let pageToken;
    do {
        const page = await admin.auth().listUsers(1000, pageToken);
        page.users.forEach(u => {
            if (lib.accountEmails(u).some(e => lib.canonicalEmail(e) === want)) matches.push(u);
        });
        pageToken = page.pageToken;
    } while (pageToken);
    if (matches.length > 1) logger.warn('Several accounts share one Gmail inbox; using the oldest', { uids: matches.map(u => u.uid) });
    return lib.pickOriginal(matches) || exact;
}

// ── Weekly numbers, to Ross only ────────────────────────────────────────────
exports.weeklyNumbers = onSchedule({ schedule: 'every monday 09:00', timeZone: 'Europe/London', secrets: [ADMIN_UID] }, async () => {
    const users = [];
    let pageToken;
    do {
        const page = await admin.auth().listUsers(1000, pageToken);
        page.users.forEach(u => users.push({ creationTime: u.metadata.creationTime, providerData: u.providerData }));
        pageToken = page.pageToken;
    } while (pageToken);

    const days = {};
    for (let i = 1; i <= 7; i++) {
        const key = lib.utcDayKey(new Date(Date.now() - i * 24 * 60 * 60 * 1000));
        const d = await dayRef(key).get();
        days[key] = d.exists ? d.data() : { sent: 0 };
    }
    const summary = lib.weeklySummary(users, days);
    logger.info('Weekly numbers', { newWriters: summary.newWriters, total: summary.total, codes: summary.codes });
    try { await db.collection('ops').doc('weeklyNumbers').set({ title: summary.title, body: summary.body, at: Date.now() }); }
    catch (e) { logger.warn('Weekly numbers not saved for the admin page', { e: e.message }); }
    await notifyAdmin(summary.title, summary.body);
});


// ── Reports (Nov 2026) ───────────────────────────────────────────────────────
// A writer reported a message, request, shared chapter or another writer.
// Email the details to Sulk Media and push an alert to Ross. The item's
// current text is looked up only for messages and shared chapters.
const REPORTS_TO   = 'reports@draft-punk.com';   // forwarded to Ross's inbox (set up in Squarespace)
const REPORTS_FROM = 'Draft Punk <reports@mail.draft-punk.com>';
exports.emailReport = onDocumentCreated({ document: 'reports/{reportId}', secrets: [RESEND_API_KEY, ADMIN_UID] }, async event => {
    const r = event.data && event.data.data();
    if (!r) return;
    let reporterName = '';
    try { const u = await db.collection('users').doc(r.from).get(); reporterName = u.exists ? (u.data().username || '') : ''; } catch (e) {}
    let item = '';
    if (r.path && lib.reportPathAllowed(r.path)) {
        try {
            const d = await db.doc(r.path).get();
            if (d.exists) {
                const x = d.data();
                item = r.path.startsWith('shares/')
                    ? `Shared chapter "${x.chapterTitle || ''}" from "${x.projectTitle || ''}" by ${x.ownerUsername || x.ownerId}, ${x.wordCount || 0} words. Ask before reading the chapter itself.`
                    : `From ${x.fromUsername || x.from}: ${x.body || ''}`;
            }
        } catch (e) { logger.warn('Report item lookup failed', { path: r.path, e: e.message }); }
    }
    const mail = lib.reportEmail(r, reporterName, item);
    const subject = mail.subject;
    const text = mail.text + `\n\nDeal with it in the admin area: ${SITE}admin.html`;
    const html = mail.html + `<p style="font-family:sans-serif"><a href="${SITE}admin.html">Open the admin area</a></p>`;
    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + RESEND_API_KEY.value(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: REPORTS_FROM, to: [REPORTS_TO], subject, text, html })
        });
        if (!res.ok) logger.error('Report email failed', { status: res.status, id: event.params.reportId });
    } catch (e) { logger.error('Report email failed', { e: e.message, id: event.params.reportId }); }
    await notifyAdmin('DRAFT PUNK · NEW REPORT', subject.replace(/^Draft Punk report: /, ''));
});

// ── Daily housekeeping (Nov 2026) ────────────────────────────────────────────
// 1. Deletes accounts that gave an under-13 birth date at sign-up (see
//    lib.underageDeletionDue: an account from before the age step can never
//    match). These accounts were blocked in the app from the moment they
//    answered.
// 2. Creates a leaderboard record for any writer who has a username but no
//    record yet (writers who haven't opened the app since profiles became
//    owner-only). Reads only the username and word count fields.
async function deleteWholeAccount(uid) {
    await db.recursiveDelete(db.collection('users').doc(uid));
    const batch = db.batch();
    batch.delete(db.collection('leaderboard').doc(uid));
    const names  = await db.collection('usernames').where('uid', '==', uid).get();
    names.forEach(d => batch.delete(d.ref));
    const links  = await db.collection('evidenceShares').where('uid', '==', uid).get();   // older links
    links.forEach(d => batch.delete(d.ref));
    const owned  = await db.collection('recordOwners').where('uid', '==', uid).get();
    owned.forEach(d => {
        batch.delete(db.collection('evidenceShares').doc(d.id));
        if (d.data().code) batch.delete(db.collection('recordCodes').doc(d.data().code));
        batch.delete(d.ref);
    });
    for (const f of ['from', 'to']) {
        const reqs = await db.collection('friendRequests').where(f, '==', uid).get();
        reqs.forEach(d => batch.delete(d.ref));
    }
    await batch.commit();
    await admin.auth().deleteUser(uid);
}
exports.dailyHousekeeping = onSchedule({ schedule: 'every day 03:17', timeZone: 'Europe/London', secrets: [ADMIN_UID] }, async () => {
    const now = Date.now();
    // 1. Under-13 sign-ups
    const deleted = [];
    let pageToken;
    do {
        const page = await admin.auth().listUsers(1000, pageToken);
        for (const u of page.users) {
            if (Date.parse(u.metadata.creationTime) < lib.AGE_STEP_START) continue;
            const acc = await db.collection('users').doc(u.uid).collection('private').doc('account').get();
            if (!acc.exists || !lib.underageDeletionDue(u.metadata.creationTime, acc.data(), now)) continue;
            try { await deleteWholeAccount(u.uid); deleted.push(u.uid); logger.info('Deleted under-13 sign-up', { uid: u.uid }); }
            catch (e) { logger.error('Under-13 deletion failed', { uid: u.uid, e: e.message }); }
        }
        pageToken = page.pageToken;
    } while (pageToken);
    // 2. Missing leaderboard records
    let filled = 0;
    const profiles = await db.collection('users').select(...lib.LEADERBOARD_FIELDS).get();
    for (const p of profiles.docs) {
        const rec = lib.leaderboardRecord(p.data());
        if (!rec) continue;
        const ref = db.collection('leaderboard').doc(p.id);
        try {
            await db.runTransaction(async tx => { if (!(await tx.get(ref)).exists) { tx.set(ref, rec); filled++; } });
        } catch (e) { logger.warn('Leaderboard fill failed', { uid: p.id, e: e.message }); }
    }
    logger.info('Daily housekeeping', { deleted: deleted.length, leaderboardFilled: filled });
    if (deleted.length) await notifyAdmin('DRAFT PUNK · UNDER-13 ACCOUNTS DELETED', `${deleted.length} account(s) that gave an under-13 birth date at sign-up were deleted.`);
});


// ── Admin (Nov 2026) ─────────────────────────────────────────────────────────
// The admin page calls this once. If the caller is Ross's account (the
// ADMIN_UID secret), it marks the account as admin, which the database rules
// check. Anyone else gets { admin: false } and nothing changes.
exports.claimAdmin = onCall({ enforceAppCheck: true, secrets: [ADMIN_UID] }, async request => {
    const uid = request.auth && request.auth.uid;
    const adminUid = (ADMIN_UID.value() || '').trim();
    if (!uid || !adminUid || uid !== adminUid) return { admin: false };
    const user = await admin.auth().getUser(uid);
    if (!(user.customClaims && user.customClaims.admin === true)) {
        await admin.auth().setCustomUserClaims(uid, { ...(user.customClaims || {}), admin: true });
        logger.info('Admin claim set', { uid });
    }
    return { admin: true };
});


// ── Writing Record share links, issued by the server (Nov 2026) ──────────────
// The writer asks for a share link (or to update one); this function builds
// the report itself from the writer's saved cloud copy, instead of accepting
// figures sent by the browser, and stamps it as issued by Draft Punk. It also
// stores a fingerprint of the text (record-core.js) so a copy of the story can
// later be checked against the record. The fingerprint can't be turned back
// into the text; the text itself is never stored in the share.
//   READ   users/{uid}/private/data, users/{uid}    (project title, username)
//   READ   users/{uid}/writing   (this project's chapters: words + fingerprint)
//   READ   users/{uid}/evidence  (this project's Writing Record figures)
//   WRITE  evidenceShares/{id}   (the public report: no account ID in it)
//   WRITE  recordOwners/{id}     (private: whose report it is, its code and
//                                 chosen chapters; readable by its owner only)
//   WRITE  recordCodes/{code}    (public: short code -> report, e.g. DP-7K3F-9QXM)
//   WRITE  users/{uid}/evidence/_shares  (adds the id to the writer's private
//                                         list, used by account deletion)
// Nothing in the writer's chapters, projects or Writing Record is changed.
const recordCore = require('./record-core');
const crypto = require('crypto');
const SHARE_MAX_BYTES = 900 * 1024;   // Firestore documents hold up to 1 MiB

// A new, unused record code, reserved for this report
async function reserveCode(shareId, now) {
    for (let i = 0; i < 8; i++) {
        const code = recordCore.makeCode(crypto.randomBytes(8));
        try { await db.collection('recordCodes').doc(code).create({ shareId, createdAt: now }); return code; }
        catch (e) { if (!(e && (e.code === 6 || /already exists/i.test(e.message || '')))) throw e; }
    }
    throw new HttpsError('internal', 'code');
}

exports.issueWritingRecord = onCall({ enforceAppCheck: true }, async request => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'sign-in');
    const projectId  = request.data && request.data.projectId;
    const shareId    = request.data && request.data.shareId;
    const chapterIds = request.data && request.data.chapterIds;
    if (typeof projectId !== 'string' || !/^[\w-]{1,120}$/.test(projectId)) throw new HttpsError('invalid-argument', 'project');
    if (shareId != null && (typeof shareId !== 'string' || !/^[a-f0-9]{24}$/.test(shareId))) throw new HttpsError('invalid-argument', 'share');
    if (chapterIds != null && (!Array.isArray(chapterIds) || chapterIds.length > 1000 || !chapterIds.every(c => typeof c === 'string' && /^[\w-]{1,120}$/.test(c)))) throw new HttpsError('invalid-argument', 'chapters');

    const shareRef = db.collection('evidenceShares').doc(shareId || crypto.randomBytes(12).toString('hex'));
    const ownerRef = db.collection('recordOwners').doc(shareRef.id);
    let owner = null;
    if (shareId) {
        const [existing, own] = await Promise.all([shareRef.get(), ownerRef.get()]);
        const mine = (own.exists && own.data().uid === uid) || (existing.exists && existing.data().uid === uid);   // older links kept the owner in the report
        if (!existing.exists || !mine) throw new HttpsError('permission-denied', 'not-yours');
        owner = own.exists ? own.data() : null;
    }

    const userRef = db.collection('users').doc(uid);
    const [w, profile, chapters, evidence] = await Promise.all([
        writerData(uid),
        userRef.get(),
        userRef.collection('writing').where('projectId', '==', projectId).get(),
        userRef.collection('evidence').where('projectId', '==', projectId).get()
    ]);
    const project = w.draftPunkData && w.draftPunkData.projects && w.draftPunkData.projects[projectId];
    if (!project) throw new HttpsError('not-found', 'project');

    const all = chapters.docs.map(d => ({ ...d.data(), id: d.id }));
    const chosen = chapterIds ? all.filter(c => chapterIds.includes(c.id)) : all;
    if (!chosen.length) throw new HttpsError('invalid-argument', 'no-chapters');

    const now = Date.now();
    const { snapshot, text } = recordCore.buildSnapshot({
        title: project.title,
        author: (profile.exists && profile.data().username) || '',
        chapters: chosen,
        evidence: evidence.docs.map(d => ({ ...d.data(), id: d.id })),
        now
    });
    const code = (owner && owner.code) || await reserveCode(shareRef.id, now);
    const share = {
        ...snapshot,
        code,
        chapterScope: { included: chosen.length, total: all.length },
        createdAt: now,
        issuedBy: 'draft-punk', issuedAt: now,
        fingerprint: recordCore.fingerprint(text, crypto.randomBytes(6).toString('hex'))
    };
    // Stay within the document size limit: list fewer pastes individually
    while (Buffer.byteLength(JSON.stringify(share)) > SHARE_MAX_BYTES && share.pastes.length) {
        const old = share.pastes.splice(0, Math.ceil(share.pastes.length / 2));
        share.totals.earlierPastes += old.length;
        share.totals.earlierPastedChars += old.reduce((s, p) => s + p.c, 0);
    }
    // Owner first: the report's delete permission depends on it
    await ownerRef.set({ uid, code, projectId, chapterIds: chapterIds || null, createdAt: (owner && owner.createdAt) || now, updatedAt: now });
    await shareRef.set(share);     // replaces the whole report, so an older link loses its account ID here
    await userRef.collection('evidence').doc('_shares').set({ ids: FieldValue.arrayUnion(shareRef.id) }, { merge: true });
    logger.info('Writing Record issued', { uid, share: shareRef.id, words: snapshot.totals.words, update: !!shareId });
    return { id: shareRef.id, code, words: snapshot.totals.words, issuedAt: now };
});
