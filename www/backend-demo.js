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
  let mineLoaded = false;

  const withAuthor = m => ({ ...m, author: byId[m.userId] || me });
  const relation = p => ({ ...p, following: following.has(p.id), close: closeIds.has(p.id) });

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
    async follow(id) { following.add(id); prefs.set('following', [...following]); },
    async unfollow(id) { following.delete(id); prefs.set('following', [...following]); },

    async closeFriendCandidates() {
      return people.filter(p => following.has(p.id) || p.followsMe || closeIds.has(p.id)).map(relation);
    },
    async getCloseFriends() { return new Set(closeIds); },
    async setCloseFriends(ids) { closeIds = new Set(ids); prefs.set('closeFriends', [...closeIds]); },

    async stats() { return { followers: 248, following: following.size }; },
  };
}
