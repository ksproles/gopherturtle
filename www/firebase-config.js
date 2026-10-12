// Firebase project settings for TwoCents.
//
// Set `firebaseConfig` to null to run the app in demo mode instead (example
// people and memos, everything stays on the device).
//
// These values are not secret; access is controlled by firestore.rules and
// storage.rules. See README.md → "Turning on accounts (Firebase)".
export const firebaseConfig = {
  apiKey: 'AIzaSyBPDjmRNQ4LpguLt1t6tD_JzoO2A4103Qk',
  authDomain: 'gopher-turtle.firebaseapp.com',
  projectId: 'gopher-turtle',
  storageBucket: 'gopher-turtle.firebasestorage.app',
  messagingSenderId: '1044077139860',
  appId: '1:1044077139860:web:c1839b6849b2f178d3a181',
};

// App Check: proves requests come from the real TwoCents app or website, which
// blocks scripts that spam or run up the bill. It does nothing until it's set
// up in the Firebase console; see LAUNCH.md → "App Check".
export const appCheckConfig = {
  webSiteKey: '',  // reCAPTCHA v3 site key for the website
  ios: false,      // true once GoogleService-Info.plist and App Attest are added in Xcode
};
