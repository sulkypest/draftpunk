// Pure helpers for Draft Punk notifications (no Firebase imports, so they can
// be unit-tested on their own). index.js wires these up to Firestore and FCM.

'use strict';

const DEFAULT_REMINDER_TIME = '19:00';
// How long after the chosen time a reminder may still go out. Stops a reminder
// firing hours late if someone moves their time to earlier in the day.
const REMINDER_WINDOW_MIN = 60;
// Quiet hours, in each writer's own time zone: nothing is sent from 22:00 to
// 08:00. Reminder times are limited to 08:00-21:45 to match.
const QUIET_START = 22 * 60;
const QUIET_END   = 8 * 60;
const EARLIEST_REMINDER = QUIET_END;
const LATEST_REMINDER   = QUIET_START - 15;

function pad(n) { return String(n).padStart(2, '0'); }

// The wall-clock date and time in a time zone, e.g. { date: '2026-11-16',
// yesterday: '2026-11-15', minutes: 1140 }. Date keys match the app's own
// todayKey() format (YYYY-MM-DD), which is written in the writer's local time.
function localParts(tz, now = new Date()) {
    let zone = tz;
    try { new Intl.DateTimeFormat('en-GB', { timeZone: zone }); } catch (e) { zone = 'Europe/London'; }
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    const get = {};
    for (const p of fmt.formatToParts(now)) get[p.type] = p.value;
    const y = +get.year, m = +get.month, d = +get.day;
    const date = `${y}-${pad(m)}-${pad(d)}`;
    const yd = new Date(Date.UTC(y, m - 1, d - 1));
    const yesterday = `${yd.getUTCFullYear()}-${pad(yd.getUTCMonth() + 1)}-${pad(yd.getUTCDate())}`;
    return { date, yesterday, minutes: (+get.hour) * 60 + (+get.minute), zone };
}

function parseTime(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
    if (!m) return parseTime(DEFAULT_REMINDER_TIME);
    const t = Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]);
    return Math.max(EARLIEST_REMINDER, Math.min(LATEST_REMINDER, t));
}

function inQuietHours(tz, now = new Date()) {
    const { minutes } = localParts(tz || 'Europe/London', now);
    return minutes >= QUIET_START || minutes < QUIET_END;
}

function daysBetween(a, b) {   // b - a, for 'YYYY-MM-DD' keys
    const t = k => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((t(b) - t(a)) / 86400000);
}

// What the writer's saved data says about today.
//   wroteToday: words were added today (any project)
//   streak:     the writer streak that ends at midnight if they don't write
//               today (0 if none is alive)
//   freezes:    streak freezes held (a freeze would cover today if missed)
// Uses the account-wide streak (dpStreak) when the writer has one, otherwise
// the best per-project streak, as before.
function writingStatus(draftPunkData, today, yesterday, dpStreak) {
    const projects = Object.values((draftPunkData && draftPunkData.projects) || {});
    let wroteToday = false, streak = 0, freezes = 0;
    for (const p of projects) {
        if (!p) continue;
        if (p.lastWritingDate === today) wroteToday = true;
        if (p.lastWritingDate === yesterday) streak = Math.max(streak, p.currentStreak || 0);
    }
    if (dpStreak && dpStreak.v === 1) {
        if (dpStreak.last === today) wroteToday = true;
        freezes = Math.max(0, Math.min(3, dpStreak.freezes || 0));
        streak = 0;
        if (dpStreak.start && dpStreak.last) {
            const missed = daysBetween(dpStreak.last, today) - 1;   // days with no writing before today
            if (missed <= 0) streak = daysBetween(dpStreak.start, dpStreak.last) + 1;
            else if (freezes >= missed) { streak = daysBetween(dpStreak.start, today); freezes -= missed; }
        }
    }
    return { wroteToday, streak, freezes, hasProjects: projects.length > 0 };
}

// Should the daily reminder go out right now?
// Returns { send: boolean, reason, local } — reason is for logs/tests.
function reminderDecision(settings, draftPunkData, now = new Date(), dpStreak = null) {
    const r = (settings && settings.reminder) || {};
    if (!r.enabled) return { send: false, reason: 'off' };
    if (!settings.tokens || !Object.keys(settings.tokens).length) return { send: false, reason: 'no-devices' };
    const local = localParts(r.tz || 'Europe/London', now);
    if (settings.lastReminderDate === local.date) return { send: false, reason: 'already-sent', local };
    const due = parseTime(r.time);
    if (local.minutes < due) return { send: false, reason: 'not-yet', local };
    if (local.minutes >= Math.min(due + REMINDER_WINDOW_MIN, QUIET_START)) return { send: false, reason: 'window-passed', local };
    const status = writingStatus(draftPunkData, local.date, local.yesterday, dpStreak);
    if (status.wroteToday) return { send: false, reason: 'wrote-today', local, status };
    return { send: true, reason: 'due', local, status };
}

function reminderMessage(status) {
    if (status && status.streak > 1 && status.freezes > 0) {
        return {
            title: `KEEP YOUR ${status.streak}-DAY STREAK`,
            body: `Write today to keep it going. If you don\u2019t, one of your ${status.freezes} streak freeze${status.freezes > 1 ? 's' : ''} will cover it.`
        };
    }
    if (status && status.streak > 1) {
        return {
            title: `${status.streak}-DAY STREAK AT RISK`,
            body: `Your ${status.streak}-day writing streak ends at midnight. Get some words down to keep it going.`
        };
    }
    if (status && status.streak === 1) {
        return { title: 'KEEP IT GOING', body: 'You wrote yesterday. Write today and start a streak.' };
    }
    return { title: 'TIME TO WRITE', body: 'You haven’t written today yet. Even a hundred words counts.' };
}

// Notification wording for social events. Deliberately never includes message
// text or chapter titles: notifications can show on a lock screen.
function socialMessage(kind, info) {
    const who = info.fromUsername ? '@' + info.fromUsername : 'Someone';
    switch (kind) {
        case 'dm':
            return { title: 'NEW MESSAGE', body: `${who} sent you a message.`, url: 'messages.html', tag: 'dm-' + (info.from || '') };
        case 'group':
            return { title: (info.groupName ? String(info.groupName).toUpperCase() : 'GROUP CHAT'),
                     body: `${who} posted in your group.`, url: 'messages.html#group=' + encodeURIComponent(info.groupId || ''),
                     tag: 'group-' + (info.groupId || '') };
        case 'friendRequest':
            return { title: 'FRIEND REQUEST', body: `${who} wants to be writing buddies.`, url: 'groups.html', tag: 'friend-requests' };
        case 'share':
            return { title: 'CHAPTER SHARED', body: `${who} shared a chapter with you.`, url: 'groups.html', tag: 'share-' + (info.from || '') };
        default:
            return null;
    }
}

// Who gets a group message: everyone in the group except whoever sent it.
function groupRecipients(group, fromUid) {
    return [...new Set((group && group.members) || [])].filter(u => u && u !== fromUid);
}

// Errors from FCM that mean the device token is dead and should be forgotten.
function isDeadTokenError(code) {
    return code === 'messaging/registration-token-not-registered'
        || code === 'messaging/invalid-registration-token';
}

// ── Email sign-in codes ──────────────────────────────────────────────────────
const crypto = require('crypto');

const CODE_LENGTH       = 6;
const CODE_TTL_MS       = 10 * 60 * 1000;   // a code works for 10 minutes
const CODE_MAX_ATTEMPTS = 5;                // wrong guesses before a code dies
const RESEND_GAP_MS     = 60 * 1000;        // at least a minute between codes
const CODES_PER_HOUR    = 5;                // per email address
const QUOTA_WARN_AT     = 70;               // Resend free plan: 100 emails a day

function normaliseEmail(email) {
    return String(email || '').trim().toLowerCase();
}
function isValidEmail(email) {
    return typeof email === 'string' && email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}
// Gmail ignores dots and anything after '+', so ross.young1@gmail.com,
// rossyoung1@gmail.com and rossyoung1+dp@googlemail.com are one inbox. Other
// providers don't work like this, so their addresses are left as typed.
const GMAIL_DOMAINS = ['gmail.com', 'googlemail.com'];
function isGmail(email) {
    return GMAIL_DOMAINS.includes(normaliseEmail(email).split('@')[1] || '');
}
function canonicalEmail(email) {
    const e = normaliseEmail(email);
    const at = e.lastIndexOf('@');
    if (at < 0) return e;
    const local = e.slice(0, at), domain = e.slice(at + 1);
    if (!GMAIL_DOMAINS.includes(domain)) return e;
    return local.split('+')[0].replace(/\./g, '') + '@gmail.com';
}
// Every address an account is known by: its own, plus each sign-in provider's
function accountEmails(user) {
    const list = [user && user.email].concat(((user && user.providerData) || []).map(p => p && p.email));
    return list.filter(Boolean);
}
// Of several accounts that share an inbox, the oldest is the writer's original
function pickOriginal(users) {
    return users.slice().sort((a, b) =>
        new Date((a.metadata && a.metadata.creationTime) || 0) - new Date((b.metadata && b.metadata.creationTime) || 0))[0] || null;
}

// Pending codes are stored under a hash of the inbox, never the address
function emailKey(email) {
    return crypto.createHash('sha256').update('dp-signin:' + canonicalEmail(email)).digest('hex');
}
function newCode() {
    return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}
function hashCode(salt, code) {
    return crypto.createHash('sha256').update(salt + ':' + String(code)).digest('hex');
}
function codesMatch(state, code) {
    if (!state || !state.salt || !state.codeHash) return false;
    const a = Buffer.from(hashCode(state.salt, String(code || '').trim()), 'hex');
    const b = Buffer.from(state.codeHash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// May this address be sent a new code now? state is the stored record (or null).
function codeRequestDecision(state, nowMs) {
    if (state && state.lastSentAt && nowMs - state.lastSentAt < RESEND_GAP_MS) {
        return { ok: false, reason: 'cooldown', waitSeconds: Math.ceil((RESEND_GAP_MS - (nowMs - state.lastSentAt)) / 1000) };
    }
    const recent = ((state && state.sentTimes) || []).filter(t => nowMs - t < 60 * 60 * 1000);
    if (recent.length >= CODES_PER_HOUR) return { ok: false, reason: 'hourly' };
    return { ok: true, sentTimes: recent.concat(nowMs) };
}

// Check a typed code against the stored record.
//   { result: 'ok' } | { result: 'expired' } | { result: 'locked' } | { result: 'wrong', left }
function codeCheckDecision(state, code, nowMs) {
    if (!state || !state.codeHash) return { result: 'expired' };
    if (nowMs > state.expiresAt) return { result: 'expired' };
    if ((state.attempts || 0) >= CODE_MAX_ATTEMPTS) return { result: 'locked' };
    if (codesMatch(state, code)) return { result: 'ok' };
    const left = CODE_MAX_ATTEMPTS - (state.attempts || 0) - 1;
    return left > 0 ? { result: 'wrong', left } : { result: 'locked' };
}

function utcDayKey(now = new Date()) {
    return now.toISOString().slice(0, 10);
}

// After an email is sent: should the 'nearly at the limit' alert go out?
function quotaWarningDue(day, warnAt = QUOTA_WARN_AT) {
    return !!day && !day.warned && Math.max(day.sent || 0, day.quotaUsed || 0) >= warnAt;
}

function signInEmail(code) {
    const subject = `Your Draft Punk sign-in code: ${code}`;
    const text = `Your Draft Punk sign-in code is ${code}\n\n` +
        `Type it into Draft Punk to sign in. It works for 10 minutes.\n\n` +
        `If you didn't ask for this, you can ignore this email. Nobody can sign in without the code.`;
    const html = `<div style="font-family:Courier New,monospace;color:#0d0d0d;max-width:420px">` +
        `<p style="font-size:16px">Your Draft Punk sign-in code is</p>` +
        `<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:8px 0 16px">${code}</p>` +
        `<p style="font-size:14px">Type it into Draft Punk to sign in. It works for 10 minutes.</p>` +
        `<p style="font-size:13px;color:#57544f">If you didn't ask for this, you can ignore this email. Nobody can sign in without the code.</p></div>`;
    return { subject, text, html };
}

// How an account signs in, for the weekly summary
function accountKind(user) {
    const ids = ((user && user.providerData) || []).map(p => p.providerId);
    if (ids.includes('google.com')) return 'google';
    if (ids.includes('password')) return 'password';
    return 'code';
}

// users: [{ creationTime, providerData }], days: { 'YYYY-MM-DD': { sent, quotaUsed } }
function weeklySummary(users, days, now = new Date()) {
    const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    const fresh = users.filter(u => new Date(u.creationTime).getTime() >= weekAgo);
    const kinds = { google: 0, code: 0, password: 0 };
    fresh.forEach(u => { kinds[accountKind(u)]++; });
    let codes = 0, busiest = null;
    Object.entries(days || {}).forEach(([key, d]) => {
        const n = Math.max((d && d.sent) || 0, (d && d.quotaUsed) || 0);
        codes += n;
        if (!busiest || n > busiest.n) busiest = { key, n };
    });
    const weekday = k => new Date(k + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
    const body = `${fresh.length} new writer${fresh.length === 1 ? '' : 's'} (${kinds.google} Google, ${kinds.code} email code, ${kinds.password} password). ` +
        `${users.length} in total. Sign-in emails: ${codes}` +
        (busiest && busiest.n ? `, busiest ${busiest.n} on ${weekday(busiest.key)}` : '') +
        `. Free limit is 100 a day.`;
    return { title: 'DRAFT PUNK · WEEK IN NUMBERS', body, newWriters: fresh.length, kinds, total: users.length, codes, busiest };
}

// ── Age (Nov 2026) ───────────────────────────────────────────────────────────
// Accounts created on or after this moment had to give a birth date at
// sign-up. SET TO THE LIVE RELEASE DATE (same as AGE_STEP_START in sync.js).
const AGE_STEP_START = Date.parse('2026-11-22T17:02:00Z');
// Same sum as the app and the database rules: whole months, rounding down,
// so during the birth month the birthday counts as not yet reached.
function ageFromYM(birthYear, birthMonth, now) {
    const d = new Date(now);
    let a = d.getUTCFullYear() - birthYear;
    if (d.getUTCMonth() + 1 <= birthMonth) a--;
    return a;
}
// Should this account be deleted as an under-13 sign-up? Every condition must
// hold, so a writer who had an account before the age step can never match:
//  - created on or after the age step went live
//  - gave a birth date that makes them under 13 now
//  - gave it within 2 days of creating the account (i.e. at sign-up)
function underageDeletionDue(authCreated, account, now) {
    if (!account || !Number.isInteger(account.birthYear) || !Number.isInteger(account.birthMonth)) return false;
    const created = typeof authCreated === 'number' ? authCreated : Date.parse(authCreated);
    if (!created || created < AGE_STEP_START) return false;
    if (!account.acceptedAt || account.acceptedAt - created > 2 * 24 * 60 * 60 * 1000) return false;
    return ageFromYM(account.birthYear, account.birthMonth, now) < 13;
}
const LEADERBOARD_FIELDS = ['username', 'totalWords', 'wordsThisWeek', 'wordsThisMonth', 'wordsThisYear', 'weekEndsAt', 'monthEndsAt', 'yearEndsAt'];
function leaderboardRecord(profile) {
    if (!profile || typeof profile.username !== 'string' || !profile.username) return null;
    const out = {};
    LEADERBOARD_FIELDS.forEach(k => { out[k] = k === 'username' ? profile.username : (Number(profile[k]) || 0); });
    return out;
}
const REPORT_REASONS = {
    harassment: 'Bullying or harassment', sexual: 'Sexual content or unwanted advances',
    'child-safety': 'May be a risk to children', underage: 'May be under 16',
    hate: 'Hate or abuse', spam: 'Spam or scams', other: 'Something else'
};
// Only these paths may be looked up for a report (never anyone's writing)
function reportPathAllowed(path) {
    return /^messages\/[A-Za-z0-9_-]+$/.test(path) ||
           /^groups\/[A-Za-z0-9_-]+\/messages\/[A-Za-z0-9_-]+$/.test(path) ||
           /^shares\/[A-Za-z0-9_-]+$/.test(path);
}
function reportEmail(r, reporterName, item) {
    const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const reason = REPORT_REASONS[r.reason] || r.reason || 'Not given';
    const urgent = r.reason === 'child-safety';
    const lines = [
        ['Reason', reason],
        ['Type', r.type],
        ['Reported writer', `${r.targetUsername || '?'} (${r.targetUid || '?'})`],
        ['Reported by', `${reporterName || '?'} (${r.from})`],
        ['When', new Date(r.createdAt || Date.now()).toUTCString()],
        ['Item', r.path || '—'],
        ['Text as the reporter saw it', r.excerpt || '—'],
        ['Text now in the database', item ? item : (r.path ? '(no longer there, or not found)' : '—')],
        ['Reporter\'s note', r.note || '—']
    ];
    const subject = `${urgent ? 'URGENT · ' : ''}Draft Punk report: ${reason} · ${r.targetUsername || '?'}`;
    const text = lines.map(([k, v]) => `${k}: ${v}`).join('\n');
    const html = `<table cellpadding="6" style="font-family:sans-serif;font-size:14px;border-collapse:collapse">` +
        lines.map(([k, v]) => `<tr><td style="vertical-align:top;color:#666;white-space:nowrap">${esc(k)}</td><td style="white-space:pre-wrap">${esc(v)}</td></tr>`).join('') + `</table>`;
    return { subject, text, html };
}

module.exports = {
    AGE_STEP_START, ageFromYM, underageDeletionDue, LEADERBOARD_FIELDS, leaderboardRecord,
    REPORT_REASONS, reportPathAllowed, reportEmail,
    DEFAULT_REMINDER_TIME, REMINDER_WINDOW_MIN, QUIET_START, QUIET_END,
    localParts, parseTime, inQuietHours, writingStatus, reminderDecision, reminderMessage,
    socialMessage, groupRecipients, isDeadTokenError,
    CODE_TTL_MS, CODE_MAX_ATTEMPTS, RESEND_GAP_MS, CODES_PER_HOUR, QUOTA_WARN_AT,
    normaliseEmail, isValidEmail, isGmail, canonicalEmail, accountEmails, pickOriginal, emailKey, newCode, hashCode, codesMatch,
    codeRequestDecision, codeCheckDecision, utcDayKey, quotaWarningDue, signInEmail,
    accountKind, weeklySummary
};
