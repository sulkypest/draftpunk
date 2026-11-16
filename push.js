// ── Notifications (daily writing reminder + social alerts) ───────────────────
// Loaded on demand by sync.js. Everything here is switched off until
// VAPID_KEY is filled in (Firebase console → Project settings → Cloud
// Messaging → Web Push certificates → Key pair). Set it only AFTER the
// "draftpunk" Cloud Functions have been deployed.
//
// Stores, per writer, in users/{uid}/private/notifications (owner-only):
//   tokens:   { <device token>: { addedAt, device } }   one per device turned on
//   reminder: { enabled, time: 'HH:MM', tz }             account-wide
//   social:   { enabled }                                account-wide
// Never touches projects, chapters or word counts.

import { getMessaging, getToken, deleteToken, isSupported }
    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteField, FieldPath }
    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export const VAPID_KEY = 'BLud6xWJk0UR7gCkX9NZLDNIpzfc3zdyMsMqsfZ73Tp0NJyP1U0rNjxa9IdmqD3qjq6wytwuMPD2LM4xL6SQA_8';

const LS_TOKEN = 'dpPushToken';
const LS_OFFERED = 'dpNotifyOfferedAt';
const DEFAULT_TIME = '19:00';
// Quiet hours are 22:00-08:00 (enforced by the Cloud Functions too), so the
// reminder can only be set between these times.
const EARLIEST_TIME = '08:00';
const LATEST_TIME = '21:45';
const OFFER_AGAIN_AFTER = 30 * 86400000;   // "Not now" = ask again in 30 days

let _app = null, _getUser = () => null;

export function initPush(app, getUser) {
    _app = app; _getUser = getUser;
    // Keep the reminder in the writer's current time zone (e.g. after travel)
    const user = getUser();
    if (VAPID_KEY && user && localStorage.getItem(LS_TOKEN)) refreshTimeZone(user).catch(() => {});
}

function db() { return getFirestore(_app); }
function settingsRef(uid) { return doc(db(), 'users', uid, 'private', 'notifications'); }
function localTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London'; } catch (e) { return 'Europe/London'; } }

function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isInstalled() {
    return window.navigator.standalone === true
        || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}
function deviceLabel() {
    const ua = navigator.userAgent;
    if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/Android/.test(ua)) return 'Android';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows';
    return 'Browser';
}

// 'off' (feature not switched on yet) | 'unsupported' | 'ios-install' |
// 'denied' | 'available' (can be turned on) | 'on' (this device is on)
export async function pushState() {
    if (!VAPID_KEY) return 'off';
    if (isIOS() && !isInstalled()) return 'ios-install';
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
    let ok = false;
    try { ok = await isSupported(); } catch (e) { ok = false; }
    if (!ok) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission === 'granted' && localStorage.getItem(LS_TOKEN)) return 'on';
    return 'available';
}

// Must be called straight from a tap/click: Safari only shows the permission
// prompt if it is asked for before anything else is awaited.
export async function enableOnThisDevice() {
    const user = _getUser();
    if (!user) throw new Error('Sign in first.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error(permission === 'denied'
        ? 'Notifications are blocked. You can allow them in your browser settings.'
        : 'Notifications weren’t allowed.');
    const reg = await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(_app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) throw new Error('Couldn’t set up notifications on this device.');

    const ref = settingsRef(user.uid);
    const snap = await getDoc(ref);
    const existing = snap.exists() ? snap.data() : {};
    const update = { tokens: { [token]: { addedAt: Date.now(), device: deviceLabel() } } };
    // First device: start with both kinds of notification on, at 7pm local.
    if (!existing.reminder) update.reminder = { enabled: true, time: DEFAULT_TIME, tz: localTz() };
    else update.reminder = { ...existing.reminder, tz: localTz() };
    if (!existing.social) update.social = { enabled: true };
    await setDoc(ref, update, { merge: true });
    localStorage.setItem(LS_TOKEN, token);
    return token;
}

export async function disableOnThisDevice() {
    const user = _getUser();
    const token = localStorage.getItem(LS_TOKEN);
    localStorage.removeItem(LS_TOKEN);
    if (token && user) {
        try { await updateDoc(settingsRef(user.uid), new FieldPath('tokens', token), deleteField()); } catch (e) { /* already gone */ }
    }
    try { await deleteToken(getMessaging(_app)); } catch (e) { /* nothing to delete */ }
}

// Called before sign-out, so a shared or old device stops getting this
// writer's notifications.
export async function forgetThisDevice() {
    if (!localStorage.getItem(LS_TOKEN)) return;
    await disableOnThisDevice();
}

export async function getSettings() {
    const user = _getUser();
    if (!user) return null;
    const snap = await getDoc(settingsRef(user.uid));
    const s = snap.exists() ? snap.data() : {};
    return {
        reminder: { enabled: true, time: DEFAULT_TIME, tz: localTz(), ...(s.reminder || {}) },
        social:   { enabled: true, ...(s.social || {}) },
        devices:  Object.values(s.tokens || {}).map(t => t.device || 'Browser')
    };
}

export async function saveSettings({ reminderEnabled, time, socialEnabled }) {
    const user = _getUser();
    if (!user) return;
    let t = /^\d{2}:\d{2}$/.test(time || '') ? time : DEFAULT_TIME;
    if (t < EARLIEST_TIME) t = EARLIEST_TIME;
    if (t > LATEST_TIME) t = LATEST_TIME;
    await setDoc(settingsRef(user.uid), {
        reminder: { enabled: !!reminderEnabled, time: t, tz: localTz() },
        social:   { enabled: !!socialEnabled }
    }, { merge: true });
}

async function refreshTimeZone(user) {
    const ref = settingsRef(user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const r = snap.data().reminder;
    if (r && r.tz !== localTz()) await setDoc(ref, { reminder: { ...r, tz: localTz() } }, { merge: true });
}

// ── Account-panel section ────────────────────────────────────────────────────
const small = 'font-size:0.62rem;opacity:0.5;letter-spacing:1px;margin:0 0 12px;line-height:1.5;';
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export async function renderNotificationSettings(container) {
    if (!container) return;
    const state = await pushState();
    if (state === 'off') { container.innerHTML = ''; return; }

    const head = `<div style="border-top:1px solid var(--border,#2a2a2a);margin:20px 0 16px;"></div>
        <div style="font-size:0.6rem;opacity:0.4;letter-spacing:2px;margin-bottom:12px;">NOTIFICATIONS</div>`;
    const err = `<p id="dpNotifyMsg" style="color:#ff4500;font-size:0.65rem;margin:6px 0 0;letter-spacing:1px;min-height:1em;"></p>`;

    if (state === 'unsupported') {
        container.innerHTML = head + `<p style="${small}">This browser can’t show notifications from Draft Punk.</p>`;
        return;
    }
    if (state === 'ios-install') {
        container.innerHTML = head + `<p style="${small}">On iPhone and iPad, notifications only work once Draft Punk is on your Home Screen. In Safari, tap Share → Add to Home Screen, then open Draft Punk from there and come back here.</p>`;
        return;
    }
    if (state === 'denied') {
        container.innerHTML = head + `<p style="${small}">Notifications are blocked for Draft Punk. Allow them in your browser or device settings, then come back here.</p>`;
        return;
    }
    if (state === 'available') {
        container.innerHTML = head + `
            <p style="${small}">A daily nudge to write (only if you haven’t yet that day), plus alerts for messages, friend requests and shared chapters.</p>
            <button id="dpNotifyOn" style="width:100%;">🔔 TURN ON NOTIFICATIONS</button>${err}`;
        const btn = container.querySelector('#dpNotifyOn');
        btn.onclick = () => {
            btn.disabled = true; btn.textContent = 'SETTING UP…';
            enableOnThisDevice()
                .then(() => renderNotificationSettings(container))
                .catch(e => {
                    btn.disabled = false; btn.textContent = '🔔 TURN ON NOTIFICATIONS';
                    container.querySelector('#dpNotifyMsg').textContent = e.message || 'Something went wrong.';
                });
        };
        return;
    }

    // state === 'on'
    const s = await getSettings();
    const others = Math.max(0, s.devices.length - 1);
    container.innerHTML = head + `
        <label style="display:flex;align-items:center;gap:10px;font-size:0.72rem;letter-spacing:1px;margin-bottom:8px;cursor:pointer;">
            <input type="checkbox" id="dpRemOn" ${s.reminder.enabled ? 'checked' : ''} style="width:18px;height:18px;min-width:18px;flex:0 0 18px;margin:0;padding:0;accent-color:var(--neon,#0ff);">
            DAILY WRITING REMINDER
        </label>
        <div style="display:flex;align-items:center;gap:10px;margin:0 0 4px 26px;">
            <span style="font-size:0.65rem;opacity:0.6;letter-spacing:1px;">AT</span>
            <input type="time" id="dpRemTime" value="${esc(s.reminder.time)}" min="${EARLIEST_TIME}" max="${LATEST_TIME}" step="900" style="width:auto;margin:0;padding:6px 8px;">
        </div>
        <p style="${small}margin-left:26px;">Only sent if you haven’t written that day. If you’re on a streak, it tells you what’s at stake.</p>
        <label style="display:flex;align-items:center;gap:10px;font-size:0.72rem;letter-spacing:1px;margin-bottom:14px;cursor:pointer;">
            <input type="checkbox" id="dpSocialOn" ${s.social.enabled ? 'checked' : ''} style="width:18px;height:18px;min-width:18px;flex:0 0 18px;margin:0;padding:0;accent-color:var(--neon,#0ff);">
            MESSAGES, FRIENDS &amp; SHARES
        </label>
        <p style="${small}">Nothing is sent between 10pm and 8am. On for this device${others ? ` and ${others} other${others > 1 ? 's' : ''}` : ''}; settings apply to all your devices.</p>
        <button id="dpNotifyOff" style="width:100%;background:#333;">TURN OFF ON THIS DEVICE</button>${err}`;

    const msg = container.querySelector('#dpNotifyMsg');
    const timeEl = container.querySelector('#dpRemTime');
    timeEl.addEventListener('change', () => {
        if (timeEl.value && timeEl.value < EARLIEST_TIME) timeEl.value = EARLIEST_TIME;
        if (timeEl.value && timeEl.value > LATEST_TIME) timeEl.value = LATEST_TIME;
    });
    const save = () => saveSettings({
        reminderEnabled: container.querySelector('#dpRemOn').checked,
        time:            container.querySelector('#dpRemTime').value,
        socialEnabled:   container.querySelector('#dpSocialOn').checked
    }).then(() => { msg.style.color = 'var(--neon,#0ff)'; msg.textContent = 'SAVED'; setTimeout(() => { msg.textContent = ''; }, 1500); })
      .catch(() => { msg.style.color = '#ff4500'; msg.textContent = 'Couldn’t save. Try again.'; });
    ['#dpRemOn', '#dpRemTime', '#dpSocialOn'].forEach(sel => container.querySelector(sel).addEventListener('change', save));
    container.querySelector('#dpNotifyOff').onclick = async () => {
        await disableOnThisDevice();
        renderNotificationSettings(container);
    };
}

// ── One-tap offer ────────────────────────────────────────────────────────────
// Shown once, after a writer has just saved words (the moment a daily nudge
// makes sense), as a small bar at the bottom: one tap turns everything on with
// the defaults (reminder at 7pm if they haven't written; message alerts; quiet
// overnight). "Not now" or ignoring it means it won't ask again for 30 days.
// Not shown where it can't work (iPhone/iPad outside the Home Screen app,
// blocked notifications) or once it's already on.
let _offeredThisVisit = false;
export async function maybeOfferNotifications() {
    if (_offeredThisVisit || !_getUser()) return;
    const last = parseInt(localStorage.getItem(LS_OFFERED) || '0');
    if (last && Date.now() - last < OFFER_AGAIN_AFTER) return;
    if (await pushState() !== 'available') return;
    _offeredThisVisit = true;

    // Wait for the sync / streak / level-up toasts to finish first
    for (let i = 0; i < 40 && document.querySelector('.write-toast, .combat-toast'); i++) {
        await new Promise(r => setTimeout(r, 750));
    }
    localStorage.setItem(LS_OFFERED, String(Date.now()));

    const bar = document.createElement('div');
    bar.id = 'dpNotifyOffer';
    bar.style.cssText = `position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:1000;
        width:380px;max-width:92vw;box-sizing:border-box;background:var(--panel,#161616);
        border:1px solid var(--neon,#0ff);padding:14px 16px;font-family:'Courier New',monospace;
        color:var(--text,#fff);display:flex;align-items:center;gap:12px;`;
    bar.innerHTML = `
        <div style="flex:1;min-width:0;">
            <div style="font-size:0.75rem;font-weight:900;letter-spacing:2px;">\uD83D\uDD14 DAILY NUDGE?</div>
            <div id="dpOfferSub" style="font-size:0.62rem;opacity:0.6;letter-spacing:1px;margin-top:4px;line-height:1.4;">A reminder if you haven\u2019t written by 7pm, plus message alerts.</div>
        </div>
        <button id="dpOfferYes" style="margin:0;padding:8px 12px;font-size:0.7rem;white-space:nowrap;">TURN ON</button>
        <button id="dpOfferNo" aria-label="Not now" style="margin:0;padding:8px 10px;font-size:0.9rem;background:transparent;border:none;color:var(--text,#fff);opacity:0.7;box-shadow:none;">\u2715</button>`;
    document.body.appendChild(bar);
    const close = () => bar.remove();
    bar.querySelector('#dpOfferNo').onclick = close;
    bar.querySelector('#dpOfferYes').onclick = () => {
        const yes = bar.querySelector('#dpOfferYes');
        yes.disabled = true;
        enableOnThisDevice().then(() => {
            yes.remove();
            bar.querySelector('#dpOfferSub').textContent = 'On. Change it any time in Account.';
            setTimeout(close, 3500);
        }).catch(e => {
            yes.disabled = false;
            bar.querySelector('#dpOfferSub').textContent = e.message || 'Couldn\u2019t turn notifications on.';
        });
    };
}
