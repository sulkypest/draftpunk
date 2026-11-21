# Draft Punk — Firebase back end

Everything that runs on Firebase's side (rather than in the browser) lives here.

| Path | What it is |
|---|---|
| `functions/` | Cloud Functions, codebase **`draftpunk`**: daily writing reminder + alerts for messages, group chat, friend requests and shared chapters |
| `../firestore.rules` | Firestore security rules (still at the repo root; deployed separately, see the header of that file) |

The notifications need **no rules change**. They only use `users/{uid}/private/notifications`, which the existing owner-only `private` rule already covers.

## What the functions do

- **`dailyWritingReminder`** runs every 15 minutes. It sends a writer one reminder a day, at the time they chose in their own time zone (7pm by default, settable from 8am to 9:45pm), only if they haven't written that day. If a streak would end at midnight, the message says so.
- **Quiet hours:** nothing is ever sent between 10pm and 8am in the writer's own time zone. Social alerts that happen overnight aren't sent; the in-app badges still show them.
- **Turning it on:** after a writer saves words, a small one-tap "Daily nudge?" bar appears once. Tapping it switches everything on with the defaults, and the settings live in Account. "Not now" (or ignoring it) means it isn't offered again for 30 days. It never appears where it can't work: iPhone/iPad outside the Home Screen app, blocked notifications, or already on.
- **`notifyDirectMessage` / `notifyGroupMessage` / `notifyFriendRequest` / `notifyChapterShare`** run when one of those is created and notify the recipient(s). They never include message text or chapter titles, because notifications can appear on a lock screen.
- **Data written:** only `lastReminderDate`, plus removing device tokens that Firebase reports as dead. Projects, chapters and word counts are never touched.

## One-off setup (in this order)

1. **Check the Firestore location.** In the Firebase console, open Firestore Database; the location is shown at the top. Set `REGION` near the top of `functions/index.js` to match:
   - `nam5` → `'us-central1'` (the current setting: Draft Punk's database is nam5)
   - `europe-west2` → `'europe-west2'`
   - `eur3` → `'europe-west1'`
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

## Email sign-in codes: one-off setup

Writers can ask for a 6-digit code by email instead of using Google or a password. Two functions handle it:

- **`requestSignInCode`** emails the code through Resend.
- **`verifySignInCode`** checks the code and signs the writer in. If an account already uses that email address (Google, password or an earlier code), the writer is signed into **that** account. A new account is only made for an address no account has.

Two more things run alongside them:

- **Usage alerts.** If sign-in emails pass 70 in a UTC day, or Resend's free daily limit (100) is reached, a push notification goes to Ross's account only.
- **`weeklyNumbers`** sends Ross a summary every Monday at 9am UK time: new writers split by sign-in type, the total, and sign-in emails for the week.

Do these in order, before deploying:

1. **Resend account.** Sign up at resend.com (the free plan needs no card).
   - Go to Domains → Add domain → `mail.draft-punk.com`. A subdomain keeps sign-in emails separate from any other mail on draft-punk.com.
   - Add the DNS records Resend shows at the draft-punk.com registrar, then wait for Resend to say **Verified**.
   - The sender address is set in `SIGNIN_FROM` in `functions/index.js` as `signin@mail.draft-punk.com`. If you verify a different domain, change it there too.
2. **API key.** In Resend, go to API Keys → Create, with "Sending access" and the domain above. Store it as a Firebase secret, pasting the key when asked:
   ```
   firebase functions:secrets:set RESEND_API_KEY --project draft-punk-a0735
   ```
3. **Where alerts go.** In the Firebase console, open Authentication → Users and copy the **User UID** next to your own email. Then:
   ```
   firebase functions:secrets:set ADMIN_UID --project draft-punk-a0735
   ```
   This lives in Google's Secret Manager, not in the repo or the app. Alerts reach whichever devices have Draft Punk notifications turned on for that account.
4. **Permission to sign writers in.** The code function creates a sign-in token, which Google only allows if the functions' service account may sign tokens.
   - In the Google Cloud console for draft-punk-a0735, go to IAM & Admin → IAM.
   - Find **`<project number>-compute@developer.gserviceaccount.com`** (the "Default compute service account").
   - Click edit, add the role **Service Account Token Creator**, and save.
   - Also enable the **IAM Service Account Credentials API**: APIs & Services → Library.
5. **App Check.** These functions refuse calls without an App Check token, which keeps bots from using up the email allowance. In the Firebase console, App Check → Apps should show the web app registered with reCAPTCHA v3. It already should be, because `sync.js` uses it.
6. **Test and deploy** this codebase only, as above:
   ```
   cd firebase/functions && npm test
   cd ../.. && firebase deploy --only functions:draftpunk --project draft-punk-a0735
   ```

Check it worked by signing in with "Email me a code" on the live site. The code email should arrive within a minute.

- **No email:** check Functions → `requestSignInCode` → Logs, and the Resend dashboard's Logs.
- **"Codes can't be sent right now":** the daily limit was reached. Upgrading Resend lifts it, with no code change.

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
