// Firebase backend: real accounts, shared memos, follows and private close friends.
// Implements the same interface as backend-demo.js.
//
// Data model (enforced by firestore.rules / storage.rules):
//   users/{uid}                      public profile {name, nameLower, handle, color, createdAt, bio?, link?, photoURL?}
//   users/{uid}/private/closeFriends {uids: [...]}  readable by the owner only
//   handles/{handle}                 {uid}  keeps handles unique
//   followRequests/{requester_target} {requester, target, createdAt}  pending follow requests
//   follows/{follower_target}        {follower, target, createdAt}  created when the target approves
//   memos/{memoId}                   {authorId, audience, createdAt, duration, caption, peaks, audioPath, likeCount}
//   memos/{memoId}/likes/{uid}       {createdAt}
//   feeds/{uid}/items/{memoId}       {authorId, audience, createdAt}  delivery of followers-only and close friends memos
//   memos/{memoId}/comments/{id}     {authorId, text, createdAt}
//   users/{uid}/blocked/{otherUid}   {createdAt}  people you've blocked (owner only)
//   reports/{id}                     write-only; reviewed in the Firebase console
//   amplifies/{uid_memoId}           {uid, memoId, authorId, createdAt}  reposts of public memos
//   Storage: audio/{uid}/{memoId}, avatars/{uid}/avatar.jpg
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
// Search lists everyone while the community is small; above this, it's search-only.
const LIST_ALL_UNDER = 50;

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
    'storage/unauthorized': 'TwoCents couldn’t save that file. Sign out and back in, then try again.',
    'storage/unauthenticated': 'You’ve been signed out. Sign in again and try again.',
    'storage/retry-limit-exceeded': 'Upload timed out. Check your connection and try again.',
    'storage/canceled': 'Upload was canceled. Try again.',
    'storage/quota-exceeded': 'TwoCents is out of storage space right now. Please tell us at owner@snacktimemedia.net.',
  };
  if (e && e instanceof BackendError) return e.message;
  if (e && map[e.code]) return map[e.code];
  // Include the error code so a screenshot tells us what went wrong.
  return e && e.code ? `Something went wrong (${e.code}). Try again.` : 'Something went wrong. Try again.';
}

export function createFirebaseBackend(config, { emulators = false } = {}) {
  const app = initializeApp(config);
  // initializeAuth (not getAuth) so sign-in works inside the iOS/Android app shell.
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  const storage = getStorage(app);
  // Give up after a minute instead of the default 10, so a stuck post shows an error.
  storage.maxUploadRetryTime = 60 * 1000;
  storage.maxOperationRetryTime = 60 * 1000;
  if (emulators) {
    const host = location.hostname || '127.0.0.1';
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8080);
    connectStorageEmulator(storage, host, 9199);
  }

  let me = null;              // public profile of the signed-in user
  let signingUp = false;      // true while sign-up creates the account and profile
  let following = new Set();  // uids I follow
  let closeIds = new Set();   // my private close friends list
  let blocked = new Set();    // uids I've blocked
  let requested = new Set();  // uids I've asked to follow (pending)
  let userCountCache = null;
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

  // Who you follow and who you've asked to follow (someone may have approved,
  // declined, removed you as a follower or blocked you since last time).
  async function loadRelations() {
    const id = uid();
    const [fs, rq] = await Promise.all([
      getDocs(query(collection(db, 'follows'), where('follower', '==', id))),
      getDocs(query(collection(db, 'followRequests'), where('requester', '==', id))),
    ]);
    following = new Set(fs.docs.map(d => d.data().target));
    requested = new Set(rq.docs.map(d => d.data().target));
  }
  const relationTo = u => ({
    following: following.has(u.id), requested: requested.has(u.id),
    close: closeIds.has(u.id), blocked: blocked.has(u.id),
  });

  async function listPeople(filter, field) {
    await loadRelations().catch(() => {});
    const snap = await getDocs(query(collection(db, 'follows'), filter, limit(500)));
    const list = await Promise.all(snap.docs.map(d => getUser(d.data()[field])));
    return list
      .filter(u => u.handle !== 'deleted')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(u => ({ ...u, ...relationTo(u) }));
  }

  // Only the latest load counts, so a slow earlier one can't undo a newer one
  // (for example, right after sign-up creates your profile).
  let selfSeq = 0;
  async function loadSelf() {
    const id = uid();
    const seq = ++selfSeq;
    const snap = await getDoc(doc(db, 'users', id));
    if (seq !== selfSeq) return me;
    if (!snap.exists()) { me = null; return null; }
    me = { id, ...snap.data() };
    users.set(id, me);
    const [, cf, bl] = await Promise.all([
      loadRelations(),
      getDoc(doc(db, 'users', id, 'private', 'closeFriends')),
      getDocs(collection(db, 'users', id, 'blocked')),
    ]);
    blocked = new Set(bl.docs.map(d => d.id));
    closeIds = new Set(cf.exists() ? cf.data().uids || [] : []);
    return me;
  }

  async function toMemo(snap) {
    const d = snap.data();
    const [author, likeSnap, commentCount, ampSnap] = await Promise.all([
      getUser(d.authorId),
      getDoc(doc(db, 'memos', snap.id, 'likes', uid())).catch(() => null),
      getCountFromServer(collection(db, 'memos', snap.id, 'comments')).then(c => c.data().count).catch(() => 0),
      d.audience === 'global' ? getDoc(doc(db, 'amplifies', `${uid()}_${snap.id}`)).catch(() => null) : null,
    ]);
    const m = {
      id: snap.id,
      userId: d.authorId,
      author,
      audience: d.audience,
      createdAt: toMs(d.createdAt),
      duration: d.duration,
      caption: d.caption || '',
      tags: Array.isArray(d.tags) ? d.tags : [],
      peaks: d.peaks || [],
      likes: d.likeCount || 0,
      liked: !!(likeSnap && likeSnap.exists()),
      comments: commentCount,
      amplifies: d.amplifyCount || 0,
      amplified: !!(ampSnap && ampSnap.exists()),
      amplifiedBy: [],   // names of people you follow who amplified it
      amplifiedAt: 0,
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
        // Sign-up finishes creating the profile itself and then opens the app.
        if (signingUp) return;
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
      signingUp = true;
      try {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
        return await api.createProfile({ name, handle });
      } finally {
        signingUp = false;
      }
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
        // Public memos that people you follow amplified.
        ...chunks.map(c => sortedQuery(collection(db, 'amplifies'), where('uid', 'in', c), 50)),
      ]);
      const failed = results.filter(r => r.status === 'rejected');
      failed.forEach(r => console.error('Feed list failed to load', r.reason));
      if (failed.length === results.length) throw failed[0].reason;
      const [inbox, global, mine, ...rest] = results.map(r => (r.status === 'fulfilled' ? r.value : []));
      const followedGlobal = rest.slice(0, chunks.length).flat();
      const amps = rest.slice(chunks.length).flat().map(s => s.data()).filter(a => !blocked.has(a.uid));
      const snaps = new Map();
      [...global, ...mine, ...followedGlobal].forEach(s => snaps.set(s.id, s));
      const ampMissing = [...new Set(amps.map(a => a.memoId))].filter(mid => !snaps.has(mid));
      (await Promise.all(ampMissing.map(mid => getDoc(doc(db, 'memos', mid)).catch(() => null))))
        .forEach(s => { if (s && s.exists()) snaps.set(s.id, s); });
      // Delivered memos: fetch each one; deleted memos simply fail and are skipped.
      const delivered = await Promise.all(inbox
        .filter(s => !snaps.has(s.id))
        .map(s => getDoc(doc(db, 'memos', s.id)).catch(() => null)));
      delivered.forEach(s => { if (s && s.exists()) snaps.set(s.id, s); });
      // Memos from people you've blocked never show up.
      const memos = await Promise.all([...snaps.values()].filter(s => !blocked.has(s.data().authorId)).map(toMemo));
      const byId = new Map(memos.map(m => [m.id, m]));
      for (const a of amps) {
        const m = byId.get(a.memoId);
        if (!m) continue;
        m.amplifiedBy.push((await getUser(a.uid)).name);
        m.amplifiedAt = Math.max(m.amplifiedAt, toMs(a.createdAt));
      }
      return memos;
    },

    async audioUrl(m) {
      return getDownloadURL(ref(storage, m.audioPath));
    },

    async postMemo({ blob, duration, audience, caption, peaks, tags = [] }) {
      const id = uid();
      const memoRef = doc(collection(db, 'memos'));
      const audioPath = `audio/${id}/${memoRef.id}`;
      await uploadBytes(ref(storage, audioPath), blob, { contentType: (blob.type || 'audio/webm').split(';')[0] });
      await setDoc(memoRef, {
        authorId: id, audience, createdAt: serverTimestamp(),
        duration: Math.round(duration * 10) / 10, caption, peaks, audioPath, likeCount: 0,
        tags: tags.slice(0, 3).map(t => String(t).slice(0, 24)).filter(Boolean),
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

    // Repost a public memo to your followers' Home, or undo it.
    async toggleAmplify(m) {
      const memoRef = doc(db, 'memos', m.id);
      const ampRef = doc(db, 'amplifies', `${uid()}_${m.id}`);
      const amplified = !m.amplified;
      const batch = writeBatch(db);
      if (amplified) batch.set(ampRef, { uid: uid(), memoId: m.id, authorId: m.userId, createdAt: serverTimestamp() });
      else batch.delete(ampRef);
      batch.update(memoRef, { amplifyCount: increment(amplified ? 1 : -1) });
      await batch.commit();
      return { amplified, amplifies: Math.max(0, m.amplifies + (amplified ? 1 : -1)) };
    },

    async searchPeople(q) {
      q = q.trim().toLowerCase().replace(/^@/, '');
      const usersCol = collection(db, 'users');
      await loadRelations();
      let snaps;
      if (!q) {
        snaps = (await getDocs(query(usersCol, orderBy('createdAt', 'desc'), limit(LIST_ALL_UNDER)))).docs;
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
          return { ...u, ...relationTo(u) };
        });
    },

    // Ask to follow someone. They have to approve before you're a follower.
    async follow(target) {
      await setDoc(doc(db, 'followRequests', `${uid()}_${target}`), { requester: uid(), target, createdAt: serverTimestamp() });
      requested.add(target);
      return 'requested';
    },
    async cancelRequest(target) {
      await deleteDoc(doc(db, 'followRequests', `${uid()}_${target}`)).catch(e => {
        if (e.code !== 'permission-denied') throw e; // already approved or declined
      });
      requested.delete(target);
    },
    async getRequested() { return new Set(requested); },

    // Requests from people who want to follow you.
    async listFollowRequests() {
      const snap = await getDocs(query(collection(db, 'followRequests'), where('target', '==', uid()), limit(200)));
      const list = await Promise.all(snap.docs
        .filter(d => !blocked.has(d.data().requester))
        .map(async d => ({ user: await getUser(d.data().requester), createdAt: toMs(d.data().createdAt) })));
      return list.filter(r => r.user.handle !== 'deleted').sort((a, b) => b.createdAt - a.createdAt);
    },
    async approveRequest(requester) {
      const id = uid();
      const batch = writeBatch(db);
      batch.set(doc(db, 'follows', `${requester}_${id}`), { follower: requester, target: id, createdAt: serverTimestamp() });
      batch.delete(doc(db, 'followRequests', `${requester}_${id}`));
      await batch.commit();
      // Put your recent followers-only memos on their Home too.
      const recent = await sortedQuery(collection(db, 'memos'), [where('authorId', '==', id), where('audience', '==', 'followers')], 20)
        .catch(() => []);
      await Promise.allSettled(recent.map(s => setDoc(doc(db, 'feeds', requester, 'items', s.id),
        { authorId: id, audience: 'followers', createdAt: s.data().createdAt })));
    },
    async declineRequest(requester) {
      await deleteDoc(doc(db, 'followRequests', `${requester}_${uid()}`));
    },
    async removeFollower(follower) {
      await deleteDoc(doc(db, 'follows', `${follower}_${uid()}`));
    },

    // Followers / following lists for any profile (follows are visible to everyone signed in).
    async listFollowers(userId) { return listPeople(where('target', '==', userId), 'follower'); },
    async listFollowing(userId) { return listPeople(where('follower', '==', userId), 'target'); },

    // Someone's profile, showing only the memos you're allowed to hear.
    async getUserProfile(userId) {
      await loadRelations();
      const user = await getUser(userId);
      const memosCol = collection(db, 'memos');
      const [followsMe, followers, followingCount, ...lists] = await Promise.all([
        getDoc(doc(db, 'follows', `${userId}_${uid()}`)).then(d => d.exists()).catch(() => false),
        getCountFromServer(query(collection(db, 'follows'), where('target', '==', userId))).then(c => c.data().count).catch(() => 0),
        getCountFromServer(query(collection(db, 'follows'), where('follower', '==', userId))).then(c => c.data().count).catch(() => 0),
        // Each list is allowed or refused by the rules on its own: public for everyone,
        // followers-only for approved followers, close friends for people on their list.
        ...['global', 'followers', 'close'].map(aud =>
          sortedQuery(memosCol, [where('authorId', '==', userId), where('audience', '==', aud)], 50).catch(() => [])),
      ]);
      const memos = blocked.has(userId) ? [] : await Promise.all(lists.flat().map(toMemo));
      return { user: { ...user, ...relationTo(user), followsMe }, followers, following: followingCount, memos };
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
        deleteDoc(doc(db, 'followRequests', `${id}_${target}`)),
        deleteDoc(doc(db, 'followRequests', `${target}_${id}`)),
      ]);
      requested.delete(target);
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

    // How many people use the app (cached for a few minutes).
    async userCount() {
      if (userCountCache && Date.now() - userCountCache.at < 5 * 60 * 1000) return userCountCache.n;
      const n = (await getCountFromServer(collection(db, 'users'))).data().count;
      userCountCache = { n, at: Date.now() };
      return n;
    },
    listAllUnder: LIST_ALL_UNDER,

    // Name, bio (120 max), link and profile photo.
    async updateProfile({ name, bio = '', link = '', photoBlob = null, removePhoto = false }) {
      const id = uid();
      const upd = { name: name.trim(), nameLower: name.trim().toLowerCase(), bio: bio.trim().slice(0, 120), link };
      const photoRef = ref(storage, `avatars/${id}/avatar.jpg`);
      if (photoBlob) {
        await uploadBytes(photoRef, photoBlob, { contentType: 'image/jpeg' });
        // The version number makes phones show the new photo instead of a cached old one.
        upd.photoURL = `${await getDownloadURL(photoRef)}&v=${Date.now()}`;
      } else if (removePhoto) {
        await deleteObject(photoRef).catch(e => { if (e.code !== 'storage/object-not-found') throw e; });
        upd.photoURL = '';
      }
      await setDoc(doc(db, 'users', id), upd, { merge: true });
      Object.assign(me, upd);
      users.set(id, me);
      return me;
    },

    async getFollowing() { await loadRelations().catch(() => {}); return new Set(following); },

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
        .map(u => ({ ...u, ...relationTo(u) }));
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
        .map(u => ({ ...u, ...relationTo(u) }));
    },
    async getCloseFriends() { return new Set(closeIds); },

    // Memos you've listened to, kept privately on your account.
    async getListened() {
      const snap = await getDoc(doc(db, 'users', uid(), 'private', 'listened'));
      return snap.exists() ? snap.data().ids || [] : [];
    },
    async saveListened(ids) {
      await setDoc(doc(db, 'users', uid(), 'private', 'listened'), { ids: ids.slice(-1000) });
    },
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
      const [out, inc, inbox, reqOut, reqIn] = await Promise.all([
        getDocs(query(collection(db, 'follows'), where('follower', '==', id))),
        getDocs(query(collection(db, 'follows'), where('target', '==', id))),
        getDocs(collection(db, 'feeds', id, 'items')),
        getDocs(query(collection(db, 'followRequests'), where('requester', '==', id))),
        getDocs(query(collection(db, 'followRequests'), where('target', '==', id))),
      ]);
      await Promise.all([...out.docs, ...inc.docs, ...inbox.docs, ...reqOut.docs, ...reqIn.docs].map(s => deleteDoc(s.ref)));
      await deleteDoc(doc(db, 'users', id, 'private', 'closeFriends'));
      await deleteDoc(doc(db, 'users', id, 'private', 'listened'));
      const myAmps = await getDocs(query(collection(db, 'amplifies'), where('uid', '==', id)));
      for (const a of myAmps.docs) {
        const memoRef = doc(db, 'memos', a.data().memoId);
        const batch = writeBatch(db);
        batch.delete(a.ref);
        if ((await getDoc(memoRef).catch(() => null))?.exists()) batch.update(memoRef, { amplifyCount: increment(-1) });
        await batch.commit().catch(e => console.warn('Could not remove an amplify', e));
      }
      const myComments = await getDocs(query(collectionGroup(db, 'comments'), where('authorId', '==', id)));
      await Promise.all(myComments.docs.map(s => deleteDoc(s.ref)));
      const bl = await getDocs(collection(db, 'users', id, 'blocked'));
      await Promise.all(bl.docs.map(s => deleteDoc(s.ref)));
      await deleteObject(ref(storage, `avatars/${id}/avatar.jpg`)).catch(() => {});
      if (me && me.handle) await deleteDoc(doc(db, 'handles', me.handle));
      await deleteDoc(doc(db, 'users', id));
      await deleteUser(user);
    },
  };
  return api;
}
