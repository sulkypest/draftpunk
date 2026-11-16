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
const REGION = 'europe-west2';

setGlobalOptions({ region: REGION, maxInstances: 5 });

admin.initializeApp();
const db = admin.firestore();
const { FieldValue, FieldPath } = admin.firestore;

const SITE = 'https://www.draft-punk.com/';

function settingsRef(uid) { return db.collection('users').doc(uid).collection('private').doc('notifications'); }

async function writerData(uid) {
    const priv = await db.collection('users').doc(uid).collection('private').doc('data').get();
    if (priv.exists && priv.data().draftPunkData) return priv.data().draftPunkData;
    const pub = await db.collection('users').doc(uid).get();
    return pub.exists ? (pub.data().draftPunkData || null) : null;
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
// local time (within the hour after it), they haven't written today, and they
// haven't been reminded today, send one reminder.
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
            const decision = lib.reminderDecision(settings, await writerData(u.id), now);
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
