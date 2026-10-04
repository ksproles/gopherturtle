# Launching TwoCents

A checklist for getting TwoCents into the App Store and Google Play, and for shipping updates afterward.

## 1. Decide the permanent basics

- [ ] **Final name.** Search the App Store and Google Play to make sure "TwoCents" isn't already taken, and do a quick trademark search (USPTO TESS for the US).
- [x] **App ID:** `snacktimemedia.twocents` (set in the iOS and Android projects). This is permanent once uploaded.
- [x] **Support email:** `owner@snacktimemedia.net` (used on the pages below). Ask Claude to change it anytime, and update it in App Store Connect and Play Console too.
- [ ] **Firebase public name.** Firebase console → Project settings → General → *Public-facing name* → `TwoCents`. This is the name in password-reset emails. Also review the templates under Authentication → Templates.
- [x] **Website / marketing URL:** https://www.snacktimemedia.net/two-cents. Use it as the *Marketing URL* (Apple) and *Website* (Google Play). Link the privacy and support pages from it too, so people can find them from your site.
- [ ] **Web address for the app itself (optional).** Firebase Hosting → *Add another site* (for example `twocents.web.app`), or connect your own domain.

## 2. Pages you need

These are built and published with the app. They're linked from Profile, the sign-in screen and sign-up:

- [x] **Privacy policy:** https://gopher-turtle.web.app/privacy.html (`www/privacy.html`)
- [x] **Terms & community rules** (zero tolerance, 13+): https://gopher-turtle.web.app/terms.html (`www/terms.html`)
- [x] **Support page** with FAQs: https://gopher-turtle.web.app/support.html (`www/support.html`)

These are solid starting templates written to match how TwoCents actually works, but they aren't legal advice. Have someone qualified review them before launch, especially if you form a company (add its legal name) or want a governing-law clause.

## 3. Developer accounts

- [x] **Apple Developer Program**, $99/year: developer.apple.com/programs. Enroll as an individual, or as a company if you form an LLC. Companies need a D-U-N-S number, which takes a few days.
- [ ] **Google Play Console**, a one-time $25: play.google.com/console. New personal accounts must run a **closed test with at least 12 testers for 14 days in a row** before they can publish publicly, so start recruiting friends early.

## 4. Building the apps

- **iPhone:** needs a Mac with Xcode, or a cloud build service such as Codemagic or Ionic Appflow if you don't have a Mac.
- **Android:** Android Studio on any computer.

Steps:
- [ ] `npx @capacitor/assets generate` creates every icon and splash size from `resources/`.
- [ ] Build and install on real phones. Test recording, playback, sign up and sign in, and the microphone permission prompt.
- [ ] **TestFlight** (iPhone) and **Internal testing** (Android) let friends install test versions.

## iPhone: step by step on your Mac

**One-time setup (about 30 minutes, mostly downloads)**
1. Install **Xcode** from the Mac App Store (it's large). Open it once and accept the extra components.
2. Install **Node.js LTS** from nodejs.org.
3. Open **Terminal** and run each line:
   ```sh
   xcode-select --install          # skip if it says already installed
   git clone https://github.com/ksproles/gopherturtle.git
   cd gopherturtle
   git checkout claude/charming-turing-mxz05f
   npm install
   npx cap sync ios
   npx cap open ios
   ```
   Xcode opens the TwoCents project.
4. In Xcode, go to **Settings → Accounts → +**, choose **Apple ID**, and sign in with your developer account.
5. Click **App** in the left sidebar, then the **App** target, then **Signing & Capabilities**. Check **Automatically manage signing** and pick your **Team**. The Bundle Identifier should already say `snacktimemedia.twocents`.

**Try it on your iPhone**
6. Plug in your iPhone and unlock it. Tap **Trust** on the phone. If asked, turn on **Settings → Privacy & Security → Developer Mode** and restart the phone.
7. In Xcode's top bar, choose your iPhone as the destination and press **▶ Run**. TwoCents installs and opens. Test sign-in, recording, playback and following.

**Create the app in App Store Connect**
8. Go to appstoreconnect.apple.com, then **Apps → + → New App**:
   - Platform: iOS
   - Name: TwoCents
   - Language: English (U.S.)
   - Bundle ID: `snacktimemedia.twocents` (it appears after step 5; if not, add it at developer.apple.com → Identifiers)
   - SKU: `twocents-ios`
   - Access: Full Access

**Upload a build**
9. In Xcode, set the destination to **Any iOS Device (arm64)**, then **Product → Archive**.
10. When the Organizer window opens, choose **Distribute App → App Store Connect → Upload** and accept the defaults.
11. After 10–30 minutes the build appears in App Store Connect under **TestFlight**. Add yourself and friends as testers and install it with the **TestFlight** app.

**Submit for review**
12. Fill in the listing from [STORE_LISTING.md](STORE_LISTING.md): text, screenshots, URLs, App Privacy, age rating and the review demo account.
13. On the app's **1.0** page, pick the build under **Build**, then click **Add for Review → Submit**. Review usually takes 1–2 days. If Apple asks for changes, send their message to Claude.

**Each later update:** Claude bumps the version. On the Mac, run `git pull`, `npm install` and `npx cap sync ios`, then archive and upload (steps 9–10), and submit the new version.

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
