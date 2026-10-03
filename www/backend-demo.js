// Demo backend: example people and memos, everything stored on this device.
// Implements the same interface as backend-firebase.js.
import { seededPeaks, synthMemo } from './audio-utils.js';

const MIN = 60 * 1000;

const prefs = {
  get(key, fallback) {
    try { const v = localStorage.getItem('gt.' + key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('gt.' + key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  },
};

// Memos you record in demo mode live in IndexedDB (best effort).
const idb = (() => {
  let dbp;
  function open() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        try {
          const req = indexedDB.open('gopherturtle', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('memos', { keyPath: 'id' });
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        } catch (e) { reject(e); }
      });
    }
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction('memos', mode);
      const r = fn(t.objectStore('memos'));
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
    });
  }
  return {
    all: () => tx('readonly', s => s.getAll()).catch(() => []),
    put: memo => tx('readwrite', s => s.put(memo)).catch(() => {}),
    del: id => tx('readwrite', s => s.delete(id)).catch(() => {}),
  };
})();

export function createDemoBackend() {
  const me = { id: 'me', name: 'You', handle: 'you', color: '#2f6b4f' };
  const people = [
    { id: 'u1', name: 'Maya Ortiz', handle: 'mayasays', color: '#c2553a', following: true, followsMe: true },
    { id: 'u2', name: 'Jonah Pike', handle: 'jonahp', color: '#3b6fb6', following: true, followsMe: true },
    { id: 'u3', name: 'Priya Natarajan', handle: 'priyan', color: '#8a4fb0', following: true, followsMe: true },
    { id: 'u4', name: 'Theo Brandt', handle: 'theob', color: '#2f8a7a', following: true, followsMe: false },
    { id: 'u5', name: 'Ruth Achebe', handle: 'ruthreads', color: '#b5791f', following: true, followsMe: true },
    { id: 'u6', name: 'Field Notes Radio', handle: 'fieldnotes', color: '#4e6b2f', following: false, followsMe: false },
    { id: 'u7', name: 'Sam Okafor', handle: 'samokafor', color: '#a3456b', following: false, followsMe: false },
    { id: 'u8', name: 'Lena Fischer', handle: 'lenaf', color: '#5560b8', following: false, followsMe: false },
  ];
  const following = new Set(prefs.get('following', people.filter(p => p.following).map(p => p.id)));
  people.forEach(p => { p.following = following.has(p.id); });
  const byId = Object.fromEntries([me, ...people].map(p => [p.id, p]));
  let closeIds = new Set(prefs.get('closeFriends', ['u1', 'u2']));

  const now = Date.now();
  const seed = [
    { user: 'u1', aud: 'close', ago: 4 * MIN, dur: 23, caption: 'ok you will NOT believe what happened at the farmers market', likes: 6 },
    { user: 'u6', aud: 'global', ago: 18 * MIN, dur: 48, caption: 'Dawn chorus from the marsh — three warblers and something we can’t ID. Help?', likes: 312 },
    { user: 'u3', aud: 'followers', ago: 41 * MIN, dur: 31, caption: 'Hot take: the second album is better', likes: 27 },
    { user: 'u2', aud: 'close', ago: 1.6 * 60 * MIN, dur: 12, caption: 'running 10 late, save me a seat', likes: 2 },
    { user: 'u7', aud: 'global', ago: 3 * 60 * MIN, dur: 56, caption: 'Day 40 of learning cello. Be gentle.', likes: 1204 },
    { user: 'u4', aud: 'followers', ago: 5 * 60 * MIN, dur: 19, caption: 'Quick update on the garden box build', likes: 14 },
    { user: 'u5', aud: 'followers', ago: 9 * 60 * MIN, dur: 38, caption: 'Reading the first page of the book club pick out loud', likes: 33 },
    { user: 'u8', aud: 'global', ago: 22 * 60 * MIN, dur: 27, caption: 'Street musician in Lisbon, had to share', likes: 589 },
    { user: 'u1', aud: 'close', ago: 26 * 60 * MIN, dur: 9, caption: 'goodnight turtles 🐢', likes: 8 },
  ].map((m, i) => ({
    amplifies: [3, 41, 2, 0, 96, 1, 4, 57, 0][i],
    amplified: false,
    amplifiedBy: i === 1 ? ['Priya Natarajan'] : i === 7 ? ['Ruth Achebe', 'Theo Brandt'] : [],
    amplifiedAt: i === 1 ? now - 6 * MIN : i === 7 ? now - 50 * MIN : 0,
    id: 'seed-' + i,
    userId: m.user,
    audience: m.aud,
    createdAt: now - m.ago,
    duration: m.dur,
    caption: m.caption,
    likes: m.likes,
    liked: false,
    seed: i + 1,
    peaks: seededPeaks(i + 1),
  }));
  let memos = [...seed];
  const comments = {
    'seed-0': [
      { userId: 'u2', text: 'NO. tell me everything', ago: 3 * MIN },
      { userId: 'u3', text: 'the suspense 😭', ago: 2 * MIN },
    ],
    'seed-1': [
      { userId: 'u5', text: 'The last one sounds like a marsh wren to me', ago: 12 * MIN },
      { userId: 'u8', text: 'This is so peaceful, thank you', ago: 9 * MIN },
      { userId: 'u4', text: 'Agree with Ruth, marsh wren', ago: 4 * MIN },
    ],
    'seed-4': [{ userId: 'u1', text: 'Day 40 and already this good??', ago: 2 * 60 * MIN }],
  };
  Object.entries(comments).forEach(([memoId, list]) => {
    comments[memoId] = list.map((c, i) => ({ id: `${memoId}-c${i}`, memoId, userId: c.userId, text: c.text, createdAt: now - c.ago }));
  });
  let blocked = new Set(prefs.get('blocked', []));
  let mineLoaded = false;

  const withAuthor = m => ({ ...m, author: byId[m.userId] || me, comments: (comments[m.id] || []).length });
  const relation = p => ({ ...p, following: following.has(p.id), requested: false, close: closeIds.has(p.id), blocked: blocked.has(p.id) });
  // One example request so the approve/decline screen has something in it.
  let incoming = prefs.get('incomingRequests', ['u7']);

  return {
    mode: 'demo',
    get me() { return me; },
    email: '',
    signedIn: true,

    async init(onUser) { onUser(me); },
    async signOut() {},

    async loadFeed() {
      if (!mineLoaded) {
        mineLoaded = true;
        const saved = await idb.all();
        const known = new Set(memos.map(m => m.id));
        saved.forEach(m => { if (!known.has(m.id)) memos.push(m); });
      }
      // Followers-only memos only reach you from people you follow.
      return memos
        .filter(m => !blocked.has(m.userId))
        .filter(m => m.userId === me.id || m.audience !== 'followers' || following.has(m.userId))
        .map(withAuthor);
    },

    async audioUrl(m) {
      const stored = memos.find(x => x.id === m.id);
      const blob = (stored && stored.blob) || await synthMemo(m.seed || 1, m.duration);
      return URL.createObjectURL(blob);
    },

    async postMemo({ blob, duration, audience, caption, peaks }) {
      const memo = {
        id: 'me-' + Date.now(), userId: me.id, audience, createdAt: Date.now(),
        duration, caption, likes: 0, liked: false, peaks, blob,
        amplifies: 0, amplified: false, amplifiedBy: [], amplifiedAt: 0,
      };
      memos.push(memo);
      idb.put(memo);
      return withAuthor(memo);
    },

    async deleteMemo(m) {
      memos = memos.filter(x => x.id !== m.id);
      idb.del(m.id);
    },

    async toggleLike(m) {
      const stored = memos.find(x => x.id === m.id);
      stored.liked = !stored.liked;
      stored.likes += stored.liked ? 1 : -1;
      if (stored.userId === me.id) idb.put(stored);
      return { liked: stored.liked, likes: stored.likes };
    },

    async searchPeople(q) {
      q = q.trim().toLowerCase();
      return people
        .filter(p => !q || p.name.toLowerCase().includes(q) || p.handle.includes(q))
        .map(relation);
    },
    // Demo people approve follow requests instantly.
    async follow(id) { following.add(id); prefs.set('following', [...following]); return 'following'; },
    async cancelRequest() {},
    async getRequested() { return new Set(); },
    async listFollowRequests() {
      return incoming.filter(id => byId[id] && !blocked.has(id)).map(id => ({ user: byId[id], createdAt: now - 30 * MIN }));
    },
    async approveRequest(id) {
      incoming = incoming.filter(x => x !== id); prefs.set('incomingRequests', incoming);
      if (byId[id]) byId[id].followsMe = true;
    },
    async declineRequest(id) { incoming = incoming.filter(x => x !== id); prefs.set('incomingRequests', incoming); },
    async removeFollower(id) { if (byId[id]) byId[id].followsMe = false; },
    async listFollowers(userId) {
      const list = userId === me.id ? people.filter(p => p.followsMe) : people.filter(p => p.id !== userId).slice(0, 4);
      return list.map(relation);
    },
    async listFollowing(userId) {
      const list = userId === me.id ? people.filter(p => following.has(p.id)) : people.filter(p => p.id !== userId).slice(2, 6);
      return list.map(relation);
    },
    async getUserProfile(userId) {
      const user = byId[userId];
      const visible = blocked.has(userId) ? [] : memos.filter(m => m.userId === userId
        && (m.audience === 'global' || (m.audience === 'followers' && following.has(userId)) || m.audience === 'close'));
      return { user: { ...relation(user), followsMe: !!user.followsMe }, followers: 40 + userId.charCodeAt(1) * 7, following: 25 + userId.charCodeAt(1) * 3, memos: visible.map(withAuthor) };
    },
    async unfollow(id) { following.delete(id); prefs.set('following', [...following]); },

    async toggleAmplify(m) {
      const stored = memos.find(x => x.id === m.id);
      stored.amplified = !stored.amplified;
      stored.amplifies = Math.max(0, (stored.amplifies || 0) + (stored.amplified ? 1 : -1));
      return { amplified: stored.amplified, amplifies: stored.amplifies };
    },

    async listComments(m) {
      return (comments[m.id] || [])
        .filter(c => !blocked.has(c.userId))
        .map(c => ({ ...c, author: byId[c.userId] || me }));
    },
    async addComment(m, text) {
      const c = { id: 'c-' + Date.now(), memoId: m.id, userId: me.id, text, createdAt: Date.now() };
      (comments[m.id] = comments[m.id] || []).push(c);
      return { ...c, author: me };
    },
    async deleteComment(m, c) {
      comments[m.id] = (comments[m.id] || []).filter(x => x.id !== c.id);
    },
    async report() { /* demo mode: nothing is sent */ },
    async block(id) {
      blocked.add(id); prefs.set('blocked', [...blocked]);
      following.delete(id); prefs.set('following', [...following]);
      if (closeIds.delete(id)) prefs.set('closeFriends', [...closeIds]);
    },
    async unblock(id) { blocked.delete(id); prefs.set('blocked', [...blocked]); },
    async getBlocked() { return people.filter(p => blocked.has(p.id)); },

    async getFollowing() { return new Set(following); },
    async discoverSignals() {
      // Example "followed by people you follow" data for demo mode.
      const fofRaw = { u6: ['u1', 'u3'], u7: ['u2'], u8: ['u5', 'u1', 'u4'] };
      const fof = new Map();
      Object.entries(fofRaw).forEach(([u, fs]) => {
        if (following.has(u) || blocked.has(u)) return;
        const names = fs.filter(f => following.has(f)).map(f => byId[f].name);
        if (names.length) fof.set(u, names);
      });
      const suggestions = [...fof.keys()].map(u => relation(byId[u]));
      return { following: new Set(following), fof, suggestions };
    },

    async closeFriendCandidates() {
      return people.filter(p => !blocked.has(p.id) && (following.has(p.id) || p.followsMe || closeIds.has(p.id))).map(relation);
    },
    async getCloseFriends() { return new Set(closeIds); },
    async setCloseFriends(ids) { closeIds = new Set(ids); prefs.set('closeFriends', [...closeIds]); },

    async stats() { return { followers: people.filter(p => p.followsMe).length, following: following.size }; },
  };
}
