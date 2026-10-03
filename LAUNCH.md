# Launching TwoCents

A checklist for getting TwoCents into the App Store and Google Play, and for shipping updates afterward.

## 1. Decide the permanent basics

- [ ] **Final name.** Search the App Store and Google Play to make sure "TwoCents" isn't already taken, and do a quick trademark search (USPTO TESS for the US).
- [ ] **App ID.** Currently `com.gopherturtle.app` in `capacitor.config.json`. It can't change after the first store submission, so set it now (for example `com.twocentsapp.app`). Tell Claude and it will update the iOS and Android projects.
- [ ] **Support email.** A dedicated address (for example `twocents.help@gmail.com`) for users, Apple and Google.
- [ ] **Firebase public name.** Firebase console → Project settings → General → *Public-facing name* → `TwoCents`. This is the name in password-reset emails. Also review the templates under Authentication → Templates.
- [ ] **Web address (optional).** Firebase Hosting → *Add another site* (for example `twocents.web.app`), or connect your own domain.

## 2. Pages you need

Claude can build these and host them with the app:

- [ ] **Privacy policy.** Required by both stores. It covers what you collect (email, name and handle, voice recordings, captions, comments, likes and follows), why, who can see it, and how to delete it (Profile → Delete account).
- [ ] **Terms of use / community guidelines.** Zero tolerance for abuse (Apple requires this for apps where people post content), a minimum age of 13, and how reports are handled.
- [ ] **Support page.** Your contact email and a few FAQs.

## 3. Developer accounts

- [ ] **Apple Developer Program**, $99/year: developer.apple.com/programs. Enroll as an individual, or as a company if you form an LLC. Companies need a D-U-N-S number, which takes a few days.
- [ ] **Google Play Console**, a one-time $25: play.google.com/console. New personal accounts must run a **closed test with at least 12 testers for 14 days in a row** before they can publish publicly, so start recruiting friends early.

## 4. Building the apps

- **iPhone:** needs a Mac with Xcode, or a cloud build service such as Codemagic or Ionic Appflow if you don't have a Mac.
- **Android:** Android Studio on any computer.

Steps:
- [ ] `npx @capacitor/assets generate` creates every icon and splash size from `resources/`.
- [ ] Build and install on real phones. Test recording, playback, sign up and sign in, and the microphone permission prompt.
- [ ] **TestFlight** (iPhone) and **Internal testing** (Android) let friends install test versions.

## 5. Store listings

For both stores:
- [ ] App name, subtitle or short description, full description, keywords (Apple).
- [ ] Screenshots: iPhone 6.7" (and 6.5" if asked) and Android phone. Claude can produce clean ones from the app.
- [ ] Category: Social Networking.
- [ ] Privacy URL, support URL, support email.
- [ ] **A test account for reviewers** (email and password), with a few memos and a follower, so they can try everything. Put it in *App Review Information* (Apple) and *App access* (Google).
- [ ] **Age rating questionnaire.** Answer yes to user-generated content. Expect 12+ or 17+ on Apple and Teen on Google.
- [ ] **Apple App Privacy** answers and the **Google Data safety** form. Data collected: email, name, user ID, audio, other user content. Used for app functionality. Not used for tracking. Users can delete their data.

## 6. Running it responsibly

- [ ] **Check reports daily.** Apple expects action within 24 hours. They're in Firestore → `reports`. (Claude can add an email alert for each new report with a Firebase extension.)
- [ ] **Billing safety.** Set a budget alert in Google Cloud Billing (for example $10, $50 and $100).
- [ ] **Firebase App Check (recommended).** Makes sure only your real app can use your Firebase project, which blocks scripted abuse.

## 7. Before you have lots of users (nice to have)

- Push notifications for follow requests, comments and reposts. This brings people back, and needs a small amount of native setup.
- Move "deliver memo to followers" to a Cloud Function, so posting stays fast for accounts with thousands of followers.
- Email verification on sign-up to cut down on spam accounts.

---

# Shipping updates after launch

There are three kinds of changes, and each reaches people differently.

| What changed | How it reaches people | Your steps |
| --- | --- | --- |
| Security rules and database indexes | Live within ~2 minutes of Claude pushing (GitHub Actions) | None |
| The web version (gopher-turtle.web.app) | Live within ~2 minutes of Claude pushing | None |
| The iPhone and Android apps | A new version through the stores (or a live update, below) | Build → test → submit |

**Store update steps:**
1. Claude makes the change, pushes it, and bumps the version number.
2. Run `git pull` and `npx cap sync`, then build in Xcode and Android Studio. A Codemagic or GitHub Actions pipeline can automate this so you just press a button.
3. Upload to TestFlight and Play internal testing, and try it on your phone.
4. Submit for review. Apple usually takes about a day; Google takes from a few hours to a few days.
5. Release. You can do a phased rollout to a small share of users first.

**Live updates (optional, recommended once you're updating often):** a service like **Capgo** or **Ionic Appflow Live Updates** pushes changes to the app's screens and logic straight to installed apps without a store review. Apple allows this for bug fixes and improvements that don't change what the app is for. Native changes (new permissions, new plugins) still need a store release.

**Keep old versions working.** People don't all update right away, so rules and data changes have to keep working with the previous app version for a while. Claude keeps this in mind when changing rules.
