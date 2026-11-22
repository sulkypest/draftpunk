// Firestore rules tests for the Nov 2026 age changes.
// Needs the Firestore emulator:  npx firebase emulators:exec --only firestore "node tests/rules.test.mjs"
// (requires: npm i -D @firebase/rules-unit-testing firebase)
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, setDoc, getDoc, deleteDoc, updateDoc } from 'firebase/firestore';

const env = await initializeTestEnvironment({
    projectId: 'dp-rules-test',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') }
});
const Y = new Date().getUTCFullYear();
const ADULT = { birthYear: Y - 30, birthMonth: 1, termsVersion: '2026-11' };
const TEEN  = { birthYear: Y - 17, birthMonth: 1, termsVersion: '2026-11' };
const CHILD = { birthYear: Y - 14, birthMonth: 1, termsVersion: '2026-11' };

async function seed() {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async ctx => {
        const db = ctx.firestore();
        const put = (p, d) => setDoc(doc(db, p), d);
        await put('users/adult', { username: 'adult', friends: ['teen', 'child', 'old'] });
        await put('users/teen',  { username: 'teen',  friends: ['adult'] });
        await put('users/child', { username: 'child', friends: ['adult'] });
        await put('users/old',   { username: 'old',   friends: ['adult'] });   // hasn't answered yet
        await put('users/stranger', { username: 'stranger', friends: [] });
        await put('users/adult/private/account', ADULT);
        await put('users/teen/private/account', TEEN);
        await put('users/child/private/account', CHILD);
        await put('users/stranger/private/account', ADULT);
        await put('users/adult/writing/ch1', { text: 'hello' });
        await put('users/child/writing/ch1', { text: 'hello' });
        await put('users/child/private/data', { x: 1 });
        await put('usernames/teen', { uid: 'teen' });
        await put('usernames/adult', { uid: 'adult' });
        await put('users/adult/private/blocks', { uids: ['stranger2'] });
        await put('users/stranger2', { username: 'stranger2', friends: ['adult'] });
        await put('users/stranger2/private/account', ADULT);
        await put('users/adult', { username: 'adult', friends: ['teen', 'child', 'old', 'stranger2'] });
        await put('shares/child_ch1', { ownerId: 'child', sharedWith: ['adult', 'teen'] });
    });
}
const as = uid => env.authenticatedContext(uid).firestore();
const msg = (from, to) => ({ from, to, body: 'hi', read: false, createdAt: 1 });
let n = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); n++; console.log('ok   ', name); }
    catch (e) { failed++; console.log('FAIL ', name, '\n      ', e.message); }
}

await seed();
// Writing is never age-checked
await t('child can still write', () => assertSucceeds(setDoc(doc(as('child'), 'users/child/writing/ch2'), { text: 'x' })));
await t('child can still read own private data', () => assertSucceeds(getDoc(doc(as('child'), 'users/child/private/data'))));
await t('existing writer with no birth date can write', () => assertSucceeds(setDoc(doc(as('old'), 'users/old/writing/ch1'), { text: 'x' })));

// Birth date
await t('can give a birth date', () => assertSucceeds(setDoc(doc(as('old'), 'users/old/private/account'), ADULT)));
await t('can\'t change it', () => assertFails(setDoc(doc(as('child'), 'users/child/private/account'), ADULT)));
await t('can re-accept terms', () => assertSucceeds(setDoc(doc(as('child'), 'users/child/private/account'), { termsVersion: '2027-01' }, { merge: true })));
await t('can\'t read someone else\'s', () => assertFails(getDoc(doc(as('adult'), 'users/child/private/account'))));
await t('silly month refused', () => assertFails(setDoc(doc(as('newbie'), 'users/newbie/private/account'), { birthYear: 2000, birthMonth: 13 })));
await t('own account doc deletable (account deletion)', () => assertSucceeds(deleteDoc(doc(as('teen'), 'users/teen/private/account'))));
await seed();

// Messages
await t('adult -> teen friend', () => assertSucceeds(setDoc(doc(as('adult'), 'messages/m1'), msg('adult', 'teen'))));
await t('teen -> adult friend', () => assertSucceeds(setDoc(doc(as('teen'), 'messages/m2'), msg('teen', 'adult'))));
await t('adult -> not-yet-answered friend', () => assertSucceeds(setDoc(doc(as('adult'), 'messages/m3'), msg('adult', 'old'))));
await t('child can\'t send', () => assertFails(setDoc(doc(as('child'), 'messages/m4'), msg('child', 'adult'))));
await t('can\'t send to child', () => assertFails(setDoc(doc(as('adult'), 'messages/m5'), msg('adult', 'child'))));
await t('not-yet-answered can\'t send', () => assertFails(setDoc(doc(as('old'), 'messages/m6'), msg('old', 'adult'))));
await t('stranger can\'t message (not a friend)', () => assertFails(setDoc(doc(as('stranger'), 'messages/m7'), msg('stranger', 'teen'))));

// Friend requests
const fr = (from, to) => ({ from, to, fromUsername: from, toUsername: to, createdAt: 1 });
await t('no request to a 16/17 year old', () => assertFails(setDoc(doc(as('stranger'), 'friendRequests/stranger_teen'), fr('stranger', 'teen'))));
await t('16/17 year old can send a request', () => assertSucceeds(setDoc(doc(as('teen'), 'friendRequests/teen_stranger'), fr('teen', 'stranger'))));
await t('request to a not-yet-answered writer', () => assertSucceeds(setDoc(doc(as('stranger'), 'friendRequests/stranger_old'), fr('stranger', 'old'))));
await t('no request to child', () => assertFails(setDoc(doc(as('stranger'), 'friendRequests/stranger_child'), fr('stranger', 'child'))));
await t('child can\'t send request', () => assertFails(setDoc(doc(as('child'), 'friendRequests/child_stranger'), fr('child', 'stranger'))));

// Groups
const grp = owner => ({ ownerId: owner, members: [owner, 'adult'], name: 'G' });
await t('teen can create group', () => assertSucceeds(setDoc(doc(as('teen'), 'groups/g1'), grp('teen'))));
await t('child can\'t create group', () => assertFails(setDoc(doc(as('child'), 'groups/g2'), grp('child'))));

// Shares
await t('child can\'t share', () => assertFails(setDoc(doc(as('child'), 'shares/child_ch2'), { ownerId: 'child', sharedWith: ['adult'] })));
await t('child can narrow an old share', () => assertSucceeds(setDoc(doc(as('child'), 'shares/child_ch1'), { ownerId: 'child', sharedWith: ['adult'] })));
await t('child can delete an old share', () => assertSucceeds(deleteDoc(doc(as('child'), 'shares/child_ch1'))));
await t('adult can share', () => assertSucceeds(setDoc(doc(as('adult'), 'shares/adult_x'), { ownerId: 'adult', sharedWith: ['teen'] })));
await t('nobody can overwrite another\'s share', () => assertFails(setDoc(doc(as('stranger'), 'shares/adult_x'), { ownerId: 'stranger', sharedWith: [] })));

// Usernames
await t('can\'t take someone else\'s username', () => assertFails(setDoc(doc(as('stranger'), 'usernames/teen'), { uid: 'stranger' })));
await t('can claim a free username', () => assertSucceeds(setDoc(doc(as('stranger'), 'usernames/newname'), { uid: 'stranger' })));

// Profiles are owner-only now
await t('can read own profile', () => assertSucceeds(getDoc(doc(as('adult'), 'users/adult'))));
await t('can\'t read someone else\'s profile', () => assertFails(getDoc(doc(as('teen'), 'users/adult'))));
// Leaderboard
const lb = name => ({ username: name, totalWords: 10, wordsThisWeek: 1, wordsThisMonth: 1, wordsThisYear: 1, weekEndsAt: 1, monthEndsAt: 1, yearEndsAt: 1 });
await t('write own leaderboard record', () => assertSucceeds(setDoc(doc(as('adult'), 'leaderboard/adult'), lb('adult'))));
await t('others can read it', () => assertSucceeds(getDoc(doc(as('teen'), 'leaderboard/adult'))));
await t('can\'t use someone else\'s username', () => assertFails(setDoc(doc(as('stranger'), 'leaderboard/stranger'), lb('adult'))));
await t('can\'t add other fields', () => assertFails(setDoc(doc(as('adult'), 'leaderboard/adult'), { ...lb('adult'), photoURL: 'x' })));
await t('can\'t write someone else\'s record', () => assertFails(setDoc(doc(as('teen'), 'leaderboard/adult'), lb('adult'))));
// Blocking
await t('blocked writer can\'t message (even as a friend)', () => assertFails(setDoc(doc(as('stranger2'), 'messages/b1'), msg('stranger2', 'adult'))));
await t('blocked writer can\'t send a request', () => assertFails(setDoc(doc(as('stranger2'), 'friendRequests/stranger2_adult'), fr('stranger2', 'adult'))));
// Reports
const rep = { from: 'teen', type: 'message', targetUid: 'adult', targetUsername: 'adult', path: 'messages/m1', excerpt: 'hi', reason: 'other', note: '', createdAt: 1 };
await t('can send a report', () => assertSucceeds(setDoc(doc(as('teen'), 'reports/r1'), rep)));
await t('can\'t read reports', () => assertFails(getDoc(doc(as('teen'), 'reports/r1'))));
await t('can\'t report as someone else', () => assertFails(setDoc(doc(as('child'), 'reports/r2'), rep)));

// Admin and suspension
const admin = env.authenticatedContext('ross', { admin: true }).firestore();
await t('admin can read reports', () => assertSucceeds(getDoc(doc(admin, 'reports/r1'))));
await t('admin can mark a report dealt with', () => assertSucceeds(setDoc(doc(admin, 'reports/r1'), { status: 'done', adminNote: 'warned', handledAt: 2 }, { merge: true })));
await t('admin can\'t rewrite what was reported', () => assertFails(setDoc(doc(admin, 'reports/r1'), { excerpt: 'changed' }, { merge: true })));
await t('non-admin can\'t claim admin by field', () => assertFails(getDoc(doc(env.authenticatedContext('teen', { admin: false }).firestore(), 'reports/r1'))));
await t('admin can read a reported message', () => assertSucceeds(getDoc(doc(admin, 'messages/m1'))));
await t('admin can delete a reported message', () => assertSucceeds(deleteDoc(doc(admin, 'messages/m1'))));
await t('non-admin can\'t suspend', () => assertFails(setDoc(doc(as('teen'), 'suspended/adult'), { at: 1 })));
await t('admin can suspend', () => assertSucceeds(setDoc(doc(admin, 'suspended/adult'), { at: 1, reason: 'test' })));
await t('suspended writer can see why', () => assertSucceeds(getDoc(doc(as('adult'), 'suspended/adult'))));
await t('suspended writer can still read their writing', () => assertSucceeds(getDoc(doc(as('adult'), 'users/adult/writing/ch1'))));
await t('suspended writer can\'t add to their writing', () => assertFails(setDoc(doc(as('adult'), 'users/adult/writing/ch1'), { text: 'more' })));
await t('suspended writer can\'t save project data', () => assertFails(setDoc(doc(as('adult'), 'users/adult/private/data'), { x: 2 })));
await t('suspended writer can still delete their writing (account deletion)', () => assertSucceeds(deleteDoc(doc(as('adult'), 'users/adult/writing/ch1'))));
await t('suspended writer can\'t message', () => assertFails(setDoc(doc(as('adult'), 'messages/s1'), msg('adult', 'teen'))));
await t('suspended writer can\'t lift it', () => assertFails(deleteDoc(doc(as('adult'), 'suspended/adult'))));
await t('admin can lift it', () => assertSucceeds(deleteDoc(doc(admin, 'suspended/adult'))));
await t('writing works again after', () => assertSucceeds(setDoc(doc(as('adult'), 'users/adult/writing/ch2'), { text: 'back' })));
await t('other writers unaffected throughout', () => assertSucceeds(setDoc(doc(as('teen'), 'users/teen/writing/ch1'), { text: 'x' })));

// Notices
const note = { type: 'update', title: 'Hello', body: 'News', buttonText: '', buttonUrl: '', startAt: 1, endAt: 0, createdAt: 1 };
await t('admin can post a notice', () => assertSucceeds(setDoc(doc(admin, 'announcements/n1'), note)));
await t('writers can read notices', () => assertSucceeds(getDoc(doc(as('teen'), 'announcements/n1'))));
await t('writers can\'t post notices', () => assertFails(setDoc(doc(as('adult'), 'announcements/n2'), note)));
await t('writers can\'t edit notices', () => assertFails(setDoc(doc(as('adult'), 'announcements/n1'), { ...note, title: 'x' })));
await t('signed-out can\'t read notices', () => assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'announcements/n1'))));
await t('writer can record seen notices', () => assertSucceeds(setDoc(doc(as('adult'), 'users/adult/private/notices'), { seen: ['n1'], offersOff: true })));
await t('admin can delete a notice', () => assertSucceeds(deleteDoc(doc(admin, 'announcements/n1'))));

console.log(`\n${n} passed, ${failed} failed`);
await env.cleanup();
process.exit(failed ? 1 : 0);
