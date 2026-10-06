// Security rules tests. Run with: npm run test:rules
// Starts the Firestore + Storage emulators and checks who can read and write what.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, collection, query, where, orderBy,
  writeBatch, serverTimestamp, increment,
} from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
import { addDoc, collectionGroup } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-gopherturtle',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
});

const as = uid => env.authenticatedContext(uid);
const db = uid => as(uid).firestore();
const st = uid => as(uid).storage();
const anon = env.unauthenticatedContext().firestore();

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; }
}

async function createProfile(uid, handle, name) {
  const d = db(uid);
  const b = writeBatch(d);
  b.set(doc(d, 'handles', handle), { uid });
  b.set(doc(d, 'users', uid), { name, nameLower: name.toLowerCase(), handle, color: '#2f6b4f', createdAt: serverTimestamp() });
  return b.commit();
}
function memoData(uid, id, audience, extra = {}) {
  return {
    authorId: uid, audience, createdAt: serverTimestamp(), duration: 12.3, caption: 'hello',
    peaks: [0.1, 0.5], audioPath: `audio/${uid}/${id}`, likeCount: 0, ...extra,
  };
}
const audio = new Uint8Array([1, 2, 3, 4]);

await env.clearFirestore();
await env.clearStorage();
console.log('Profiles and handles');

await test('people can create a profile with a free handle', async () => {
  await assertSucceeds(createProfile('alice', 'alice', 'Alice'));
  await assertSucceeds(createProfile('bob', 'bob', 'Bob'));
  await assertSucceeds(createProfile('carol', 'carol', 'Carol'));
});
await test('a taken handle cannot be claimed', async () => {
  await assertFails(createProfile('mallory', 'alice', 'Mallory'));
});
await test('you cannot create someone else’s profile', async () => {
  const d = db('mallory');
  await assertFails(setDoc(doc(d, 'users', 'dave'), { name: 'Dave', nameLower: 'dave', handle: 'dave', color: '#000', createdAt: serverTimestamp() }));
});
await test('signed-out visitors cannot read profiles', async () => {
  await assertFails(getDoc(doc(anon, 'users', 'alice')));
});
await test('you cannot change your handle by editing your profile', async () => {
  await assertFails(updateDoc(doc(db('alice'), 'users', 'alice'), { handle: 'bob' }));
});

console.log('Profile bio, link and photo');
const prof = (uid, extra) => setDoc(doc(db(uid), 'users', uid), extra, { merge: true });
await test('you can set a bio, link and photo from this app’s storage', async () => {
  await assertSucceeds(prof('alice', { bio: 'Voice memo enthusiast 🎙️', link: 'https://example.com/me',
    photoURL: 'https://firebasestorage.googleapis.com/v0/b/x/o/avatars%2Falice%2Favatar.jpg?alt=media&token=t&v=1' }));
});
await test('bios over 120 characters are refused', async () => {
  await assertFails(prof('alice', { bio: 'x'.repeat(121) }));
});
await test('links must be web addresses', async () => {
  await assertFails(prof('alice', { link: 'javascript:alert(1)' }));
  await assertFails(prof('alice', { link: 'not a link' }));
  await assertSucceeds(prof('alice', { link: '' }));
});
await test('photos must be stored in this app, not linked from elsewhere', async () => {
  await assertFails(prof('alice', { photoURL: 'https://evil.example.com/tracker.png' }));
});
await test('you cannot edit someone else’s profile', async () => {
  await assertFails(setDoc(doc(db('carol'), 'users', 'alice'), { bio: 'hacked' }, { merge: true }));
});
await test('profile photos: only you can upload yours, and only images', async () => {
  await assertSucceeds(uploadBytes(ref(st('alice'), 'avatars/alice/avatar.jpg'), audio, { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(st('carol'), 'avatars/alice/avatar.jpg'), audio, { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(st('alice'), 'avatars/alice/avatar.jpg'), audio, { contentType: 'audio/mp4' }));
  await assertSucceeds(getBytes(ref(st('carol'), 'avatars/alice/avatar.jpg')));
});

console.log('Follow requests');
const request = (from, to) => setDoc(doc(db(from), 'followRequests', `${from}_${to}`), { requester: from, target: to, createdAt: serverTimestamp() });
function approve(target, follower) {
  const d = db(target);
  const b = writeBatch(d);
  b.set(doc(d, 'follows', `${follower}_${target}`), { follower, target, createdAt: serverTimestamp() });
  b.delete(doc(d, 'followRequests', `${follower}_${target}`));
  return b.commit();
}
await test('you cannot follow someone without their approval', async () => {
  await assertFails(setDoc(doc(db('alice'), 'follows', 'alice_bob'), { follower: 'alice', target: 'bob', createdAt: serverTimestamp() }));
});
await test('alice can ask to follow bob', async () => {
  await assertSucceeds(request('alice', 'bob'));
});
await test('you cannot send a request for someone else, or to yourself', async () => {
  await assertFails(setDoc(doc(db('alice'), 'followRequests', 'carol_bob'), { requester: 'carol', target: 'bob', createdAt: serverTimestamp() }));
  await assertFails(request('alice', 'alice'));
});
await test('only the two people involved can see a request', async () => {
  await assertSucceeds(getDoc(doc(db('bob'), 'followRequests', 'alice_bob')));
  await assertSucceeds(getDoc(doc(db('alice'), 'followRequests', 'alice_bob')));
  await assertFails(getDoc(doc(db('carol'), 'followRequests', 'alice_bob')));
  await assertSucceeds(getDocs(query(collection(db('bob'), 'followRequests'), where('target', '==', 'bob'))));
  await assertFails(getDocs(query(collection(db('carol'), 'followRequests'), where('target', '==', 'bob'))));
});
await test('the requester cannot approve their own request', async () => {
  const d = db('alice');
  const b = writeBatch(d);
  b.set(doc(d, 'follows', 'alice_bob'), { follower: 'alice', target: 'bob', createdAt: serverTimestamp() });
  b.delete(doc(d, 'followRequests', 'alice_bob'));
  await assertFails(b.commit());
});
await test('bob cannot add a follower who never asked', async () => {
  await assertFails(approve('bob', 'dave'));
});
await test('bob approves alice', async () => {
  await assertSucceeds(approve('bob', 'alice'));
});
await test('you cannot request someone you already follow', async () => {
  await assertFails(request('alice', 'bob'));
});
await test('requests can be cancelled or declined', async () => {
  await assertSucceeds(request('carol', 'alice'));
  await assertSucceeds(deleteDoc(doc(db('carol'), 'followRequests', 'carol_alice')));
  await assertSucceeds(request('carol', 'alice'));
  await assertSucceeds(deleteDoc(doc(db('alice'), 'followRequests', 'carol_alice')));
});
await test('you cannot make someone else follow a person', async () => {
  await assertFails(setDoc(doc(db('alice'), 'follows', 'carol_bob'), { follower: 'carol', target: 'bob', createdAt: serverTimestamp() }));
});
await test('you cannot follow yourself', async () => {
  await assertFails(setDoc(doc(db('alice'), 'follows', 'alice_alice'), { follower: 'alice', target: 'alice', createdAt: serverTimestamp() }));
});

console.log('Close friends list is private');
await test('bob can save his close friends list', async () => {
  await assertSucceeds(setDoc(doc(db('bob'), 'users', 'bob', 'private', 'closeFriends'), { uids: ['carol'] }));
});
await test('nobody else can read bob’s close friends list', async () => {
  await assertFails(getDoc(doc(db('carol'), 'users', 'bob', 'private', 'closeFriends')));
  await assertFails(getDoc(doc(db('alice'), 'users', 'bob', 'private', 'closeFriends')));
});
await test('nobody else can change bob’s close friends list', async () => {
  await assertFails(setDoc(doc(db('alice'), 'users', 'bob', 'private', 'closeFriends'), { uids: ['alice'] }));
});

console.log('Posting memos');
await test('bob can post memos for each audience', async () => {
  const d = db('bob');
  await assertSucceeds(setDoc(doc(d, 'memos', 'm-followers'), memoData('bob', 'm-followers', 'followers')));
  await assertSucceeds(setDoc(doc(d, 'memos', 'm-close'), memoData('bob', 'm-close', 'close')));
  await assertSucceeds(setDoc(doc(d, 'memos', 'm-global'), memoData('bob', 'm-global', 'global')));
});
await test('you cannot post a memo as someone else', async () => {
  await assertFails(setDoc(doc(db('alice'), 'memos', 'fake'), memoData('bob', 'fake', 'global')));
});
await test('memos cannot start with fake likes or a long caption', async () => {
  await assertFails(setDoc(doc(db('bob'), 'memos', 'x1'), memoData('bob', 'x1', 'global', { likeCount: 99 })));
  await assertFails(setDoc(doc(db('bob'), 'memos', 'x2'), memoData('bob', 'x2', 'global', { caption: 'x'.repeat(121) })));
  await assertFails(setDoc(doc(db('bob'), 'memos', 'x3'), memoData('bob', 'x3', 'global', { duration: 400 })));
});

console.log('Delivering memos');
const item = audience => ({ authorId: 'bob', audience, createdAt: serverTimestamp() });
await test('followers-only memos can be delivered to followers', async () => {
  await assertSucceeds(setDoc(doc(db('bob'), 'feeds', 'alice', 'items', 'm-followers'), item('followers')));
});
await test('followers-only memos cannot be delivered to non-followers', async () => {
  await assertFails(setDoc(doc(db('bob'), 'feeds', 'carol', 'items', 'm-followers'), item('followers')));
});
await test('close friends memos can be delivered to people on the list', async () => {
  await assertSucceeds(setDoc(doc(db('bob'), 'feeds', 'carol', 'items', 'm-close'), item('close')));
});
await test('close friends memos cannot be delivered to people not on the list', async () => {
  await assertFails(setDoc(doc(db('bob'), 'feeds', 'alice', 'items', 'm-close'), item('close')));
});
await test('you cannot deliver someone else’s memo', async () => {
  await assertFails(setDoc(doc(db('alice'), 'feeds', 'carol', 'items', 'm-global'), { authorId: 'alice', audience: 'close', createdAt: serverTimestamp() }));
});
await test('you can only read your own inbox', async () => {
  await assertSucceeds(getDocs(collection(db('alice'), 'feeds', 'alice', 'items')));
  await assertFails(getDocs(collection(db('carol'), 'feeds', 'alice', 'items')));
});

console.log('Who can hear what');
await test('global memos: anyone signed in', async () => {
  await assertSucceeds(getDoc(doc(db('carol'), 'memos', 'm-global')));
});
await test('followers-only memos: approved followers', async () => {
  await assertSucceeds(getDoc(doc(db('alice'), 'memos', 'm-followers')));
  await assertFails(getDoc(doc(db('carol'), 'memos', 'm-followers')));
});
await test('close friends memos: only people on the list', async () => {
  await assertSucceeds(getDoc(doc(db('carol'), 'memos', 'm-close')));
  await assertFails(getDoc(doc(db('alice'), 'memos', 'm-close')));
});
await test('on a profile, approved followers can load followers-only memos, others cannot', async () => {
  const q = d => query(collection(d, 'memos'), where('authorId', '==', 'bob'), where('audience', '==', 'followers'), orderBy('createdAt', 'desc'));
  await assertSucceeds(getDocs(q(db('alice'))));
  await assertFails(getDocs(q(db('carol'))));
});
await test('on a profile, close friends can load close friends memos, others cannot', async () => {
  const q = d => query(collection(d, 'memos'), where('authorId', '==', 'bob'), where('audience', '==', 'close'), orderBy('createdAt', 'desc'));
  await assertSucceeds(getDocs(q(db('carol'))));
  await assertFails(getDocs(q(db('alice'))));
});
await test('anyone can load someone’s public memos on their profile', async () => {
  await assertSucceeds(getDocs(query(collection(db('dave'), 'memos'), where('authorId', '==', 'bob'), where('audience', '==', 'global'), orderBy('createdAt', 'desc'))));
});
await test('the feed queries the app makes are allowed', async () => {
  const d = db('carol');
  await assertSucceeds(getDocs(query(collection(d, 'memos'), where('audience', '==', 'global'), orderBy('createdAt', 'desc'))));
  await assertSucceeds(getDocs(query(collection(d, 'memos'), where('authorId', '==', 'carol'), orderBy('createdAt', 'desc'))));
});
await test('loading global memos from people you follow is allowed', async () => {
  const d = db('alice');
  await assertSucceeds(getDocs(query(collection(d, 'memos'), where('authorId', 'in', ['bob', 'carol']), where('audience', '==', 'global'), orderBy('createdAt', 'desc'))));
});
await test('but not their followers-only memos by query', async () => {
  const d = db('carol');
  await assertFails(getDocs(query(collection(d, 'memos'), where('authorId', 'in', ['bob']))));
});
await test('listing all memos is not allowed', async () => {
  await assertFails(getDocs(collection(db('carol'), 'memos')));
});

console.log('Likes');
function like(uid, memoId, delta) {
  const d = db(uid);
  const b = writeBatch(d);
  const likeRef = doc(d, 'memos', memoId, 'likes', uid);
  if (delta > 0) b.set(likeRef, { createdAt: serverTimestamp() }); else b.delete(likeRef);
  b.update(doc(d, 'memos', memoId), { likeCount: increment(delta) });
  return b.commit();
}
await test('alice can like and unlike a memo she can hear', async () => {
  await assertSucceeds(like('alice', 'm-followers', 1));
  await assertSucceeds(like('alice', 'm-followers', -1));
});
await test('nobody can like the same memo twice', async () => {
  await assertSucceeds(like('carol', 'm-global', 1));
  await assertFails(like('carol', 'm-global', 1));
});
await test('like counts cannot be inflated', async () => {
  await assertFails(updateDoc(doc(db('alice'), 'memos', 'm-global'), { likeCount: 1000 }));
});
await test('you cannot like a memo you cannot hear', async () => {
  await assertFails(like('alice', 'm-close', 1));
});
await test('only the author can edit or delete a memo', async () => {
  await assertFails(updateDoc(doc(db('alice'), 'memos', 'm-global'), { caption: 'hacked' }));
  await assertFails(deleteDoc(doc(db('alice'), 'memos', 'm-global')));
});

console.log('Amplify');
function amplify(uid, memoId, authorId, delta) {
  const d = db(uid);
  const b = writeBatch(d);
  const ampRef = doc(d, 'amplifies', `${uid}_${memoId}`);
  if (delta > 0) b.set(ampRef, { uid, memoId, authorId, createdAt: serverTimestamp() });
  else b.delete(ampRef);
  b.update(doc(d, 'memos', memoId), { amplifyCount: increment(delta) });
  return b.commit();
}
await test('anyone can amplify a public memo, and undo it', async () => {
  await assertSucceeds(amplify('carol', 'm-global', 'bob', 1));
  await assertSucceeds(amplify('carol', 'm-global', 'bob', -1));
  await assertSucceeds(amplify('carol', 'm-global', 'bob', 1));
});
await test('nobody can amplify the same memo twice', async () => {
  await assertFails(amplify('carol', 'm-global', 'bob', 1));
});
await test('followers-only and close friends memos cannot be amplified', async () => {
  await assertFails(amplify('alice', 'm-followers', 'bob', 1));
  await assertFails(amplify('carol', 'm-close', 'bob', 1));
});
await test('you cannot amplify your own memo', async () => {
  await assertFails(amplify('bob', 'm-global', 'bob', 1));
});
await test('amplify counts cannot be faked', async () => {
  await assertFails(updateDoc(doc(db('alice'), 'memos', 'm-global'), { amplifyCount: 500 }));
  await assertFails(setDoc(doc(db('alice'), 'amplifies', 'alice_m-global'), { uid: 'alice', memoId: 'm-global', authorId: 'bob', createdAt: serverTimestamp() }));
});
await test('you cannot amplify for someone else', async () => {
  const d = db('alice');
  const b = writeBatch(d);
  b.set(doc(d, 'amplifies', 'carol_m-global'), { uid: 'carol', memoId: 'm-global', authorId: 'bob', createdAt: serverTimestamp() });
  b.update(doc(d, 'memos', 'm-global'), { amplifyCount: increment(1) });
  await assertFails(b.commit());
});
await test('followers can load what people they follow amplified', async () => {
  await assertSucceeds(getDocs(query(collection(db('alice'), 'amplifies'), where('uid', 'in', ['carol']), orderBy('createdAt', 'desc'))));
});

console.log('Audio files');
await test('bob can upload audio for his memos', async () => {
  for (const id of ['m-followers', 'm-close', 'm-global']) {
    await assertSucceeds(uploadBytes(ref(st('bob'), `audio/bob/${id}`), audio, { contentType: 'audio/mp4' }));
  }
});
await test('you cannot upload into someone else’s folder or upload non-audio', async () => {
  await assertFails(uploadBytes(ref(st('alice'), 'audio/bob/evil'), audio, { contentType: 'audio/mp4' }));
  await assertFails(uploadBytes(ref(st('bob'), 'audio/bob/notes'), audio, { contentType: 'text/plain' }));
});
await test('listening follows the same rules as the memo', async () => {
  await assertSucceeds(getBytes(ref(st('carol'), 'audio/bob/m-global')));
  await assertSucceeds(getBytes(ref(st('alice'), 'audio/bob/m-followers')));
  await assertFails(getBytes(ref(st('carol'), 'audio/bob/m-followers')));
  await assertSucceeds(getBytes(ref(st('carol'), 'audio/bob/m-close')));
  await assertFails(getBytes(ref(st('alice'), 'audio/bob/m-close')));
});

console.log('Comments');
const comment = (uid, text = 'nice one') => ({ authorId: uid, text, createdAt: serverTimestamp() });
await test('anyone who can hear a memo can comment on it', async () => {
  await assertSucceeds(setDoc(doc(db('carol'), 'memos', 'm-global', 'comments', 'c1'), comment('carol')));
  await assertSucceeds(setDoc(doc(db('alice'), 'memos', 'm-followers', 'comments', 'c2'), comment('alice')));
});
await test('you cannot comment on a memo you cannot hear', async () => {
  await assertFails(setDoc(doc(db('carol'), 'memos', 'm-followers', 'comments', 'c3'), comment('carol')));
});
await test('you cannot read comments on a memo you cannot hear', async () => {
  await assertFails(getDocs(collection(db('carol'), 'memos', 'm-followers', 'comments')));
  await assertSucceeds(getDocs(collection(db('alice'), 'memos', 'm-followers', 'comments')));
});
await test('comments must be yours, 1–280 characters', async () => {
  await assertFails(setDoc(doc(db('carol'), 'memos', 'm-global', 'comments', 'c4'), comment('alice')));
  await assertFails(setDoc(doc(db('carol'), 'memos', 'm-global', 'comments', 'c5'), comment('carol', '')));
  await assertFails(setDoc(doc(db('carol'), 'memos', 'm-global', 'comments', 'c6'), comment('carol', 'x'.repeat(281))));
});
await test('comments cannot be edited', async () => {
  await assertFails(updateDoc(doc(db('carol'), 'memos', 'm-global', 'comments', 'c1'), { text: 'edited' }));
});
await test('strangers cannot delete your comment, but the memo’s author can', async () => {
  await assertFails(deleteDoc(doc(db('alice'), 'memos', 'm-global', 'comments', 'c1')));
  await assertSucceeds(deleteDoc(doc(db('bob'), 'memos', 'm-global', 'comments', 'c1')));
  await assertSucceeds(deleteDoc(doc(db('alice'), 'memos', 'm-followers', 'comments', 'c2')));
});
await test('you can find only your own comments across memos', async () => {
  await assertSucceeds(setDoc(doc(db('carol'), 'memos', 'm-global', 'comments', 'c7'), comment('carol')));
  await assertSucceeds(getDocs(query(collectionGroup(db('carol'), 'comments'), where('authorId', '==', 'carol'))));
  await assertFails(getDocs(query(collectionGroup(db('alice'), 'comments'), where('authorId', '==', 'carol'))));
});

console.log('Reports');
const report = (uid, extra = {}) => ({
  reporterId: uid, type: 'memo', targetId: 'm-global', targetAuthorId: 'bob', memoId: 'm-global',
  reason: 'spam', text: 'hello', status: 'open', createdAt: serverTimestamp(), ...extra,
});
await test('anyone signed in can file a report', async () => {
  await assertSucceeds(addDoc(collection(db('carol'), 'reports'), report('carol')));
});
await test('reports cannot be filed for someone else or with a made-up reason', async () => {
  await assertFails(addDoc(collection(db('carol'), 'reports'), report('alice')));
  await assertFails(addDoc(collection(db('carol'), 'reports'), report('carol', { reason: 'boring' })));
  await assertFails(addDoc(collection(db('carol'), 'reports'), report('carol', { status: 'closed' })));
});
await test('nobody can read reports from the app', async () => {
  await assertFails(getDocs(collection(db('carol'), 'reports')));
  await assertFails(getDocs(collection(db('bob'), 'reports')));
});

console.log('Blocking');
await test('you can block someone and only you can see your block list', async () => {
  await assertSucceeds(setDoc(doc(db('bob'), 'users', 'bob', 'blocked', 'carol'), { createdAt: serverTimestamp() }));
  await assertFails(getDocs(collection(db('carol'), 'users', 'bob', 'blocked')));
  await assertFails(setDoc(doc(db('carol'), 'users', 'bob', 'blocked', 'alice'), { createdAt: serverTimestamp() }));
});
await test('blocked people cannot comment on your memos', async () => {
  await assertFails(setDoc(doc(db('carol'), 'memos', 'm-global', 'comments', 'c8'), comment('carol')));
});
await test('blocked people cannot ask to follow you', async () => {
  await assertFails(request('carol', 'bob'));
});
await test('blocked people cannot send you memos', async () => {
  await assertSucceeds(setDoc(doc(db('carol'), 'memos', 'cm'), memoData('carol', 'cm', 'followers')));
  // Even if Bob still followed Carol, the delivery is refused.
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'follows', 'bob_carol'), { follower: 'bob', target: 'carol' }));
  await assertFails(setDoc(doc(db('carol'), 'feeds', 'bob', 'items', 'cm'), { authorId: 'carol', audience: 'followers', createdAt: serverTimestamp() }));
});
await test('after unblocking, they can comment again', async () => {
  await assertSucceeds(deleteDoc(doc(db('bob'), 'users', 'bob', 'blocked', 'carol')));
  await assertSucceeds(setDoc(doc(db('carol'), 'memos', 'm-global', 'comments', 'c9'), comment('carol')));
});

console.log('Leaving');
await test('bob can remove alice as a follower', async () => {
  await assertSucceeds(deleteDoc(doc(db('bob'), 'follows', 'alice_bob')));
});
await test('once removed, alice can no longer hear bob’s followers-only memos or audio', async () => {
  await assertFails(getDoc(doc(db('alice'), 'memos', 'm-followers')));
  await assertFails(getBytes(ref(st('alice'), 'audio/bob/m-followers')));
});
await test('the author can delete a memo', async () => {
  await assertSucceeds(deleteDoc(doc(db('bob'), 'memos', 'm-followers')));
});

console.log('Memo tags');
await test('a memo can have up to 3 tags', async () => {
  await assertSucceeds(setDoc(doc(db('bob'), 'memos', 't1'), memoData('bob', 't1', 'global', { tags: ['Funny story', 'Life update', 'Music'] })));
});
await test('memos without tags still work (older app versions)', async () => {
  await assertSucceeds(setDoc(doc(db('bob'), 'memos', 't2'), memoData('bob', 't2', 'global')));
});
await test('no more than 3 tags, none empty or longer than 24 characters', async () => {
  await assertFails(setDoc(doc(db('bob'), 'memos', 't3'), memoData('bob', 't3', 'global', { tags: ['a', 'b', 'c', 'd'] })));
  await assertFails(setDoc(doc(db('bob'), 'memos', 't4'), memoData('bob', 't4', 'global', { tags: [''] })));
  await assertFails(setDoc(doc(db('bob'), 'memos', 't5'), memoData('bob', 't5', 'global', { tags: ['x'.repeat(25)] })));
  await assertFails(setDoc(doc(db('bob'), 'memos', 't6'), memoData('bob', 't6', 'global', { tags: 'Funny story' })));
  await assertFails(setDoc(doc(db('bob'), 'memos', 't7'), memoData('bob', 't7', 'global', { tags: ['ok', 7] })));
});
await test('tags can’t be changed by other people', async () => {
  await assertFails(setDoc(doc(db('alice'), 'memos', 't1'), { tags: ['spam'] }, { merge: true }));
});

console.log('Listened memos');
await test('your listened list is private to you', async () => {
  await assertSucceeds(setDoc(doc(db('alice'), 'users', 'alice', 'private', 'listened'), { ids: ['m-global'] }));
  await assertSucceeds(getDoc(doc(db('alice'), 'users', 'alice', 'private', 'listened')));
  await assertFails(getDoc(doc(db('bob'), 'users', 'alice', 'private', 'listened')));
  await assertFails(setDoc(doc(db('bob'), 'users', 'alice', 'private', 'listened'), { ids: [] }));
});

await env.cleanup();
console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`);
assert.ok(!process.exitCode);
