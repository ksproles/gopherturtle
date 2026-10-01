// Entry point for the bundled Firebase SDK (www/vendor/firebase.js).
// Rebuild with `npm run build:firebase` after changing what's exported here.
export { initializeApp } from 'firebase/app';
export {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, connectAuthEmulator,
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail, deleteUser, reauthenticateWithCredential, EmailAuthProvider,
} from 'firebase/auth';
export {
  initializeFirestore, connectFirestoreEmulator,
  collection, collectionGroup, doc, getDoc, getDocs, setDoc, deleteDoc, query, where, orderBy, limit,
  startAt, endAt, writeBatch, runTransaction, serverTimestamp, increment, getCountFromServer,
} from 'firebase/firestore';
export {
  getStorage, connectStorageEmulator, ref, uploadBytes, getDownloadURL, deleteObject,
} from 'firebase/storage';
