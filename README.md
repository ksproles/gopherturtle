# RiffRaff

Scrollable voice memos. Open the app and scroll through memos from your close friends, people you follow, and the world, newest first.

The app is built with web code (`www/`) and packaged as native iOS and Android apps with [Capacitor](https://capacitorjs.com), so the same code ships to the App Store and Google Play.

## Features

**Home**
- Home shows everything from people you follow (followers-only and global memos), close friends memos sent to you, and your own memos, newest first.
- Two color-coded filters: **Close friends** (green) and **Following** (blue, everyone you follow). Tap one to narrow the list; tap it again to see both.
- Each memo card carries its audience color: a stripe down the side, a badge, a play button, and a waveform that fills in as it plays.
- When a memo finishes, the next one in the list plays automatically.
- **Playback speed:** press and hold any play button to pick 1×, 1.25×, 1.5× or 2×. The speed applies to every memo and is remembered. Cards show the speed when it isn't 1×.

**Discover**: public (global) memos from everyone, ranked for you. The ranking favors people followed by people you follow, people whose memos you've liked or listened to, popular memos (likes and comments) and recent ones. Memos you've already heard and memos from people you already follow (they're on Home) rank lower. Each card says why it was picked ("Followed by Maya", "Popular on RiffRaff"), and a "People you might like" row suggests accounts to follow. Listening history is kept on the device.

**Bottom bar**: Home · Discover · Post · Search · Profile

**Post**
1. Tap **Post** and a recorder sheet slides up.
2. Tap the red button to record (up to 5 minutes) and tap again to stop.
3. Play it back or redo it.
4. Choose who can hear it: **Close friends**, **Followers only**, or **Global**. Add an optional caption.
5. Tap **Post**.

**Close friends are private.** Your close friends list is only visible to you. You edit it from your profile, nobody is told when they're added or removed, and the list and its size never appear on your profile. Memos you post to close friends also stay off your profile.

**Like, Riff, Amplify**: every memo has **Like** (heart), **Riff** (text replies, up to 280 characters; delete your own, or any riff on your own memo) and, on public memos, **Amplify** (repost to your followers' Home with an "Amplified by …" line). Only public (Global) memos can be amplified, and not your own. Tap Amplify again to undo. Delete your own memos from the ••• menu.

**Report and block**: tap ••• on a memo or riff to report it (spam, harassment, hate speech, sexual content, violence, self-harm, or something else) or block the person. Blocked people can't follow you, riff on your memos or send you memos, and you won't see their memos or riffs. They aren't told. Manage your list under Profile → Blocked people. A basic word filter also masks strong profanity and slurs in captions and riffs (`www/text-filter.js`).

**Follow requests and profiles**: tap anyone's name or avatar to open their profile. Without following, you only hear their public memos. **Follow** sends a request (the button shows **Requested**); they approve or decline it under **Profile → Follow requests** (a red dot on the Profile tab means someone's waiting). Approved followers hear followers-only memos, including older ones; close friends memos need you on their close friends list. Access follows the current relationship, so it ends when someone removes you as a follower or takes you off their list. Unfollowing or canceling a request works from the same button.

**Followers and following lists**: tap **Followers** or **Following** on any profile to see the list; tap someone to open their profile, and Back returns to the list. On your own Followers list, **Remove** takes someone off (they aren't told). You can also remove a follower from the ••• menu on their profile.

**Pull to refresh**: drag down from the top of Home, Discover, Search, your profile, someone's profile or a list, and let go to reload it.

**Search**: find people, follow or unfollow them, and search memo captions.

**Profile**: your memos (followers-only and global), stats, your private close friends list, and (with accounts on) sign out and delete account.

**Accounts (optional)**: with Firebase turned on, people sign up with email, a name and a unique @handle, and memos are shared for real. Without it, the app runs in demo mode with example people. See [Turning on accounts](#turning-on-accounts-firebase).

## Project layout

| Path | What it is |
| --- | --- |
| `www/` | The app itself: `index.html`, `styles.css`, `app.js`, bundled fonts and icon |
| `www/backend-demo.js` | Demo mode: example people and memos stored on the device |
| `www/backend-firebase.js` | Accounts mode: sign-in, shared memos, follows, close friends |
| `www/firebase-config.js` | Your Firebase project settings (empty = demo mode) |
| `www/vendor/firebase.js` | Bundled Firebase SDK (rebuild with `npm run build:firebase`) |
| `firestore.rules`, `storage.rules` | Server-side rules for who can read and write what |
| `test/rules.test.mjs` | Tests for those rules (`npm run test:rules`) |
| `ios/` | Xcode project generated by Capacitor |
| `android/` | Android Studio project generated by Capacitor |
| `capacitor.config.json` | App name and bundle ID (`com.gopherturtle.app`) |
| `resources/icon.png` | 1024×1024 app icon source |

## Running it

In a browser (fastest for design work):

```sh
npm run serve      # then open http://localhost:8000
```

On a phone or simulator:

```sh
npm install
npx cap sync       # copies www/ into the native projects; run after every change to www/
npx cap open ios   # opens Xcode (Mac only), then press Run
npx cap open android
```

Microphone permission is already declared on both platforms (`NSMicrophoneUsageDescription` on iOS, `RECORD_AUDIO` on Android).

## Turning on accounts (Firebase)

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. **Authentication → Sign-in method**: enable **Email/Password**.
3. **Firestore Database**: create a database in production mode.
4. **Storage**: create the default bucket. New projects need the pay-as-you-go **Blaze** plan for Storage. It has a free monthly allowance, and you can set a budget alert.
5. **Project settings → Your apps**: add a **Web** app and copy its config into `www/firebase-config.js` (replace `null`).
6. Deploy the security rules and indexes:
   ```sh
   npx firebase login
   npx firebase use --add          # pick your project
   npx firebase deploy --only firestore,storage
   ```
   When asked whether Storage rules may read Firestore, answer **yes**. The audio rules need it.
7. `npx cap sync`, then run the app. You'll see the sign-in screen.

### How privacy is enforced

The rules in `firestore.rules` and `storage.rules` run on Google's servers, so they hold even if someone modifies the app:

- **Close friends lists** are stored under your account and only you can read or change them. Memos to close friends are delivered to each person individually, so nobody can see who else got one.
- **Follows need approval**: a follow only exists once the person being followed approves the request.
- **Followers-only memos** can be heard only by approved followers, and **close friends memos** only by people currently on the author's list, checked every time (not just when posted).
- **Audio files** can only be downloaded by people allowed to hear that memo.
- Likes can only go up or down by one per person, and only the author can edit or delete a memo.
- Only people who can hear a memo can read or write its comments. Blocked people can't comment on your memos, follow you, or deliver memos to you.
- Reports can be filed by anyone signed in, but can't be read from the app.

### Reviewing reports

Apple expects you to act on reports within 24 hours. Reports appear in **Firebase console → Firestore Database → Data → reports**. Each one has the reporter, what was reported (`type`: memo, comment or user, plus `targetId` and `memoId`), the reported person (`targetAuthorId`), the `reason`, and a copy of the caption or comment `text`. To remove reported content, delete the memo (`memos/{memoId}`) or comment (`memos/{memoId}/comments/{targetId}`), then change the report's `status` to `closed`. To ban someone, disable their account under **Authentication → Users**.

### Automatic updates

Every push to GitHub runs `.github/workflows/deploy.yml`: it runs the security rules tests and, if they pass, publishes the web app (https://gopher-turtle.web.app), the Firestore rules and indexes, and the Storage rules. If the tests fail, nothing is published.

One-time setup:
1. Firebase console → **Project settings → Service accounts** → **Generate new private key**. A `.json` file downloads. Keep it private.
2. Click **Manage service account permissions** (same page). In the list, find the account named `firebase-adminsdk-…`, click the pencil, **Add another role** → **Firebase Admin**, and **Save**.
3. GitHub → the repository → **Settings → Secrets and variables → Actions → New repository secret**. Name: `FIREBASE_SERVICE_ACCOUNT`. Value: open the `.json` file in a text editor and paste all of it. **Add secret**.
4. Delete the downloaded `.json` file from your computer.

Check progress under the repository's **Actions** tab. A green check means the update is live.

### Updating the rules after a change

With automatic updates set up, rules changes are published on every push. Without it, changes to `firestore.rules` or `storage.rules` don't reach Firebase on their own: paste the file's contents into the **Rules** tab in the Firebase console and click **Publish**, or run `npx firebase deploy --only firestore,storage` from your computer.

### Testing locally without a Firebase project

```sh
npm run emulators                 # local Auth, Firestore and Storage
# open http://127.0.0.1:5000/?emulators
npm run test:rules                # 71 checks of who can read and write what
```

### Known limits (fine to launch with, worth improving later)

- When you post, the app delivers the memo to each follower from your phone. For accounts with thousands of followers, move this to a Cloud Function.
- Followers-only memos posted before someone followed you aren't delivered to them later.
- People search matches the start of a name or handle.
- Deleting a memo leaves a few small leftover records (likes, delivery entries) that the app ignores. A scheduled cleanup function can remove them.

## Getting it into the App Store

What you need:
- A Mac with Xcode installed.
- An [Apple Developer Program](https://developer.apple.com/programs/) membership ($99/year). Google Play is a one-time $25.
- App icons in every size. Generate them from `resources/icon.png` with `npx @capacitor/assets generate`.

Steps:
1. Change the bundle ID in `capacitor.config.json` if you want a different one, then run `npx cap sync`.
2. In Xcode, select your team under *Signing & Capabilities*.
3. *Product → Archive*, then upload to App Store Connect.
4. Test it with TestFlight, then fill in the store listing (screenshots, description, privacy details) and submit for review.

### Still needed before submitting

Before it can go live:

- ~~A backend~~: done (Firebase, see above). Turn it on before submitting.
- ~~Account deletion from inside the app~~ (Guideline 5.1.1): done, under Profile → Delete account.
- ~~Report, block and filtering~~ (Guideline 1.2): done. Apple also wants a published way to contact you (an email on your App Store listing or website is enough) and reports handled within 24 hours.
- **A privacy policy** URL, and the App Privacy answers in App Store Connect (you collect audio, email and profile info).

## Notes

- In demo mode, example people and memos are placeholder data, their audio is generated babble, and everything you do is saved on the device only.
- Your playback speed is saved on the device in both modes.
- If the microphone isn't available (for example in a desktop preview), the recorder makes a demo recording so the posting flow can still be tried.
