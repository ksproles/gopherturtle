// Firebase backend: real accounts, shared memos, follows and private close friends.
// Implements the same interface as backend-demo.js.
//
// Data model (enforced by firestore.rules / storage.rules):
//   users/{uid}                      public profile {name, nameLower, handle, color, createdAt}
//   users/{uid}/private/closeFriends {uids: [...]}  readable by the owner only
//   handles/{handle}                 {uid}  keeps handles unique
//   follows/{follower_target}        {follower, target, createdAt}
//   memos/{memoId}                   {authorId, audience, createdAt, duration, caption, peaks, audioPath, likeCount}
//   memos/{memoId}/likes/{uid}       {createdAt}
//   feeds/{uid}/items/{memoId}       {authorId, audience, createdAt}  delivery of followers-only and close friends memos
//   memos/{memoId}/comments/{id}     {authorId, text, createdAt}
//   users/{uid}/blocked/{otherUid}   {createdAt}  people you've blocked (owner only)
//   reports/{id}                     write-only; reviewed in the Firebase console
//   Storage: audio/{uid}/{memoId}
import {
  initializeApp,
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, connectAuthEmulator,
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail, deleteUser, reauthenticateWithCredential, EmailAuthProvider,
  initializeFirestore, connectFirestoreEmulator,
  collection, collectionGroup, doc, getDoc, getDocs, setDoc, deleteDoc, query, where, orderBy, limit,
  addDoc, writeBatch, runTransaction, serverTimestamp, increment, getCountFromServer,
  getStorage, connectStorageEmulator, ref, uploadBytes, getDownloadURL, deleteObject,
} from './vendor/firebase.js';
import { colorFor } from './audio-utils.js';

const FEED_LIMIT = 100;
const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

export class BackendError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Friendly messages for the Firebase errors people actually hit.
export function friendlyError(e) {
  const map = {
    'auth/invalid-email': 'That email address doesn’t look right.',
    'auth/missing-password': 'Enter your password.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/email-already-in-use': 'There’s already an account with that email. Try signing in.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/wrong-password': 'Password is incorrect.',
    'auth/user-not-found': 'No account uses that email.',
    'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
    'auth/network-request-failed': 'Can’t reach the server. Check your connection.',
    'auth/requires-recent-login': 'For your security, enter your password again.',
    'permission-denied': 'You don’t have access to that.',
    'failed-precondition': 'The database is still getting ready. Try again in a few minutes.',
    'unavailable': 'Can’t reach the server. Check your connection.',
  };
  return (e && (e instanceof BackendError ? e.message : map[e.code])) || 'Something went wrong. Try again.';
}

export function createFirebaseBackend(config, { emulators = false } = {}) {
  const app = initializeApp(config);
  // initializeAuth (not getAuth) so sign-in works inside the iOS/Android app shell.
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  const storage = getStorage(app);
  if (emulators) {
    const host = location.hostname || '127.0.0.1';
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8080);
    connectStorageEmulator(storage, host, 9199);
  }

  let me = null;              // public profile of the signed-in user
  let following = new Set();  // uids I follow
  let closeIds = new Set();   // my private close friends list
  let blocked = new Set();    // uids I've blocked
  const users = new Map();    // uid -> profile cache
  const memoCache = new Map();

  const uid = () => auth.currentUser && auth.currentUser.uid;
  const toMs = t => (t && t.toMillis ? t.toMillis() : Date.now());

  async function getUser(id) {
    if (users.has(id)) return users.get(id);
    const snap = await getDoc(doc(db, 'users', id));
    const u = snap.exists()
      ? { id, ...snap.data() }
      : { id, name: 'Deleted account', handle: 'deleted', color: '#7a857c' };
    users.set(id, u);
    return u;
  }

  async function loadSelf() {
    const id = uid();
    const snap = await getDoc(doc(db, 'users', id));
    if (!snap.exists()) { me = null; return null; }
    me = { id, ...snap.data() };
    users.set(id, me);
    const [fs, cf, bl] = await Promise.all([
      getDocs(query(collection(db, 'follows'), where('follower', '==', id))),
      getDoc(doc(db, 'users', id, 'private', 'closeFriends')),
      getDocs(collection(db, 'users', id, 'blocked')),
    ]);
    following = new Set(fs.docs.map(d => d.data().target));
    blocked = new Set(bl.docs.map(d => d.id));
    closeIds = new Set(cf.exists() ? cf.data().uids || [] : []);
    return me;
  }

  async function toMemo(snap) {
    const d = snap.data();
    const [author, likeSnap, commentCount] = await Promise.all([
      getUser(d.authorId),
      getDoc(doc(db, 'memos', snap.id, 'likes', uid())).catch(() => null),
      getCountFromServer(collection(db, 'memos', snap.id, 'comments')).then(c => c.data().count).catch(() => 0),
    ]);
    const m = {
      id: snap.id,
      userId: d.authorId,
      author,
      audience: d.audience,
      createdAt: toMs(d.createdAt),
      duration: d.duration,
      caption: d.caption || '',
      peaks: d.peaks || [],
      likes: d.likeCount || 0,
      liked: !!(likeSnap && likeSnap.exists()),
      comments: commentCount,
      audioPath: d.audioPath,
    };
    memoCache.set(m.id, m);
    return m;
  }

  // Newest-first query. Sorting needs a composite index (firestore.indexes.json);
  // if it's missing or still building, fall back to an unsorted query and sort here.
  async function sortedQuery(col, filters, max) {
    filters = [].concat(filters);
    try {
      return (await getDocs(query(col, ...filters, orderBy('createdAt', 'desc'), limit(max)))).docs;
    } catch (e) {
      if (e.code !== 'failed-precondition') throw e;
      console.warn('Index not ready yet, using an unsorted query:', e.message);
      const docs = (await getDocs(query(col, ...filters, limit(max * 4)))).docs;
      return docs.sort((a, b) => toMs(b.data().createdAt) - toMs(a.data().createdAt)).slice(0, max);
    }
  }

  async function fanOut(memoId, audience) {
    let recipients = [];
    if (audience === 'followers') {
      const fs = await getDocs(query(collection(db, 'follows'), where('target', '==', uid())));
      recipients = fs.docs.map(d => d.data().follower);
    } else if (audience === 'close') {
      recipients = [...closeIds];
    }
    // One write per recipient: each is checked by the rules on its own.
    const item = { authorId: uid(), audience, createdAt: serverTimestamp() };
    const results = await Promise.allSettled(
      recipients.map(r => setDoc(doc(db, 'feeds', r, 'items', memoId), item)));
    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed) console.warn(`Memo ${memoId}: ${failed} of ${recipients.length} deliveries failed`);
  }

  const api = {
    mode: 'firebase',
    get me() { return me; },
    get email() { return auth.currentUser ? auth.currentUser.email : ''; },
    get signedIn() { return !!auth.currentUser; },

    // Calls onUser(profile) when signed in with a profile, onUser(null) when signed out,
    // and onUser({needsProfile: true}) when signed in but no handle has been chosen yet.
    init(onUser) {
      onAuthStateChanged(auth, async user => {
        if (!user) { me = null; users.clear(); memoCache.clear(); onUser(null); return; }
        try {
          const profile = await loadSelf();
          onUser(profile || { needsProfile: true, email: user.email });
        } catch (e) {
          console.error(e);
          onUser({ error: friendlyError(e) });
        }
      });
    },

    async handleAvailable(handle) {
      const snap = await getDoc(doc(db, 'handles', handle));
      return !snap.exists();
    },

    async signUp({ email, password, name, handle }) {
      handle = handle.trim().toLowerCase();
      if (!HANDLE_RE.test(handle)) throw new BackendError('bad-handle', 'Handles use 3–20 lowercase letters, numbers or _.');
      if (!(await api.handleAvailable(handle))) throw new BackendError('handle-taken', `@${handle} is taken. Try another.`);
      await createUserWithEmailAndPassword(auth, email.trim(), password);
      return api.createProfile({ name, handle });
    },

    async createProfile({ name, handle }) {
      handle = handle.trim().toLowerCase();
      name = name.trim();
      if (!name) throw new BackendError('bad-name', 'Enter your name.');
      if (!HANDLE_RE.test(handle)) throw new BackendError('bad-handle', 'Handles use 3–20 lowercase letters, numbers or _.');
      const id = uid();
      await runTransaction(db, async tx => {
        const h = await tx.get(doc(db, 'handles', handle));
        if (h.exists()) throw new BackendError('handle-taken', `@${handle} is taken. Try another.`);
        tx.set(doc(db, 'handles', handle), { uid: id });
        tx.set(doc(db, 'users', id), {
          name, nameLower: name.toLowerCase(), handle, color: colorFor(id), createdAt: serverTimestamp(),
        });
      });
      return loadSelf();
    },

    signIn: (email, password) => signInWithEmailAndPassword(auth, email.trim(), password),
    signOut: () => signOut(auth),
    resetPassword: email => sendPasswordResetEmail(auth, email.trim()),

    async loadFeed() {
      const id = uid();
      const memosCol = collection(db, 'memos');
      // Each list loads on its own, so one failing (for example an index that's
      // still building) never hides the others.
      // Global memos from people you follow belong on Home, so fetch them directly
      // (Firestore 'in' filters take up to 30 people at a time).
      const followed = [...following];
      const chunks = [];
      for (let i = 0; i < followed.length && i < 300; i += 30) chunks.push(followed.slice(i, i + 30));
      const results = await Promise.allSettled([
        getDocs(query(collection(db, 'feeds', id, 'items'), orderBy('createdAt', 'desc'), limit(FEED_LIMIT))).then(r => r.docs),
        sortedQuery(memosCol, where('audience', '==', 'global'), 100),
        sortedQuery(memosCol, where('authorId', '==', id), 100),
        ...chunks.map(c => sortedQuery(memosCol, [where('authorId', 'in', c), where('audience', '==', 'global')], 50)),
      ]);
      const failed = results.filter(r => r.status === 'rejected');
      failed.forEach(r => console.error('Feed list failed to load', r.reason));
      if (failed.length === results.length) throw failed[0].reason;
      const [inbox, global, mine, ...followedGlobal] = results.map(r => (r.status === 'fulfilled' ? r.value : []));
      const snaps = new Map();
      [...global, ...mine, ...followedGlobal.flat()].forEach(s => snaps.set(s.id, s));
      // Delivered memos: fetch each one; deleted memos simply fail and are skipped.
      const delivered = await Promise.all(inbox
        .filter(s => !snaps.has(s.id))
        .map(s => getDoc(doc(db, 'memos', s.id)).catch(() => null)));
      delivered.forEach(s => { if (s && s.exists()) snaps.set(s.id, s); });
      // Memos from people you've blocked never show up.
      return Promise.all([...snaps.values()].filter(s => !blocked.has(s.data().authorId)).map(toMemo));
    },

    async audioUrl(m) {
      return getDownloadURL(ref(storage, m.audioPath));
    },

    async postMemo({ blob, duration, audience, caption, peaks }) {
      const id = uid();
      const memoRef = doc(collection(db, 'memos'));
      const audioPath = `audio/${id}/${memoRef.id}`;
      await uploadBytes(ref(storage, audioPath), blob, { contentType: (blob.type || 'audio/webm').split(';')[0] });
      await setDoc(memoRef, {
        authorId: id, audience, createdAt: serverTimestamp(),
        duration: Math.round(duration * 10) / 10, caption, peaks, audioPath, likeCount: 0,
      });
      await fanOut(memoRef.id, audience);
      return toMemo(await getDoc(memoRef));
    },

    async deleteMemo(m) {
      await deleteObject(ref(storage, m.audioPath)).catch(e => {
        if (e.code !== 'storage/object-not-found') throw e;
      });
      await deleteDoc(doc(db, 'memos', m.id));
      memoCache.delete(m.id);
    },

    async toggleLike(m) {
      const memoRef = doc(db, 'memos', m.id);
      const likeRef = doc(db, 'memos', m.id, 'likes', uid());
      const liked = !m.liked;
      const batch = writeBatch(db);
      if (liked) batch.set(likeRef, { createdAt: serverTimestamp() });
      else batch.delete(likeRef);
      batch.update(memoRef, { likeCount: increment(liked ? 1 : -1) });
      await batch.commit();
      return { liked, likes: Math.max(0, m.likes + (liked ? 1 : -1)) };
    },

    async searchPeople(q) {
      q = q.trim().toLowerCase().replace(/^@/, '');
      const usersCol = collection(db, 'users');
      // Refresh who you follow: someone may have removed you as a follower or blocked you.
      const fs = await getDocs(query(collection(db, 'follows'), where('follower', '==', uid())));
      following = new Set(fs.docs.map(d => d.data().target));
      let snaps;
      if (!q) {
        snaps = (await getDocs(query(usersCol, orderBy('createdAt', 'desc'), limit(25)))).docs;
      } else {
        const end = q + '';
        const [byHandle, byName] = await Promise.all([
          getDocs(query(usersCol, where('handle', '>=', q), where('handle', '<=', end), limit(20))),
          getDocs(query(usersCol, where('nameLower', '>=', q), where('nameLower', '<=', end), limit(20))),
        ]);
        const seen = new Map();
        [...byHandle.docs, ...byName.docs].forEach(s => seen.set(s.id, s));
        snaps = [...seen.values()];
      }
      return snaps
        .filter(s => s.id !== uid())
        .map(s => {
          const u = { id: s.id, ...s.data() };
          users.set(u.id, u);
          return { ...u, following: following.has(u.id), close: closeIds.has(u.id), blocked: blocked.has(u.id) };
        });
    },

    async follow(target) {
      await setDoc(doc(db, 'follows', `${uid()}_${target}`), { follower: uid(), target, createdAt: serverTimestamp() });
      following.add(target);
    },
    async unfollow(target) {
      await deleteDoc(doc(db, 'follows', `${uid()}_${target}`)).catch(e => {
        // Already gone (for example they removed you as a follower): nothing to undo.
        if (e.code !== 'permission-denied') throw e;
      });
      following.delete(target);
    },

    // ---------- Comments ----------
    async listComments(m) {
      const snaps = await getDocs(query(collection(db, 'memos', m.id, 'comments'), orderBy('createdAt', 'asc'), limit(200)));
      const list = await Promise.all(snaps.docs
        .filter(s => !blocked.has(s.data().authorId))
        .map(async s => {
          const d = s.data();
          return { id: s.id, memoId: m.id, userId: d.authorId, author: await getUser(d.authorId), text: d.text, createdAt: toMs(d.createdAt) };
        }));
      return list;
    },
    async addComment(m, text) {
      const ref_ = await addDoc(collection(db, 'memos', m.id, 'comments'), {
        authorId: uid(), text, createdAt: serverTimestamp(),
      });
      return { id: ref_.id, memoId: m.id, userId: uid(), author: me, text, createdAt: Date.now() };
    },
    async deleteComment(m, c) {
      await deleteDoc(doc(db, 'memos', m.id, 'comments', c.id));
    },

    // ---------- Reports and blocking ----------
    async report({ type, targetId, targetAuthorId, memoId = '', reason, text = '' }) {
      await addDoc(collection(db, 'reports'), {
        reporterId: uid(), type, targetId, targetAuthorId, memoId, reason,
        text: String(text).slice(0, 500), status: 'open', createdAt: serverTimestamp(),
      });
    },
    async block(target) {
      const id = uid();
      await setDoc(doc(db, 'users', id, 'blocked', target), { createdAt: serverTimestamp() });
      blocked.add(target);
      // Blocking also ends follows in both directions and removes them from close friends.
      await Promise.allSettled([
        deleteDoc(doc(db, 'follows', `${id}_${target}`)),
        deleteDoc(doc(db, 'follows', `${target}_${id}`)),
      ]);
      following.delete(target);
      if (closeIds.has(target)) await api.setCloseFriends([...closeIds].filter(x => x !== target));
    },
    async unblock(target) {
      await deleteDoc(doc(db, 'users', uid(), 'blocked', target));
      blocked.delete(target);
    },
    async getBlocked() {
      const list = await Promise.all([...blocked].map(getUser));
      return list.sort((a, b) => a.name.localeCompare(b.name));
    },

    async getFollowing() { return new Set(following); },

    // Signals for ranking Discover: who the people you follow follow.
    async discoverSignals() {
      const ids = [...following].slice(0, 30);
      const fof = new Map(); // uid -> uids of people you follow who follow them
      if (ids.length) {
        const snap = await getDocs(query(collection(db, 'follows'), where('follower', 'in', ids), limit(500)));
        snap.docs.forEach(d => {
          const { follower, target } = d.data();
          if (target === uid() || following.has(target) || blocked.has(target)) return;
          if (!fof.has(target)) fof.set(target, []);
          fof.get(target).push(follower);
        });
      }
      const names = new Map();
      await Promise.all([...new Set([...fof.values()].flat())].map(async u => names.set(u, (await getUser(u)).name)));
      const top = [...fof.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10);
      const suggestions = (await Promise.all(top.map(([u]) => getUser(u))))
        .filter(u => u.handle !== 'deleted')
        .map(u => ({ ...u, following: false, close: closeIds.has(u.id), blocked: false }));
      return {
        following: new Set(following),
        fof: new Map([...fof].map(([u, fs]) => [u, fs.map(f => names.get(f) || 'someone')])),
        suggestions,
      };
    },

    async closeFriendCandidates() {
      const fs = await getDocs(query(collection(db, 'follows'), where('target', '==', uid())));
      const ids = new Set([...following, ...closeIds, ...fs.docs.map(d => d.data().follower)].filter(x => !blocked.has(x)));
      const list = await Promise.all([...ids].map(getUser));
      return list
        .filter(u => u.handle !== 'deleted')
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(u => ({ ...u, following: following.has(u.id), close: closeIds.has(u.id) }));
    },
    async getCloseFriends() { return new Set(closeIds); },
    async setCloseFriends(ids) {
      const next = [...new Set(ids)];
      await setDoc(doc(db, 'users', uid(), 'private', 'closeFriends'), { uids: next });
      closeIds = new Set(next);
    },

    async stats() {
      const c = await getCountFromServer(query(collection(db, 'follows'), where('target', '==', uid())));
      return { followers: c.data().count, following: following.size };
    },

    // Deletes the profile, memos, audio, follows and lists, then the sign-in account.
    async deleteAccount(password) {
      const user = auth.currentUser;
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      const id = user.uid;
      const mine = await getDocs(query(collection(db, 'memos'), where('authorId', '==', id)));
      for (const s of mine.docs) await api.deleteMemo({ id: s.id, audioPath: s.data().audioPath });
      const [out, inc, inbox] = await Promise.all([
        getDocs(query(collection(db, 'follows'), where('follower', '==', id))),
        getDocs(query(collection(db, 'follows'), where('target', '==', id))),
        getDocs(collection(db, 'feeds', id, 'items')),
      ]);
      await Promise.all([...out.docs, ...inc.docs, ...inbox.docs].map(s => deleteDoc(s.ref)));
      await deleteDoc(doc(db, 'users', id, 'private', 'closeFriends'));
      const myComments = await getDocs(query(collectionGroup(db, 'comments'), where('authorId', '==', id)));
      await Promise.all(myComments.docs.map(s => deleteDoc(s.ref)));
      const bl = await getDocs(collection(db, 'users', id, 'blocked'));
      await Promise.all(bl.docs.map(s => deleteDoc(s.ref)));
      if (me && me.handle) await deleteDoc(doc(db, 'handles', me.handle));
      await deleteDoc(doc(db, 'users', id));
      await deleteUser(user);
    },
  };
  return api;
}
