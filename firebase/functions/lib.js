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

module.exports = {
    DEFAULT_REMINDER_TIME, REMINDER_WINDOW_MIN, QUIET_START, QUIET_END,
    localParts, parseTime, inQuietHours, writingStatus, reminderDecision, reminderMessage,
    socialMessage, groupRecipients, isDeadTokenError
};
