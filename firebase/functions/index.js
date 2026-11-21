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

    let user;
    try {
        user = await admin.auth().getUserByEmail(email);
        if (user.disabled) throw new HttpsError('failed-precondition', 'disabled', { reason: 'disabled' });
        // The writer has just proved they own the address
        if (!user.emailVerified) await admin.auth().updateUser(user.uid, { emailVerified: true });
    } catch (err) {
        if (err instanceof HttpsError) throw err;
        if (err.code !== 'auth/user-not-found') throw err;
        user = await admin.auth().createUser({ email, emailVerified: true });
        logger.info('New account from sign-in code', { uid: user.uid });
    }
    const token = await admin.auth().createCustomToken(user.uid);
    return { token };
});

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
    await notifyAdmin(summary.title, summary.body);
});
