# Draft Punk — Firebase back end

Everything that runs on Firebase's side (rather than in the browser) lives here.

| Path | What it is |
|---|---|
| `functions/` | Cloud Functions, codebase **`draftpunk`**: daily writing reminder + alerts for messages, group chat, friend requests and shared chapters |
| `../firestore.rules` | Firestore security rules (still at the repo root; deployed separately, see the header of that file) |

The notifications need **no rules change**. They only use `users/{uid}/private/notifications`, which the existing owner-only `private` rule already covers.

## What the functions do

- **`dailyWritingReminder`** runs every 15 minutes. It sends a writer one reminder a day, at the time they chose in their own time zone, only if they haven't written that day. If a streak would end at midnight, the message says so.
- **`notifyDirectMessage` / `notifyGroupMessage` / `notifyFriendRequest` / `notifyChapterShare`** run when one of those is created and notify the recipient(s). They never include message text or chapter titles, because notifications can appear on a lock screen.
- **Data written:** only `lastReminderDate`, plus removing device tokens that Firebase reports as dead. Projects, chapters and word counts are never touched.

## One-off setup (in this order)

1. **Check the Firestore location.** In the Firebase console, open Firestore Database; the location is shown at the top. Set `REGION` near the top of `functions/index.js` to match:
   - `europe-west2` → `'europe-west2'` (the current setting)
   - `eur3` → `'europe-west1'`
   - `nam5` → `'us-central1'`
   - anything else → that same region name

   Firestore triggers can only run in the database's own region, and the deploy fails if this is wrong.
2. **Install and test:**
   ```
   npm install -g firebase-tools
   firebase login
   cd firebase/functions && npm install && npm test
   ```
3. **See what's already deployed** (Cue Fighters' function should be listed and must stay):
   ```
   firebase functions:list --project draft-punk-a0735
   ```
4. **Deploy ONLY this codebase**, from the repo root:
   ```
   firebase deploy --only functions:draftpunk --project draft-punk-a0735
   ```
   - Never run a bare `firebase deploy`: it would also deploy the Firestore rules.
   - The first time, the CLI asks to enable some Google Cloud services (Cloud Functions, Cloud Build, Artifact Registry, Eventarc, Cloud Scheduler, Pub/Sub). Say yes.
   - If it offers to delete any function, answer **No**. The `draftpunk` codebase shouldn't ever ask.
5. **Create the Web Push key.** In the Firebase console, go to Project settings → Cloud Messaging → Web Push certificates → Generate key pair. Copy the public key into `VAPID_KEY` at the top of `push.js`, bump `CACHE` in `sw.js`, then commit and push. This is the switch that makes the "Notifications" section appear in the Account panel. Until it's set, nobody sees anything.
6. **If the browser API key is restricted** (Google Cloud console → APIs & Services → Credentials), add **Firebase Cloud Messaging API** and **Firebase Installations API** to its allowed APIs.

## Testing on an iPad

1. In Safari, Share → **Add to Home Screen**, then open Draft Punk from the Home Screen icon. iOS only allows web notifications for Home Screen apps.
2. Go to Account → **Turn on notifications** and allow the prompt.
3. Set the reminder time to the next quarter-hour and don't write anything. The reminder should arrive within 15 minutes of that time.
4. From another account, send yourself a message: a "New message" notification should arrive.

Logs: Firebase console → Functions → (function) → Logs, or `firebase functions:log --project draft-punk-a0735`.

## Turning it off

- **Hide it from users:** set `VAPID_KEY` back to `''` in `push.js`.
- **Stop sending:** `firebase functions:delete dailyWritingReminder notifyDirectMessage notifyGroupMessage notifyFriendRequest notifyChapterShare --project draft-punk-a0735`

## Cost

At the current number of writers this should be well inside the free allowances on the Blaze plan. Each 15-minute run reads every writer's settings once (a few reads each), and push sending has no charge.
