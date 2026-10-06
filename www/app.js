/* TwoCents — scrollable voice memos.
 * Vanilla JS modules, no build step for the app itself.
 * Data comes from a backend: demo (on-device examples) or Firebase (real accounts),
 * chosen by www/firebase-config.js.
 */
import { BARS, rng, seededPeaks, synthMemo } from './audio-utils.js';
import { createDemoBackend } from './backend-demo.js';
import { filterText } from './text-filter.js';
import { firebaseConfig } from './firebase-config.js';

// ---------- Constants ----------
const AUDIENCES = {
  close: { label: 'Close friends', feedLabel: 'Close friends' },
  followers: { label: 'Followers only', feedLabel: 'Following' },
  global: { label: 'Global', feedLabel: 'Global' },
};
const MAX_SECONDS = 5 * 60;
const SPEEDS = [1, 1.25, 1.5, 2];
const HOLD_MS = 450;
const MIN = 60 * 1000;

// ---------- Local preferences ----------
const prefs = {
  get(key, fallback) {
    try { const v = localStorage.getItem('gt.' + key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('gt.' + key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  },
};

// ---------- Backend ----------
let backend;
let friendlyError = e => (e && e.message) || 'Something went wrong. Try again.';

// ---------- State ----------
const state = {
  memos: [],
  loading: true,
  filter: null,      // null = everything, newest first
  screen: 'home',
  query: '',
  closeCount: 0,
  following: new Set(),   // people you follow
  requested: new Set(),   // people you've asked to follow (waiting for approval)
  requests: [],           // people asking to follow you
  viewUser: null,         // whose profile is open
  tab: 'home',            // bottom-bar tab you're in
  nav: [],                // screens to go back to (profiles and lists)
  list: null,             // open followers/following list: {type, userId, handle}
  profileMemos: [],       // memos shown on someone else's profile
  profileEmpty: '',       // what that profile says when it has no memos
  userTag: null,          // tag filter on someone else's profile (lowercase), null = all
  myTag: null,            // tag filter on your own profile
  signals: null,          // Discover ranking data from the backend
  rate: SPEEDS.includes(prefs.get('rate', 1)) ? prefs.get('rate', 1) : 1,
};

// ---------- Elements ----------
const $ = sel => document.querySelector(sel);
const app = $('#app');
const feedEl = $('#feed');
const discoverEl = $('#discover-feed');
// Home: everything from people you follow, close friends memos sent to you, and your own.
// Discover: public (global) memos, ranked for you.
function onHome(m) {
  return m.userId === backend.me.id || m.audience === 'close' || state.following.has(m.userId)
    || (m.amplifiedBy && m.amplifiedBy.length > 0);
}
function amplifiedText(names) {
  if (names.length === 1) return `Reposted by ${names[0]}`;
  if (names.length === 2) return `Reposted by ${names[0]} and ${names[1]}`;
  return `Reposted by ${names[0]} and ${names.length - 1} others`;
}
const feedLabel = $('#feed-label');

// ---------- Helpers ----------
function fmtDur(s) {
  s = Math.max(0, Math.round(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function timeAgo(t) {
  const d = Math.max(0, Date.now() - t);
  if (d < MIN) return 'just now';
  if (d < 60 * MIN) return Math.floor(d / MIN) + 'm';
  if (d < 24 * 60 * MIN) return Math.floor(d / (60 * MIN)) + 'h';
  return Math.floor(d / (24 * 60 * MIN)) + 'd';
}
function fmtCount(n) {
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n);
}
function initials(name) {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

// ---------- Rendering ----------
const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>';
const ICON_MORE = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4.5" height="16" rx="1.2"/><rect x="13.5" y="4" width="4.5" height="16" rx="1.2"/></svg>';

// ---------- Tags ----------
// People tag memos so listeners know what they're about, and profiles can be filtered by tag.
const TAG_SUGGESTIONS = ['Funny story', 'Life update', 'Good news', 'Story time', 'Hot take', 'Rant', 'Advice', 'Question', 'Music', 'Random thoughts'];
const MAX_TAGS = 3;
const TAG_MAX_LEN = 24;
function cleanTag(raw) {
  return raw.replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, TAG_MAX_LEN).trim();
}
const tagKey = t => t.toLowerCase();
function tagsHTML(m) {
  if (!m.tags || !m.tags.length) return '';
  return `<div class="memo-tags">${m.tags.map(t =>
    `<button class="tag-pill" data-act="tag" data-tag="${esc(t)}" aria-label="More ${esc(filterText(t))} memos from ${esc(m.author.name)}">${esc(filterText(t))}</button>`).join('')}</div>`;
}
// Each tag used in these memos, most used first: [[key, {label, n}], …]
function tagCounts(memos) {
  const map = new Map();
  memos.forEach(m => (m.tags || []).forEach(t => {
    const e = map.get(tagKey(t)) || { label: t, n: 0 };
    e.n++;
    map.set(tagKey(t), e);
  }));
  return [...map.entries()].sort((a, b) => b[1].n - a[1].n || a[1].label.localeCompare(b[1].label));
}
const withTag = (memos, key) => key ? memos.filter(m => (m.tags || []).some(t => tagKey(t) === key)) : memos;
// The row of tag chips over a profile's memos. Returns the tag still in effect.
function renderTagFilter(el, memos, active) {
  const tags = tagCounts(memos);
  if (active && !tags.some(([k]) => k === active)) active = null;
  el.hidden = !tags.length;
  el.innerHTML = tags.length ? [
    `<button class="tag-chip" data-tag-filter="" aria-pressed="${!active}">All</button>`,
    ...tags.map(([k, e]) => `<button class="tag-chip" data-tag-filter="${esc(k)}" aria-pressed="${active === k}">${esc(filterText(e.label))}<span>${e.n}</span></button>`),
  ].join('') : '';
  return active;
}

const HEARD_TAG = ' · <span class="heard-tag"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>Listened</span>';
function memoHTML(m, reason) {
  const u = m.author;
  const mine = m.userId === backend.me.id;
  const aud = AUDIENCES[m.audience];
  const bars = m.peaks.map(p => `<i style="height:${Math.round(12 + p * 88)}%"></i>`).join('');
  const heard = !mine && isHeard(m);
  return `
    <li class="memo${heard ? ' is-heard' : ''}" data-aud="${m.audience}" data-id="${m.id}">
      <div class="memo-head">
        ${avatarHTML(u, true)}
        <div class="memo-who" data-user="${esc(u.id)}">
          <div class="memo-name">${esc(u.name)}</div>
          <div class="memo-meta">@${esc(u.handle)} · ${timeAgo(m.createdAt)}${heard ? HEARD_TAG : ''}</div>
        </div>
        <span class="aud-badge">${aud.label}</span>
      </div>
      ${reason ? `<p class="memo-reason">${esc(reason)}</p>` : ''}
      ${m.caption ? `<p class="memo-caption">${esc(filterText(m.caption))}</p>` : ''}
      ${tagsHTML(m)}
      <div class="player">
        <button class="play-btn" data-act="play" aria-label="Play memo from ${esc(u.name)}. Press and hold for playback speed.">${ICON_PLAY}</button>
        <div class="wave" data-act="seek" role="presentation">${bars}</div>
        ${state.rate !== 1 ? `<span class="speed-tag">${state.rate}×</span>` : ''}
        <span class="dur">${fmtDur(m.duration)}</span>
      </div>
      <div class="memo-actions">
        <button class="act ${m.liked ? 'liked' : ''}" data-act="like" aria-pressed="${m.liked}">
          <svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>
          <span class="act-label">Like</span><span class="act-count">${fmtCount(m.likes)}</span>
        </button>
        <button class="act" data-act="comments">
          <svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>
          <span class="act-label">Comment</span><span class="act-count">${fmtCount(m.comments || 0)}</span>
        </button>
        ${m.audience === 'global' ? `<button class="act act-amp ${m.amplified ? 'amplified' : ''}" data-act="amplify" aria-pressed="${!!m.amplified}" ${mine ? 'disabled title="You can’t repost your own memo"' : ''}>
          <svg viewBox="0 0 24 24"><path d="M4 11V9a3 3 0 0 1 3-3h12m-3-3 3 3-3 3M20 13v2a3 3 0 0 1-3 3H5m3 3-3-3 3-3"/></svg>
          <span class="act-label">Repost</span><span class="act-count">${fmtCount(m.amplifies || 0)}</span>
        </button>` : ''}
        <button class="more-btn" data-act="more" aria-label="More options for this memo">${ICON_MORE}</button>
      </div>
    </li>`;
}

function renderList(el, memos, emptyText, reasons) {
  prefetchAudio(memos);
  el.innerHTML = memos.length
    ? memos.map(m => memoHTML(m, reasons && reasons.get(m.id))).join('')
    : `<li class="empty">${emptyText}</li>`;
  if (player.memo) markPlaying(player.memo.id, true);
}

// Profile header pieces shared by your profile and other people's.
function paintAvatar(el, u) {
  el.style.setProperty('--av', u.color || '#7a857c');
  el.innerHTML = u.photoURL ? `<img src="${esc(u.photoURL)}" alt="">` : esc(initials(u.name || '?'));
}
function linkLabel(url) {
  try {
    const x = new URL(url);
    return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/$/, '') + x.search).slice(0, 60);
  } catch (e) { return url; }
}
function paintBioAndLink(bioEl, linkEl, u) {
  bioEl.textContent = u.bio ? filterText(u.bio) : '';
  bioEl.hidden = !u.bio;
  const ok = u.link && /^https?:\/\//i.test(u.link);
  linkEl.hidden = !ok;
  if (ok) { linkEl.href = u.link; linkEl.textContent = linkLabel(u.link); }
  else linkEl.removeAttribute('href');
}

// A person's avatar: their photo if they have one, otherwise initials on their color.
function avatarHTML(u, linkable, extraClass = '') {
  const attrs = linkable ? ` data-user="${esc(u.id)}"` : '';
  const inner = u.photoURL
    ? `<img src="${esc(u.photoURL)}" alt="" loading="lazy">`
    : esc(initials(u.name || '?'));
  return `<div class="avatar${extraClass}" style="--av:${esc(u.color || '#7a857c')}"${attrs}>${inner}</div>`;
}

function findMemo(id) {
  return state.memos.find(x => x.id === id) || state.profileMemos.find(x => x.id === id);
}

function sorted(list) {
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

function renderHome() {
  if (state.loading && !state.memos.length) {
    feedLabel.textContent = 'Loading memos…';
    feedEl.innerHTML = '';
    return;
  }
  const filters = {
    close: m => m.audience === 'close',
    followers: m => (state.following.has(m.userId) || m.amplifiedBy.length > 0) && m.audience !== 'close',
  };
  // Amplified memos sort by when they were amplified.
  const homeTime = m => Math.max(m.createdAt, m.amplifiedAt || 0);
  const list = state.memos
    .filter(m => onHome(m) && (!state.filter || filters[state.filter](m)))
    .sort((a, b) => homeTime(b) - homeTime(a));
  const reasons = new Map(list.filter(m => m.amplifiedBy && m.amplifiedBy.length).map(m => [m.id, amplifiedText(m.amplifiedBy)]));
  feedLabel.textContent = {
    close: 'Close friends · newest first',
    followers: 'People you follow · newest first',
  }[state.filter] || 'Close friends and people you follow, newest first';
  renderList(feedEl, list, {
    close: 'No close friends memos yet.',
    followers: 'No memos from people you follow yet. Find people in Search or on Discover.',
  }[state.filter] || 'No memos yet. Follow people from Search or Discover, and their memos will show up here.', reasons);
  document.querySelectorAll('.chip').forEach(c =>
    c.setAttribute('aria-pressed', String(c.dataset.filter === state.filter)));
}

// ---------- Discover ranking ----------
// Scores public memos for this person: people followed by people you follow,
// people whose memos you've liked or listened to, popularity and freshness.
// Memos you've already heard, and memos from people you already follow
// (they're on Home), sink lower.
// The same list marks memos as "Listened" and makes auto-play skip them.
// It's saved to your account so it follows you to other devices.
const listening = {
  heard: new Set(),
  plays: prefs.get('authorPlays', {}),
  saveTimer: 0,
  record(m) {
    if (this.heard.has(m.id)) return;
    this.heard.add(m.id);
    this.plays[m.userId] = (this.plays[m.userId] || 0) + 1;
    prefs.set(this.key(), [...this.heard].slice(-1000));
    prefs.set('authorPlays', this.plays);
    cardsFor(m.id).forEach(markHeardCard);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      if (backend && backend.me) backend.saveListened([...this.heard].slice(-1000)).catch(e => console.warn('Couldn’t save listened memos', e));
    }, 1500);
  },
  key() { return 'heard.' + backend.me.id; },
  // Load this account's list from the device, then merge in other devices'.
  async sync() {
    this.heard = new Set(prefs.get(this.key(), []));
    const ids = await backend.getListened();
    const before = this.heard.size;
    ids.forEach(id => this.heard.add(id));
    prefs.set(this.key(), [...this.heard].slice(-1000));
    return this.heard.size !== before;
  },
};
function isHeard(m) { return listening.heard.has(m.id); }
function markHeardCard(card) {
  card.classList.add('is-heard');
  const meta = card.querySelector('.memo-meta');
  if (meta && !meta.querySelector('.heard-tag')) meta.insertAdjacentHTML('beforeend', HEARD_TAG);
}

function followedByText(names) {
  if (names.length === 1) return `Followed by ${names[0]}`;
  if (names.length === 2) return `Followed by ${names[0]} and ${names[1]}`;
  return `Followed by ${names[0]} and ${names.length - 1} others you follow`;
}

function rankDiscover(memos) {
  const sig = state.signals || { fof: new Map() };
  const now = Date.now();
  const likedAuthors = new Set(state.memos.filter(m => m.liked && m.userId !== backend.me.id).map(m => m.userId));
  return memos.map(m => {
    let affinity = 0;
    let reason = '';
    const fof = sig.fof.get(m.userId);
    if (likedAuthors.has(m.userId)) { affinity += 3; reason = `You liked @${m.author.handle} before`; }
    if (fof) { affinity += 1.5 + Math.min(fof.length, 3); reason = reason || followedByText(fof); }
    const plays = listening.plays[m.userId] || 0;
    if (plays) { affinity += Math.min(plays, 5) * 0.5; reason = reason || `You’ve listened to @${m.author.handle}`; }
    const popularity = Math.log1p(m.likes) + 1.5 * Math.log1p(m.comments || 0) + 2 * Math.log1p(m.amplifies || 0);
    if (!reason && popularity >= 3) reason = 'Popular on TwoCents';
    const ageHours = Math.max(0, now - m.createdAt) / 36e5;
    let score = (1 + popularity + affinity) / Math.pow(ageHours + 2, 0.8);
    if (state.following.has(m.userId)) { score *= 0.5; reason = ''; }
    if (listening.heard.has(m.id)) score *= 0.25;
    return { m, score, reason };
  }).sort((a, b) => b.score - a.score);
}

function followButtonHTML(p) {
  const state_ = p.following ? 'following' : p.requested ? 'requested' : 'none';
  const label = { following: 'Following', requested: 'Requested', none: 'Follow' }[state_];
  return `<button class="follow-btn" data-follow="${esc(p.id)}" data-state="${state_}">${label}</button>`;
}

function renderSuggestions() {
  const box = $('#suggestions');
  const people = ((state.signals && state.signals.suggestions) || [])
    .filter(p => !state.following.has(p.id))
    .map(p => ({ ...p, requested: state.requested.has(p.id) }));
  box.hidden = !people.length;
  $('#suggestion-list').innerHTML = people.map(p => `
    <li class="suggestion">
      ${avatarHTML(p, true)}
      <div class="suggestion-name" data-user="${esc(p.id)}">${esc(p.name)}</div>
      <div class="suggestion-why">${esc(followedByText((state.signals.fof.get(p.id) || []).slice(0, 3)))}</div>
      ${followButtonHTML(p)}
    </li>`).join('');
}

function renderDiscover() {
  if (state.loading && !state.memos.length) {
    discoverEl.innerHTML = '<li class="empty">Loading memos…</li>';
    return;
  }
  renderSuggestions();
  // Your own public memos are included too, so a new Global post shows up here.
  const ranked = rankDiscover(state.memos.filter(m => m.audience === 'global'));
  renderList(discoverEl, ranked.map(r => r.m),
    'No public memos yet. Post one with the audience set to Global.',
    new Map(ranked.map(r => [r.m.id, r.reason])));
}

let searchSeq = 0;
async function renderSearch() {
  const seq = ++searchSeq;
  const q = state.query.trim().toLowerCase();
  let people = [];
  // Once the app has lots of people, Search waits for you to type instead of listing everyone.
  let searchOnly = false;
  if (!q) {
    try { searchOnly = (await backend.userCount()) > backend.listAllUnder; } catch (e) { searchOnly = true; }
  }
  if (!searchOnly) {
    try { people = await backend.searchPeople(q); }
    catch (e) { toast(friendlyError(e)); }
  }
  if (seq !== searchSeq) return;
  $('#search-people-title').hidden = searchOnly;
  if (searchOnly) {
    $('#people').innerHTML = '<li class="search-hint">Search for people by name or @handle.</li>';
  } else $('#people').innerHTML = people.length ? people.map(p => `
    <li class="person" data-uid="${esc(p.id)}">
      ${avatarHTML(p, true)}
      <div class="memo-who" data-user="${esc(p.id)}">
        <div class="memo-name">${esc(p.name)}</div>
        <div class="memo-meta">@${esc(p.handle)}${p.close ? ' · <span class="cf-tag">Close friend</span>' : ''}</div>
      </div>
      ${p.blocked
        ? `<button class="unblock-btn" data-unblock="${esc(p.id)}">Unblock</button>`
        : followButtonHTML(p)}
    </li>`).join('') : `<li class="empty">${q ? 'No people match.' : 'No one else is here yet.'}</li>`;

  const memos = sorted(state.memos.filter(m => {
    if (!q) return false;
    const u = m.author;
    return (m.caption || '').toLowerCase().includes(q) || (m.tags || []).some(t => tagKey(t).includes(q)) || u.name.toLowerCase().includes(q) || u.handle.includes(q);
  }));
  renderList($('#search-results'), memos, q ? `No memos match “${esc(state.query)}”.` : 'Type to search memo captions and tags.');
}

function renderProfile() {
  const me = backend.me;
  paintAvatar($('#profile-avatar'), me);
  $('#profile-name').textContent = me.name;
  $('#profile-handle').textContent = '@' + me.handle;
  paintBioAndLink($('#profile-bio'), $('#profile-link'), me);
  // Your profile is what other people see, so close friends memos stay off it.
  const mine = sorted(state.memos.filter(m => m.userId === me.id && m.audience !== 'close'));
  $('#stat-memos').textContent = mine.length;
  $('#cf-count').textContent = `${state.closeCount} ${state.closeCount === 1 ? 'person' : 'people'}`;
  state.myTag = renderTagFilter($('#my-tags'), mine, state.myTag);
  renderList($('#my-feed'), withTag(mine, state.myTag), 'Memos you post to followers or Global show up here.');
  backend.getBlocked().then(list => {
    $('#blocked-count').textContent = list.length ? String(list.length) : '';
  }).catch(() => {});
  $('#account').hidden = backend.mode !== 'firebase';
  $('#demo-note').hidden = backend.mode !== 'demo';
  $('#account-email').textContent = backend.email || '';
  backend.stats().then(st => {
    $('#stat-followers').textContent = fmtCount(st.followers);
    $('#stat-following').textContent = fmtCount(st.following);
  }).catch(() => {});
}

const TAB_SCREENS = ['home', 'discover', 'search', 'profile'];
function render() {
  app.dataset.screen = state.screen;
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== 'screen-' + state.screen; });
  if (TAB_SCREENS.includes(state.screen)) { state.tab = state.screen; state.nav = []; }
  const activeTab = state.tab;
  document.querySelectorAll('.tab[data-screen]').forEach(t =>
    t.classList.toggle('is-active', t.dataset.screen === activeTab));
  if (state.screen === 'home') renderHome();
  if (state.screen === 'discover') renderDiscover();
  if (state.screen === 'search') renderSearch();
  if (state.screen === 'profile') renderProfile();
  if (state.screen === 'user') renderUserProfile();
  if (state.screen === 'people') renderPeopleList();
}

// ---------- Playback ----------
const audio = new Audio();
audio.preload = 'auto';
const urlCache = new Map();
const player = { memo: null, raf: 0 };

async function sourceFor(m) {
  if (!urlCache.has(m.id)) urlCache.set(m.id, await backend.audioUrl(m));
  return urlCache.get(m.id);
}

// iPhones only let audio start right when you tap. Looking up a memo's audio
// address takes a moment, so: fetch addresses ahead of time for memos on screen,
// and if one isn't ready, start a silent clip on tap to keep playback allowed.
const SILENT_AUDIO = 'data:audio/wav;base64,UklGRuwAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YcgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
const prefetching = new Set();
function prefetchAudio(memos) {
  if (!backend || !backend.me) return;
  memos.slice(0, 15).forEach(m => {
    if (urlCache.has(m.id) || prefetching.has(m.id)) return;
    prefetching.add(m.id);
    backend.audioUrl(m)
      .then(url => urlCache.set(m.id, url))
      .catch(() => {})
      .finally(() => prefetching.delete(m.id));
  });
}
function playErrorMessage(e) {
  const code = (e && e.code) || '';
  if (code === 'storage/unauthorized') return 'You don’t have access to this memo anymore.';
  if (code === 'storage/object-not-found') return 'This memo’s audio was deleted.';
  if (code.startsWith('storage/')) return 'Couldn’t load the audio. Check your connection and try again.';
  if (e && e.name === 'NotAllowedError') return 'Tap play again to listen.';
  if ((e && e.name === 'NotSupportedError') || (audio.error && audio.error.code === 4)) {
    return 'This memo’s audio format can’t play on this device.';
  }
  return 'Couldn’t play this memo. Try again.';
}

function cardsFor(id) {
  return document.querySelectorAll(`.memo[data-id="${CSS.escape(id)}"]`);
}
function markPlaying(id, on) {
  cardsFor(id).forEach(card => {
    const b = card.querySelector('.play-btn');
    b.innerHTML = on && !audio.paused ? ICON_PAUSE : ICON_PLAY;
  });
}
function paintProgress(id, frac) {
  cardsFor(id).forEach(card => {
    const bars = card.querySelectorAll('.wave i');
    const lit = Math.round(frac * bars.length);
    bars.forEach((b, i) => b.classList.toggle('on', i < lit));
    const m = findMemo(id);
    card.querySelector('.dur').textContent = frac > 0 && m
      ? fmtDur(m.duration * (1 - frac) / state.rate)
      : fmtDur(m ? m.duration : 0);
  });
}
function tick() {
  if (!player.memo) return;
  const d = audio.duration && isFinite(audio.duration) ? audio.duration : player.memo.duration;
  const frac = Math.min(1, audio.currentTime / d);
  paintProgress(player.memo.id, frac);
  // Count a memo as heard once most of it has played (used to tailor Discover).
  if (frac > 0.6 && player.memo.userId !== backend.me.id) listening.record(player.memo);
  player.raf = requestAnimationFrame(tick);
}

async function togglePlay(m, seekFrac) {
  if (player.memo && player.memo.id === m.id) {
    if (seekFrac != null) {
      const d = isFinite(audio.duration) ? audio.duration : m.duration;
      audio.currentTime = seekFrac * d;
      if (audio.paused) await audio.play().catch(() => {});
    } else if (audio.paused) {
      await audio.play().catch(() => {});
    } else {
      audio.pause();
    }
    markPlaying(m.id, true);
    return;
  }
  stopPlayback();
  player.memo = m;
  markPlaying(m.id, true);
  try {
    if (urlCache.has(m.id)) {
      audio.src = urlCache.get(m.id); // ready: start playing within the tap
    } else {
      audio.src = SILENT_AUDIO;       // keep playback allowed while we look it up
      audio.play().catch(() => {});
      const url = await sourceFor(m);
      if (player.memo !== m) return;
      audio.src = url;
    }
    if (seekFrac != null) {
      await new Promise(r => {
        if (audio.readyState >= 1) r();
        else audio.addEventListener('loadedmetadata', r, { once: true });
      });
      audio.currentTime = seekFrac * (isFinite(audio.duration) ? audio.duration : m.duration);
    }
    audio.playbackRate = state.rate;
    await audio.play();
  } catch (e) {
    console.error('Playback failed', e, audio.error);
    if (player.memo === m) stopPlayback();
    toast(playErrorMessage(e));
    return;
  }
  markPlaying(m.id, true);
  cancelAnimationFrame(player.raf);
  tick();
}

function stopPlayback() {
  if (!player.memo) return;
  const id = player.memo.id;
  audio.pause();
  cancelAnimationFrame(player.raf);
  player.memo = null;
  markPlaying(id, false);
  paintProgress(id, 0);
}
audio.addEventListener('ended', () => {
  if (audio.src.startsWith('data:')) return; // the silent placeholder, not a memo
  const m = player.memo;
  if (m && m.userId !== backend.me.id) listening.record(m);
  stopPlayback();
  // Keep scrolling hands-free: play the next memo in the visible feed you
  // haven't listened to yet (your own memos are skipped too).
  const listEl = { home: feedEl, discover: discoverEl }[state.screen];
  if (m && listEl) {
    let card = listEl.querySelector(`.memo[data-id="${CSS.escape(m.id)}"]`);
    let nm = null;
    while (card && (card = card.nextElementSibling)) {
      const c = card.dataset.id && findMemo(card.dataset.id);
      if (c && !isHeard(c) && c.userId !== backend.me.id) { nm = c; break; }
    }
    if (nm) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      togglePlay(nm);
    }
  }
});
audio.addEventListener('pause', () => player.memo && markPlaying(player.memo.id, true));
audio.addEventListener('error', () => {
  if (!player.memo || audio.src.startsWith('data:')) return;
  console.error('Audio error', audio.error);
  stopPlayback();
  toast(playErrorMessage(null));
});

// ---------- Recorder ----------
const rec = {
  stream: null, mr: null, chunks: [], ctx: null, analyser: null,
  levels: [], start: 0, raf: 0, blob: null, duration: 0, demo: false,
  previewUrl: null,
};
const sheet = $('#sheet');
const backdrop = $('#sheet-backdrop');
const recBtn = $('#rec-btn');
const recTimer = $('#rec-timer');
const recNote = $('#rec-note');
const canvas = $('#rec-wave');
const cctx = canvas.getContext('2d');
const preview = new Audio();

function openSheet() {
  if (!backend || !backend.me) { toast('Still loading your account. Try again in a moment.'); return; }
  stopPlayback();
  resetRecorder();
  sheet.hidden = false;
  backdrop.hidden = false;
  recBtn.focus();
}
function closeSheet() {
  stopRecording(true);
  preview.pause();
  sheet.hidden = true;
  backdrop.hidden = true;
}
function resetRecorder() {
  preview.pause();
  if (rec.previewUrl) URL.revokeObjectURL(rec.previewUrl);
  Object.assign(rec, { chunks: [], levels: [], blob: null, duration: 0, previewUrl: null });
  recBtn.classList.remove('is-recording', 'is-done');
  recBtn.setAttribute('aria-label', 'Start recording');
  recTimer.textContent = '0:00';
  $('#rec-redo').hidden = true;
  $('#rec-play').hidden = true;
  $('#rec-play').textContent = 'Play';
  $('#post-form').hidden = true;
  $('#caption').value = '';
  postTags.length = 0;
  $('#tag-input').value = '';
  renderTagOptions();
  recNote.hidden = true;
  drawLevels([]);
  syncAudienceColor();
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function drawLevels(levels) {
  const W = canvas.width, H = canvas.height;
  cctx.clearRect(0, 0, W, H);
  const n = 68, gap = 3, bw = (W - gap * (n - 1)) / n;
  const tail = levels.slice(-n);
  cctx.fillStyle = cssVar('--line');
  for (let i = 0; i < n; i++) {
    const v = tail[i - (n - tail.length)];
    if (v == null) { cctx.fillRect(i * (bw + gap), H / 2 - 2, bw, 4); }
  }
  cctx.fillStyle = cssVar('--rec');
  tail.forEach((v, j) => {
    const i = n - tail.length + j;
    const h = Math.max(4, v * (H - 16));
    cctx.fillRect(i * (bw + gap), (H - h) / 2, bw, h);
  });
}

function micErrorMessage(e) {
  if (!window.isSecureContext) return 'Recording needs a secure connection. Open the app from its https:// address.';
  if (!navigator.mediaDevices || !window.MediaRecorder) return 'This browser can’t record audio. Try Safari or Chrome.';
  if (e && e.name === 'NotAllowedError') return 'TwoCents needs your microphone. Allow microphone access in your browser or phone settings, then tap record again.';
  if (e && e.name === 'NotFoundError') return 'No microphone was found on this device.';
  return 'Couldn’t start the microphone. Close other apps using it and try again.';
}

async function startRecording() {
  resetRecorder();
  rec.demo = false;
  try {
    if (!navigator.mediaDevices || !window.MediaRecorder) throw new Error('unsupported');
    rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    // With real accounts, never post a stand-in recording: explain how to fix it instead.
    if (backend.mode !== 'demo') {
      recNote.textContent = micErrorMessage(e);
      recNote.hidden = false;
      return;
    }
    rec.demo = true;
    recNote.textContent = 'Microphone isn’t available here, so this is a demo recording. Open the app on your phone and allow the microphone to record your voice.';
    recNote.hidden = false;
  }

  if (!rec.demo) {
    const AC = window.AudioContext || window.webkitAudioContext;
    rec.ctx = new AC();
    const src = rec.ctx.createMediaStreamSource(rec.stream);
    rec.analyser = rec.ctx.createAnalyser();
    rec.analyser.fftSize = 1024;
    src.connect(rec.analyser);
    // MP4/AAC first: it plays on both iPhone and Android.
    const type = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
      .find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
    rec.mr = new MediaRecorder(rec.stream, type ? { mimeType: type } : undefined);
    rec.mr.ondataavailable = e => e.data.size && rec.chunks.push(e.data);
    rec.mr.start(250);
  }

  rec.start = performance.now();
  recBtn.classList.add('is-recording');
  recBtn.setAttribute('aria-label', 'Stop recording');
  const data = rec.analyser ? new Uint8Array(rec.analyser.fftSize) : null;
  const r = rng(Date.now() & 0xffff);
  let lastSample = 0, demoV = .3;
  const loop = t => {
    const secs = (t - rec.start) / 1000;
    recTimer.textContent = fmtDur(Math.floor(secs));
    if (t - lastSample > 60) {
      lastSample = t;
      let v;
      if (data) {
        rec.analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const x of data) sum += ((x - 128) / 128) ** 2;
        v = Math.min(1, Math.sqrt(sum / data.length) * 4);
      } else {
        demoV = Math.min(1, Math.max(.05, demoV + (r() - .5) * .5));
        v = r() < .12 ? .05 : demoV;
      }
      rec.levels.push(v);
      drawLevels(rec.levels);
    }
    if (secs >= MAX_SECONDS) { stopRecording(); return; }
    rec.raf = requestAnimationFrame(loop);
  };
  rec.raf = requestAnimationFrame(loop);
}

async function stopRecording(discard) {
  if (!recBtn.classList.contains('is-recording')) return;
  cancelAnimationFrame(rec.raf);
  rec.duration = Math.max(1, (performance.now() - rec.start) / 1000);
  recBtn.classList.remove('is-recording');

  if (rec.mr) {
    await new Promise(res => { rec.mr.onstop = res; rec.mr.stop(); });
    rec.blob = new Blob(rec.chunks, { type: rec.mr.mimeType || 'audio/webm' });
  }
  if (rec.stream) rec.stream.getTracks().forEach(t => t.stop());
  if (rec.ctx) rec.ctx.close().catch(() => {});
  Object.assign(rec, { stream: null, mr: null, ctx: null, analyser: null });
  if (discard) return;

  if (rec.demo) rec.blob = await synthMemo(Date.now() & 0xffff, rec.duration);
  recBtn.classList.add('is-done');
  recTimer.textContent = fmtDur(rec.duration);
  $('#rec-redo').hidden = false;
  $('#rec-play').hidden = false;
  $('#post-form').hidden = false;
  rec.previewUrl = URL.createObjectURL(rec.blob);
  preview.src = rec.previewUrl;
  $('#post-submit').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function downsample(levels, n) {
  if (!levels.length) return seededPeaks(Date.now() & 0xffff);
  const out = [];
  const max = Math.max(...levels, .01);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * levels.length / n);
    const b = Math.max(a + 1, Math.floor((i + 1) * levels.length / n));
    const slice = levels.slice(a, b);
    out.push(+(Math.max(.08, slice.reduce((s, x) => s + x, 0) / slice.length / max)).toFixed(3));
  }
  return out;
}

function selectedAudience() {
  const r = document.querySelector('input[name="audience"]:checked');
  return r ? r.value : 'followers';
}
function syncAudienceColor() {
  const btn = $('#post-submit');
  const aud = selectedAudience();
  btn.dataset.aud = aud;
  btn.textContent = 'Post to ' + AUDIENCES[aud].label.toLowerCase();
}

// ---------- Tag picker ----------
const postTags = [];
// Tags you've used before, newest first.
function myUsedTags() {
  return backend && backend.me
    ? sorted(state.memos.filter(m => m.userId === backend.me.id)).flatMap(m => m.tags || []) : [];
}
function renderTagOptions() {
  // Your chosen tags, then tags you've used before, then suggestions.
  const seen = new Set();
  const options = [...postTags, ...myUsedTags(), ...TAG_SUGGESTIONS].filter(t => {
    if (seen.has(tagKey(t))) return false;
    seen.add(tagKey(t));
    return true;
  }).slice(0, Math.max(12, postTags.length));
  const full = postTags.length >= MAX_TAGS;
  $('#tag-options').innerHTML = options.map(t => {
    const on = postTags.some(p => tagKey(p) === tagKey(t));
    return `<button type="button" class="tag-chip" data-pick="${esc(t)}" aria-pressed="${on}" ${full && !on ? 'disabled' : ''}>${esc(t)}</button>`;
  }).join('');
  $('#tag-input').disabled = full;
  $('#tag-add-btn').disabled = full;
  $('#tag-input').placeholder = full ? 'Up to 3 tags' : 'Add your own tag';
}
function addTag(raw) {
  let t = cleanTag(raw);
  // Reuse the spelling of a tag you already have, so "funny story" joins "Funny story".
  t = [...myUsedTags(), ...TAG_SUGGESTIONS].find(k => tagKey(k) === tagKey(t)) || t;
  if (!t || postTags.length >= MAX_TAGS || postTags.some(p => tagKey(p) === tagKey(t))) return;
  postTags.push(t);
  renderTagOptions();
}
$('#tag-options').addEventListener('click', e => {
  const b = e.target.closest('[data-pick]');
  if (!b) return;
  const i = postTags.findIndex(p => tagKey(p) === tagKey(b.dataset.pick));
  if (i >= 0) { postTags.splice(i, 1); renderTagOptions(); } else addTag(b.dataset.pick);
});
function addTypedTag() {
  addTag($('#tag-input').value);
  $('#tag-input').value = '';
}
$('#tag-add-btn').addEventListener('click', addTypedTag);
$('#tag-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTypedTag(); }
});

async function submitPost() {
  if (!backend || !backend.me) { toast('Still loading your account. Try again in a moment.'); return; }
  if (!rec.blob || !rec.blob.size) {
    recNote.textContent = 'That recording came out empty. Tap Redo and record again.';
    recNote.hidden = false;
    return;
  }
  addTypedTag(); // a tag typed but not added yet still counts
  const btn = $('#post-submit');
  btn.disabled = true;
  btn.textContent = 'Posting…';
  let memo;
  try {
    memo = await backend.postMemo({
      blob: rec.blob,
      duration: rec.duration,
      audience: selectedAudience(),
      caption: $('#caption').value.trim(),
      tags: [...postTags],
      peaks: downsample(rec.levels, BARS),
    });
  } catch (e) {
    console.error(e);
    toast(friendlyError(e));
    btn.disabled = false;
    syncAudienceColor();
    return;
  }
  btn.disabled = false;
  state.memos = state.memos.filter(m => m.id !== memo.id).concat(memo);
  closeSheet();
  // Show the new memo where it lives: global memos on Discover, the rest on Home.
  state.screen = memo.audience === 'global' ? 'discover' : 'home';
  state.filter = null;
  render();
  $('#screen-' + state.screen).scrollTo({ top: 0, behavior: 'smooth' });
  toast('Posted to ' + AUDIENCES[memo.audience].label.toLowerCase());
}

// ---------- Close friends list ----------
const cfSheet = $('#cf-sheet');
const CHECK = '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>';
let cfDraft = null;
async function openCloseFriends() {
  $('#cf-list').innerHTML = '<li class="empty">Loading…</li>';
  cfSheet.hidden = false;
  backdrop.hidden = false;
  let people;
  try {
    [people, cfDraft] = await Promise.all([backend.closeFriendCandidates(), backend.getCloseFriends()]);
  } catch (e) {
    $('#cf-list').innerHTML = `<li class="empty">${esc(friendlyError(e))}</li>`;
    return;
  }
  // Anyone you follow or who follows you can be a close friend.
  $('#cf-list').innerHTML = people.length ? people.map(p => `
    <li>
      <label class="cf-item">
        ${avatarHTML(p)}
        <div class="memo-who">
          <div class="memo-name">${esc(p.name)}</div>
          <div class="memo-meta">@${esc(p.handle)}</div>
        </div>
        <input type="checkbox" id="cf-${esc(p.id)}" value="${esc(p.id)}" ${cfDraft.has(p.id) ? 'checked' : ''}>
        <span class="cf-check">${CHECK}</span>
      </label>
    </li>`).join('') : '<li class="empty">Follow people or get followers, then add them here.</li>';
}
async function closeCloseFriends() {
  cfSheet.hidden = true;
  if (sheet.hidden) backdrop.hidden = true;
  if (cfDraft) {
    const ids = [...cfDraft];
    cfDraft = null;
    try {
      await backend.setCloseFriends(ids);
      state.closeCount = ids.length;
    } catch (e) { toast(friendlyError(e)); }
  }
  render();
}
$('#cf-open').addEventListener('click', openCloseFriends);
$('#cf-done').addEventListener('click', closeCloseFriends);
$('#cf-list').addEventListener('change', e => {
  if (!cfDraft) return;
  const id = e.target.value;
  if (e.target.checked) cfDraft.add(id); else cfDraft.delete(id);
});

// ---------- Playback speed (press and hold a play button) ----------
const speedMenu = $('#speed-menu');
const hold = { timer: 0, fired: false };

function openSpeedMenu(btn) {
  speedMenu.querySelectorAll('button').forEach(b =>
    b.setAttribute('aria-checked', String(+b.dataset.rate === state.rate)));
  speedMenu.hidden = false;
  const a = app.getBoundingClientRect();
  const r = btn.getBoundingClientRect();
  const w = speedMenu.offsetWidth, h = speedMenu.offsetHeight;
  const left = Math.min(Math.max(8, r.left - a.left - 4), a.width - w - 8);
  let top = r.top - a.top - h - 10;
  if (top < 8) top = r.bottom - a.top + 10;
  speedMenu.style.left = left + 'px';
  speedMenu.style.top = top + 'px';
  if (navigator.vibrate) navigator.vibrate(10);
  speedMenu.querySelector('[aria-checked="true"]').focus({ preventScroll: true });
}
function closeSpeedMenu() { speedMenu.hidden = true; }
function setRate(rate) {
  state.rate = rate;
  prefs.set('rate', rate);
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;
  closeSpeedMenu();
  render();
  toast(rate === 1 ? 'Normal speed' : `Playing at ${rate}×`);
}
speedMenu.addEventListener('click', e => {
  const b = e.target.closest('[data-rate]');
  if (b) setRate(+b.dataset.rate);
});
speedMenu.addEventListener('keydown', e => {
  const items = [...speedMenu.querySelectorAll('button')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
});

const screensEl = document.querySelector('.screens');
function endHold() {
  clearTimeout(hold.timer);
  hold.start = null;
  document.querySelectorAll('.play-btn.is-holding').forEach(b => b.classList.remove('is-holding'));
}
screensEl.addEventListener('pointerdown', e => {
  const btn = e.target.closest('.play-btn');
  if (!btn || e.button > 0) return;
  hold.fired = false;
  hold.start = { x: e.clientX, y: e.clientY };
  btn.classList.add('is-holding');
  hold.timer = setTimeout(() => {
    hold.fired = true;
    btn.classList.remove('is-holding');
    openSpeedMenu(btn);
  }, HOLD_MS);
});
['pointerup', 'pointercancel'].forEach(t => screensEl.addEventListener(t, endHold));
screensEl.addEventListener('pointermove', e => {
  if (hold.start && Math.hypot(e.clientX - hold.start.x, e.clientY - hold.start.y) > 10) endHold();
});
screensEl.addEventListener('scroll', () => { endHold(); closeSpeedMenu(); }, true);
// Right-click on desktop, and the long-press gesture on some phones, also opens the menu.
screensEl.addEventListener('contextmenu', e => {
  const btn = e.target.closest('.play-btn');
  if (!btn) return;
  e.preventDefault();
  endHold();
  hold.fired = true;
  openSpeedMenu(btn);
});
document.addEventListener('pointerdown', e => {
  if (!speedMenu.hidden && !speedMenu.contains(e.target) && !e.target.closest('.play-btn')) closeSpeedMenu();
});

// ---------- Events ----------
$('#filters').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.filter = state.filter === chip.dataset.filter ? null : chip.dataset.filter;
  renderHome();
  feedEl.closest('.screen').scrollTo({ top: 0 });
});

document.querySelector('.tabbar').addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  if (tab.id === 'post-btn') { openSheet(); return; }
  // Tapping Home or Discover again scrolls to the top and checks for new memos.
  if (tab.dataset.screen === state.screen && (state.screen === 'home' || state.screen === 'discover')) {
    $('#screen-' + state.screen).scrollTo({ top: 0, behavior: 'smooth' });
    refreshFeed();
  }
  state.screen = tab.dataset.screen;
  render();
});

document.querySelector('.screens').addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const card = btn.closest('.memo');
  const m = card && findMemo(card.dataset.id);
  if (!m) return;
  const act = btn.dataset.act;
  if (act === 'play') {
    if (hold.fired) { hold.fired = false; return; }
    togglePlay(m);
  }
  if (act === 'seek') {
    const rect = btn.getBoundingClientRect();
    togglePlay(m, Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
  }
  if (act === 'like') toggleLike(m);
  if (act === 'amplify') toggleAmplify(m);
  if (act === 'comments') openComments(m);
  if (act === 'more') memoMenu(m);
  if (act === 'tag') openTag(m.userId, tagKey(btn.dataset.tag));
});

const paintLike = m => cardsFor(m.id).forEach(c => {
  const b = c.querySelector('[data-act="like"]');
  b.classList.toggle('liked', m.liked);
  b.setAttribute('aria-pressed', String(m.liked));
  b.querySelector('.act-count').textContent = fmtCount(m.likes);
});
const paintAmplify = m => cardsFor(m.id).forEach(c => {
  const b = c.querySelector('[data-act="amplify"]');
  if (!b) return;
  b.classList.toggle('amplified', m.amplified);
  b.setAttribute('aria-pressed', String(m.amplified));
  b.querySelector('.act-count').textContent = fmtCount(m.amplifies);
});
const amplifying = new Set();
async function toggleAmplify(m) {
  if (amplifying.has(m.id) || m.userId === backend.me.id) return;
  amplifying.add(m.id);
  const before = { amplified: m.amplified, amplifies: m.amplifies };
  m.amplified = !m.amplified;
  m.amplifies = Math.max(0, m.amplifies + (m.amplified ? 1 : -1));
  paintAmplify(m);
  try {
    Object.assign(m, await backend.toggleAmplify({ ...m, ...before }));
    toast(m.amplified ? 'Reposted to your followers' : 'Repost removed');
  } catch (e) {
    Object.assign(m, before);
    toast(friendlyError(e));
  }
  paintAmplify(m);
  amplifying.delete(m.id);
}
const liking = new Set();
async function toggleLike(m) {
  if (liking.has(m.id)) return;
  liking.add(m.id);
  const before = { liked: m.liked, likes: m.likes };
  // Update right away, then confirm with the server.
  m.liked = !m.liked;
  m.likes = Math.max(0, m.likes + (m.liked ? 1 : -1));
  paintLike(m);
  try {
    Object.assign(m, await backend.toggleLike({ ...m, ...before }));
  } catch (e) {
    Object.assign(m, before);
    toast(friendlyError(e));
  }
  paintLike(m);
  liking.delete(m.id);
}

async function deleteMemo(m) {
  const ok = await chooseAction('Delete this memo? Its likes, comments and reposts go with it. This can’t be undone.',
    [{ key: 'delete', label: 'Delete memo', danger: true }]);
  if (ok !== 'delete') return;
  if (player.memo && player.memo.id === m.id) stopPlayback();
  try {
    await backend.deleteMemo(m);
    state.memos = state.memos.filter(x => x.id !== m.id);
    render();
    toast('Memo deleted');
  } catch (e) { toast(friendlyError(e)); }
}

// Follow / unfollow / unblock from search and Discover suggestions.
async function onPeopleClick(e) {
  const unblockBtn = e.target.closest('[data-unblock]');
  if (unblockBtn) {
    try {
      await backend.unblock(unblockBtn.dataset.unblock);
      toast('Unblocked');
      if (state.screen === 'user') renderUserProfile(); else renderSearch();
      refreshFeed();
    } catch (err) { toast(friendlyError(err)); }
    return;
  }
  const btn = e.target.closest('[data-follow]');
  if (btn) followButtonClicked(btn);
}

// Follow → Requested (until they approve) → Following.
function paintFollowButtons(id, state_) {
  document.querySelectorAll(`[data-follow="${CSS.escape(id)}"]`).forEach(b => {
    b.dataset.state = state_;
    b.textContent = { following: 'Following', requested: 'Requested', none: 'Follow' }[state_];
  });
}
async function followButtonClicked(btn) {
  const id = btn.dataset.follow;
  const current = btn.dataset.state || 'none';
  const name = (btn.closest('[data-handle]') || {}).dataset?.handle;
  btn.disabled = true;
  try {
    if (current === 'none') {
      const result = await backend.follow(id);
      if (result === 'following') state.following.add(id); else state.requested.add(id);
      paintFollowButtons(id, result === 'following' ? 'following' : 'requested');
      toast(result === 'following' ? 'Following' : 'Request sent');
    } else if (current === 'requested') {
      await backend.cancelRequest(id);
      state.requested.delete(id);
      paintFollowButtons(id, 'none');
      toast('Request canceled');
    } else {
      const ok = await chooseAction(
        `Unfollow${name ? ' @' + name : ''}? You’ll need to ask again, and be approved, to hear their followers-only memos.`,
        [{ key: 'unfollow', label: 'Unfollow', danger: true }]);
      if (ok === 'unfollow') {
        await backend.unfollow(id);
        state.following.delete(id);
        paintFollowButtons(id, 'none');
      }
    }
    if (state.screen === 'user') renderUserProfile();
    refreshFeed();
  } catch (err) {
    toast(err && err.code === 'permission-denied' ? 'You can’t follow this account.' : friendlyError(err));
  }
  btn.disabled = false;
}
$('#people').addEventListener('click', onPeopleClick);
$('#suggestion-list').addEventListener('click', onPeopleClick);

$('#search-input').addEventListener('input', e => { state.query = e.target.value; renderSearch(); });

recBtn.addEventListener('click', () => {
  if (recBtn.classList.contains('is-recording')) stopRecording();
  else startRecording();
});
$('#rec-redo').addEventListener('click', startRecording);
$('#rec-play').addEventListener('click', () => {
  if (preview.paused) { preview.currentTime = 0; preview.play().catch(() => {}); $('#rec-play').textContent = 'Stop'; }
  else { preview.pause(); $('#rec-play').textContent = 'Play'; }
});
preview.addEventListener('ended', () => { $('#rec-play').textContent = 'Play'; });
$('#audience').addEventListener('change', syncAudienceColor);
$('#post-submit').addEventListener('click', submitPost);
$('#sheet-cancel').addEventListener('click', closeSheet);
backdrop.addEventListener('click', () => {
  if (!cfSheet.hidden) closeCloseFriends();
  else if (!deleteSheet.hidden) closeDeleteSheet();
  else if (!commentsSheet.hidden) closeComments();
  else if (!blockedSheet.hidden) closeBlocked();
  else if (!requestsSheet.hidden) closeRequests();
  else if (!editSheet.hidden) closeEditProfile();
  else closeSheet();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!speedMenu.hidden) closeSpeedMenu();
  else if (!actionSheet.hidden) closeActions(null);
  else if (!commentsSheet.hidden) closeComments();
  else if (!blockedSheet.hidden) closeBlocked();
  else if (!requestsSheet.hidden) closeRequests();
  else if (!editSheet.hidden) closeEditProfile();
  else if (!cfSheet.hidden) closeCloseFriends();
  else if (!deleteSheet.hidden) closeDeleteSheet();
  else if (!sheet.hidden) closeSheet();
});

// ---------- Action menu ----------
const actionSheet = $('#action-sheet');
const actionBackdrop = $('#action-backdrop');
let actionResolve = null;
// Shows a list of choices and resolves with the chosen key, or null on cancel.
function chooseAction(title, items) {
  if (actionResolve) actionResolve(null);
  $('#action-title').textContent = title || '';
  $('#action-list').innerHTML = items.map(it =>
    `<button class="action-item${it.danger ? ' danger' : ''}" data-key="${esc(it.key)}">${esc(it.label)}</button>`).join('');
  actionSheet.hidden = false;
  actionBackdrop.hidden = false;
  actionSheet.querySelector('.action-item').focus({ preventScroll: true });
  return new Promise(resolve => { actionResolve = resolve; });
}
function closeActions(value) {
  actionSheet.hidden = true;
  actionBackdrop.hidden = true;
  const r = actionResolve;
  actionResolve = null;
  if (r) r(value);
}
$('#action-list').addEventListener('click', e => {
  const b = e.target.closest('[data-key]');
  if (b) closeActions(b.dataset.key);
});
$('#action-cancel').addEventListener('click', () => closeActions(null));
actionBackdrop.addEventListener('click', () => closeActions(null));

// ---------- Report and block ----------
const REASONS = [
  { key: 'spam', label: 'Spam' },
  { key: 'harassment', label: 'Harassment or bullying' },
  { key: 'hate', label: 'Hate speech' },
  { key: 'sexual', label: 'Nudity or sexual content' },
  { key: 'violence', label: 'Violence or threats' },
  { key: 'self-harm', label: 'Self-harm or suicide' },
  { key: 'other', label: 'Something else' },
];

// target: {type, targetId, targetAuthorId, memoId, text, author}
async function reportFlow(target) {
  const what = { memo: 'this memo', comment: 'this comment', user: `@${target.author.handle}` }[target.type];
  const reason = await chooseAction(`Why are you reporting ${what}?`, REASONS);
  if (!reason) return;
  const { author, ...report } = target;
  try {
    await backend.report({ ...report, reason });
  } catch (e) { toast(friendlyError(e)); return; }
  const next = await chooseAction(
    `Thanks for reporting. We review every report within 24 hours. Do you also want to block @${author.handle}?`,
    [{ key: 'block', label: `Block @${author.handle}`, danger: true }, { key: 'no', label: 'Not now' }]);
  if (next === 'block') await blockUser(author, true);
  else toast('Report sent');
}

async function blockUser(user, confirmed) {
  if (!confirmed) {
    const ok = await chooseAction(
      `Block @${user.handle}? They won’t be able to follow you, comment on your memos or send you memos, and you won’t see theirs. They won’t be told.`,
      [{ key: 'block', label: `Block @${user.handle}`, danger: true }]);
    if (ok !== 'block') return;
  }
  try {
    await backend.block(user.id);
  } catch (e) { toast(friendlyError(e)); return; }
  if (player.memo && player.memo.userId === user.id) stopPlayback();
  state.memos = state.memos.filter(m => m.userId !== user.id);
  if (!commentsSheet.hidden && openMemo) {
    if (openMemo.userId === user.id) closeComments();
    else loadComments(openMemo);
  }
  backend.getCloseFriends().then(ids => { state.closeCount = ids.size; }).catch(() => {});
  render();
  toast(`Blocked @${user.handle}`);
}

async function memoMenu(m) {
  if (m.userId === backend.me.id) {
    if (await chooseAction('Your memo', [{ key: 'delete', label: 'Delete memo', danger: true }]) === 'delete') deleteMemo(m);
    return;
  }
  const key = await chooseAction(`Memo from @${m.author.handle}`, [
    { key: 'report', label: 'Report memo', danger: true },
    { key: 'block', label: `Block @${m.author.handle}`, danger: true },
  ]);
  if (key === 'report') {
    reportFlow({ type: 'memo', targetId: m.id, targetAuthorId: m.userId, memoId: m.id, text: m.caption || '', author: m.author });
  }
  if (key === 'block') blockUser(m.author);
}

// ---------- Comments ----------
const commentsSheet = $('#comments-sheet');
const commentInput = $('#comment-input');
let openMemo = null;
let comments = [];

function commentHTML(c) {
  const u = c.author;
  return `
    <li class="comment" data-cid="${esc(c.id)}">
      ${avatarHTML(u, true)}
      <div class="comment-body">
        <div class="comment-meta"><b data-user="${esc(u.id)}">${esc(u.name)}</b> · ${timeAgo(c.createdAt)}</div>
        <p class="comment-text">${esc(filterText(c.text))}</p>
      </div>
      <button class="more-btn" data-cmore="${esc(c.id)}" aria-label="More options for this comment">${ICON_MORE}</button>
    </li>`;
}
function renderComments() {
  $('#comment-list').innerHTML = comments.length
    ? comments.map(commentHTML).join('')
    : '<li class="empty">No comments yet. Be the first.</li>';
  $('#comments-title').textContent = comments.length === 1 ? '1 comment' : `${comments.length} comments`;
}
function setCommentCount(m, n) {
  m.comments = n;
  cardsFor(m.id).forEach(c => { c.querySelector('[data-act="comments"] .act-count').textContent = fmtCount(n); });
}
async function loadComments(m) {
  try {
    const list = await backend.listComments(m);
    if (openMemo !== m) return;
    comments = list;
    renderComments();
    setCommentCount(m, comments.length);
  } catch (e) {
    $('#comment-list').innerHTML = `<li class="empty">${esc(friendlyError(e))}</li>`;
  }
}
function openComments(m) {
  openMemo = m;
  comments = [];
  $('#comment-list').innerHTML = '<li class="empty">Loading…</li>';
  $('#comments-title').textContent = 'Comments';
  commentInput.value = '';
  $('#comment-send').disabled = true;
  commentsSheet.hidden = false;
  backdrop.hidden = false;
  loadComments(m);
}
function closeComments() {
  commentsSheet.hidden = true;
  backdrop.hidden = true;
  openMemo = null;
}
$('#comments-done').addEventListener('click', closeComments);
commentInput.addEventListener('input', () => { $('#comment-send').disabled = !commentInput.value.trim(); });
$('#comment-form').addEventListener('submit', async e => {
  e.preventDefault();
  const text = commentInput.value.trim();
  const m = openMemo;
  if (!text || !m) return;
  $('#comment-send').disabled = true;
  try {
    const c = await backend.addComment(m, text);
    if (openMemo !== m) return;
    comments.push(c);
    commentInput.value = '';
    renderComments();
    setCommentCount(m, comments.length);
    const list = $('#comment-list');
    list.scrollTop = list.scrollHeight;
  } catch (err) {
    toast(err && err.code === 'permission-denied' ? 'You can’t comment on this memo.' : friendlyError(err));
    $('#comment-send').disabled = false;
  }
});
$('#comment-list').addEventListener('click', async e => {
  const b = e.target.closest('[data-cmore]');
  if (!b || !openMemo) return;
  const m = openMemo;
  const c = comments.find(x => x.id === b.dataset.cmore);
  if (!c) return;
  const mine = c.userId === backend.me.id;
  const myMemo = m.userId === backend.me.id;
  const items = [];
  if (mine || myMemo) items.push({ key: 'delete', label: 'Delete comment', danger: true });
  if (!mine) {
    items.push({ key: 'report', label: 'Report comment', danger: true });
    items.push({ key: 'block', label: `Block @${c.author.handle}`, danger: true });
  }
  const key = await chooseAction(mine ? 'Your comment' : `Comment from @${c.author.handle}`, items);
  if (key === 'delete') {
    try {
      await backend.deleteComment(m, c);
      comments = comments.filter(x => x.id !== c.id);
      renderComments();
      setCommentCount(m, comments.length);
    } catch (err) { toast(friendlyError(err)); }
  }
  if (key === 'report') {
    reportFlow({ type: 'comment', targetId: c.id, targetAuthorId: c.userId, memoId: m.id, text: c.text, author: c.author });
  }
  if (key === 'block') blockUser(c.author);
});

// ---------- Blocked people ----------
const blockedSheet = $('#blocked-sheet');
async function openBlocked() {
  blockedSheet.hidden = false;
  backdrop.hidden = false;
  $('#blocked-list').innerHTML = '<li class="empty">Loading…</li>';
  let list = [];
  try { list = await backend.getBlocked(); }
  catch (e) { $('#blocked-list').innerHTML = `<li class="empty">${esc(friendlyError(e))}</li>`; return; }
  $('#blocked-list').innerHTML = list.length ? list.map(p => `
    <li class="person">
      ${avatarHTML(p)}
      <div class="memo-who">
        <div class="memo-name">${esc(p.name)}</div>
        <div class="memo-meta">@${esc(p.handle)}</div>
      </div>
      <button class="unblock-btn" data-unblock-row="${esc(p.id)}">Unblock</button>
    </li>`).join('') : '<li class="empty">You haven’t blocked anyone.</li>';
}
function closeBlocked() {
  blockedSheet.hidden = true;
  backdrop.hidden = true;
  render();
}
$('#blocked-open').addEventListener('click', openBlocked);
$('#blocked-done').addEventListener('click', closeBlocked);
$('#blocked-list').addEventListener('click', async e => {
  const b = e.target.closest('[data-unblock-row]');
  if (!b) return;
  b.disabled = true;
  try {
    await backend.unblock(b.dataset.unblockRow);
    b.closest('li').remove();
    if (!$('#blocked-list li')) $('#blocked-list').innerHTML = '<li class="empty">You haven’t blocked anyone.</li>';
    refreshFeed();
  } catch (err) { toast(friendlyError(err)); b.disabled = false; }
});

// ---------- Other people's profiles ----------
// Profiles and lists stack up so Back returns to where you came from.
function navigate(to) {
  state.nav.push({ screen: state.screen, viewUser: state.viewUser, list: state.list, userTag: state.userTag });
  Object.assign(state, to);
  render();
  $('#screen-' + state.screen).scrollTo({ top: 0 });
}
function goBack() {
  const prev = state.nav.pop() || { screen: state.tab || 'home', viewUser: null, list: null, userTag: null };
  Object.assign(state, prev);
  render();
}
function openProfile(userId) {
  if (!userId) return;
  if (userId === backend.me.id) { state.screen = 'profile'; render(); return; }
  navigate({ screen: 'user', viewUser: userId, userTag: null });
}
function openList(type, userId, handle) {
  navigate({ screen: 'people', list: { type, userId, handle } });
}
// Tapping a name or avatar anywhere opens that person's profile.
document.addEventListener('click', e => {
  const el = e.target.closest('[data-user]');
  if (!el || e.target.closest('button:not([data-user]), input, label')) return;
  if (!commentsSheet.hidden) closeComments();
  if (!requestsSheet.hidden) closeRequests();
  openProfile(el.dataset.user);
});
$('#user-back').addEventListener('click', goBack);
$('#people-back').addEventListener('click', goBack);

// Followers / Following counts open the lists.
document.addEventListener('click', e => {
  const stat = e.target.closest('[data-list]');
  if (!stat) return;
  if (stat.dataset.listOf === 'me') openList(stat.dataset.list, backend.me.id, backend.me.handle);
  else if (state.viewUser) openList(stat.dataset.list, state.viewUser, $('#user-actions').dataset.handle);
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-list]')) { e.preventDefault(); e.target.click(); }
});

// ---------- Followers / following lists ----------
let listSeq = 0;
async function renderPeopleList() {
  const seq = ++listSeq;
  const { type, userId, handle } = state.list || {};
  if (!type) return;
  const mine = userId === backend.me.id;
  $('#people-title').textContent = type === 'followers' ? 'Followers' : 'Following';
  $('#people-sub').textContent = mine
    ? (type === 'followers' ? 'People who can hear your followers-only memos.' : 'People whose memos show up on your Home.')
    : '@' + (handle || '');
  if (!$('#people-list').children.length || $('#people-list').dataset.key !== type + userId) {
    $('#people-list').innerHTML = '<li class="empty">Loading…</li>';
  }
  let people;
  try { people = type === 'followers' ? await backend.listFollowers(userId) : await backend.listFollowing(userId); }
  catch (e) { if (seq === listSeq) $('#people-list').innerHTML = `<li class="empty">${esc(friendlyError(e))}</li>`; return; }
  if (seq !== listSeq) return;
  $('#people-list').dataset.key = type + userId;
  people.forEach(p => {
    if (p.following) state.following.add(p.id);
    if (p.requested) state.requested.add(p.id);
  });
  const action = p => {
    if (p.id === backend.me.id) return '';
    if (mine && type === 'followers') return `<button class="follow-btn secondary" data-remove-follower="${esc(p.id)}" data-handle="${esc(p.handle)}">Remove</button>`;
    if (p.blocked) return `<button class="unblock-btn" data-unblock="${esc(p.id)}">Unblock</button>`;
    return followButtonHTML(p);
  };
  $('#people-list').innerHTML = people.length ? people.map(p => `
    <li class="person" data-handle="${esc(p.handle)}">
      ${avatarHTML(p, true)}
      <div class="memo-who" data-user="${esc(p.id)}">
        <div class="memo-name">${esc(p.name)}${p.id === backend.me.id ? ' (you)' : ''}</div>
        <div class="memo-meta">@${esc(p.handle)}</div>
      </div>
      ${action(p)}
    </li>`).join('') : `<li class="empty">${
      mine ? (type === 'followers' ? 'No followers yet. Approved follow requests show up here.' : 'You’re not following anyone yet. Find people in Search or Discover.')
        : (type === 'followers' ? 'No followers yet.' : 'Not following anyone yet.')}</li>`;
}

async function removeFollower(id, handle) {
  const ok = await chooseAction(
    `Remove @${handle} as a follower? They won’t be told, and they’ll need to ask again, and be approved, to hear your followers-only memos.`,
    [{ key: 'remove', label: 'Remove follower', danger: true }]);
  if (ok !== 'remove') return false;
  try {
    await backend.removeFollower(id);
    toast(`Removed @${handle}`);
    return true;
  } catch (e) { toast(friendlyError(e)); return false; }
}
$('#people-list').addEventListener('click', async e => {
  const rm = e.target.closest('[data-remove-follower]');
  if (rm) {
    if (await removeFollower(rm.dataset.removeFollower, rm.dataset.handle)) {
      rm.closest('li').remove();
      if (!$('#people-list li')) renderPeopleList();
    }
    return;
  }
  onPeopleClick(e);
});

let profileSeq = 0;
async function renderUserProfile() {
  const seq = ++profileSeq;
  const userId = state.viewUser;
  if (!userId) return;
  if (!$('#user-feed').dataset.uid || $('#user-feed').dataset.uid !== userId) {
    $('#user-name').textContent = '';
    $('#user-handle').textContent = '';
    $('#user-avatar').textContent = '';
    $('#user-bio').hidden = true;
    $('#user-link').hidden = true;
    $('#user-actions').innerHTML = '';
    $('#user-note').hidden = true;
    $('#user-feed').innerHTML = '<li class="empty">Loading…</li>';
    $('#user-tags').hidden = true;
    ['memos', 'followers', 'following'].forEach(k => { $('#user-stat-' + k).textContent = '–'; });
  }
  let prof;
  try { prof = await backend.getUserProfile(userId); }
  catch (e) {
    if (seq === profileSeq) $('#user-feed').innerHTML = `<li class="empty">${esc(friendlyError(e))}</li>`;
    return;
  }
  if (seq !== profileSeq || state.viewUser !== userId) return;
  const u = prof.user;
  // The profile comes with fresh follow status (they may have approved or declined).
  if (u.following) state.following.add(u.id); else state.following.delete(u.id);
  if (u.requested) state.requested.add(u.id); else state.requested.delete(u.id);
  $('#user-feed').dataset.uid = userId;
  paintAvatar($('#user-avatar'), u);
  paintBioAndLink($('#user-bio'), $('#user-link'), u);
  $('#user-name').textContent = u.name;
  $('#user-handle').textContent = '@' + u.handle;
  state.profileMemos = prof.memos;
  $('#user-stat-memos').textContent = fmtCount(prof.memos.filter(m => m.audience !== 'close').length);
  $('#user-stat-followers').textContent = fmtCount(prof.followers);
  $('#user-stat-following').textContent = fmtCount(prof.following);
  $('#user-actions').dataset.handle = u.handle;
  $('#user-actions').dataset.followsMe = String(!!u.followsMe);
  $('#user-actions').innerHTML = (u.blocked
    ? `<button class="unblock-btn" data-unblock="${esc(u.id)}">Unblock</button>`
    : followButtonHTML(u))
    + `<button class="more-btn" id="user-more" aria-label="More options for @${esc(u.handle)}">${ICON_MORE}</button>`;
  const note = u.blocked ? `You blocked @${u.handle}.`
    : u.following ? ''
    : u.requested ? `Request sent. Once @${u.handle} approves, you’ll hear their followers-only memos too.`
    : `You can hear @${u.handle}’s public memos. Follow to ask for their followers-only memos; they’ll need to approve.`;
  $('#user-note').textContent = note;
  $('#user-note').hidden = !note;
  state.profileEmpty = u.blocked ? 'Unblock to see their memos.' : `No memos you can hear from @${esc(u.handle)} yet.`;
  paintUserFeed();
}
function paintUserFeed() {
  const memos = sorted(state.profileMemos);
  state.userTag = renderTagFilter($('#user-tags'), memos, state.userTag);
  renderList($('#user-feed'), withTag(memos, state.userTag), state.profileEmpty);
}
$('#user-tags').addEventListener('click', e => {
  const b = e.target.closest('[data-tag-filter]');
  if (!b) return;
  state.userTag = b.dataset.tagFilter || null;
  paintUserFeed();
});
$('#my-tags').addEventListener('click', e => {
  const b = e.target.closest('[data-tag-filter]');
  if (!b) return;
  state.myTag = b.dataset.tagFilter || null;
  renderProfile();
});
// Tapping a tag on a memo shows that person's memos with the same tag.
function openTag(userId, key) {
  if (userId === backend.me.id) {
    state.myTag = key;
    state.screen = 'profile';
    render();
    $('#my-tags').scrollIntoView({ block: 'start', behavior: 'smooth' });
    return;
  }
  if (state.screen === 'user' && state.viewUser === userId) {
    state.userTag = key;
    paintUserFeed();
    $('#user-tags').scrollIntoView({ block: 'start', behavior: 'smooth' });
    return;
  }
  navigate({ screen: 'user', viewUser: userId, userTag: key });
}
$('#user-actions').addEventListener('click', async e => {
  if (e.target.closest('[data-follow], [data-unblock]')) { onPeopleClick(e); return; }
  if (!e.target.closest('#user-more')) return;
  const prof = { id: state.viewUser, handle: $('#user-actions').dataset.handle };
  const blockedNow = !!$('#user-actions [data-unblock]');
  const followsMe = $('#user-actions').dataset.followsMe === 'true';
  const key = await chooseAction(`@${prof.handle}`, [
    ...(followsMe ? [{ key: 'remove', label: 'Remove follower', danger: true }] : []),
    { key: 'report', label: `Report @${prof.handle}`, danger: true },
    blockedNow ? { key: 'unblock', label: `Unblock @${prof.handle}` } : { key: 'block', label: `Block @${prof.handle}`, danger: true },
  ]);
  if (key === 'report') reportFlow({ type: 'user', targetId: prof.id, targetAuthorId: prof.id, memoId: '', text: '', author: prof });
  if (key === 'block') { await blockUser(prof); renderUserProfile(); }
  if (key === 'remove' && await removeFollower(prof.id, prof.handle)) renderUserProfile();
  if (key === 'unblock') {
    try { await backend.unblock(prof.id); toast('Unblocked'); renderUserProfile(); refreshFeed(); }
    catch (err) { toast(friendlyError(err)); }
  }
});

// ---------- Follow requests ----------
const requestsSheet = $('#requests-sheet');
function paintRequestBadge() {
  const n = state.requests.length;
  $('#tab-badge').hidden = !n;
  $('#requests-count').hidden = !n;
  $('#requests-count').textContent = n;
}
async function loadRequests() {
  try { state.requests = await backend.listFollowRequests(); }
  catch (e) { console.warn('Could not load follow requests', e); }
  paintRequestBadge();
}
function renderRequests() {
  $('#request-list').innerHTML = state.requests.length ? state.requests.map(r => `
    <li class="person">
      ${avatarHTML(r.user, true)}
      <div class="memo-who" data-user="${esc(r.user.id)}">
        <div class="memo-name">${esc(r.user.name)}</div>
        <div class="memo-meta">@${esc(r.user.handle)} · ${timeAgo(r.createdAt)}</div>
      </div>
      <div class="request-actions">
        <button class="follow-btn" data-approve="${esc(r.user.id)}">Approve</button>
        <button class="follow-btn secondary" data-decline="${esc(r.user.id)}">Decline</button>
      </div>
    </li>`).join('') : '<li class="empty">No follow requests right now.</li>';
}
async function openRequests() {
  requestsSheet.hidden = false;
  backdrop.hidden = false;
  renderRequests();
  await loadRequests();
  if (!requestsSheet.hidden) renderRequests();
}
function closeRequests() {
  requestsSheet.hidden = true;
  backdrop.hidden = true;
  render();
}
$('#requests-open').addEventListener('click', openRequests);
$('#requests-done').addEventListener('click', closeRequests);
$('#request-list').addEventListener('click', async e => {
  const approve = e.target.closest('[data-approve]');
  const decline = e.target.closest('[data-decline]');
  const btn = approve || decline;
  if (!btn) return;
  const id = btn.dataset.approve || btn.dataset.decline;
  const r = state.requests.find(x => x.user.id === id);
  btn.closest('.request-actions').querySelectorAll('button').forEach(b => { b.disabled = true; });
  try {
    if (approve) await backend.approveRequest(id); else await backend.declineRequest(id);
    state.requests = state.requests.filter(x => x.user.id !== id);
    renderRequests();
    paintRequestBadge();
    toast(approve ? `@${r.user.handle} can now hear your followers-only memos` : 'Request declined');
  } catch (err) {
    toast(friendlyError(err));
    btn.closest('.request-actions').querySelectorAll('button').forEach(b => { b.disabled = false; });
  }
});

// ---------- Pull to refresh ----------
// Drag down from the top of a screen and let go to reload what's on it.
const ptr = { el: $('#ptr'), startY: null, pull: 0, busy: false };
const PTR_TRIGGER = 64;
function ptrSet(pull) {
  ptr.pull = pull;
  ptr.el.style.setProperty('--pull', pull + 'px');
  ptr.el.classList.toggle('is-pulling', pull > 4);
  $('#ptr-text').textContent = pull >= PTR_TRIGGER ? 'Release to refresh' : 'Pull to refresh';
}
async function refreshCurrentScreen() {
  const jobs = [refreshFeed()];
  if (state.screen === 'user') jobs.push(renderUserProfile());
  if (state.screen === 'people') jobs.push(renderPeopleList());
  if (state.screen === 'search') jobs.push(renderSearch());
  await Promise.allSettled(jobs);
  if (state.screen === 'profile') renderProfile();
}
const screensRoot = document.querySelector('.screens');
screensRoot.addEventListener('touchstart', e => {
  const scr = e.target.closest('.screen');
  if (ptr.busy || !scr || scr.scrollTop > 0 || e.touches.length !== 1) { ptr.startY = null; return; }
  ptr.startY = e.touches[0].clientY;
  ptr.el.classList.remove('is-settling');
}, { passive: true });
screensRoot.addEventListener('touchmove', e => {
  if (ptr.startY == null) return;
  const scr = e.target.closest('.screen');
  const dy = e.touches[0].clientY - ptr.startY;
  if (dy <= 0 || (scr && scr.scrollTop > 0)) { ptrSet(0); return; }
  e.preventDefault(); // keep the page still while pulling
  ptrSet(Math.min(110, dy * 0.5));
}, { passive: false });
screensRoot.addEventListener('touchend', async () => {
  if (ptr.startY == null) return;
  ptr.startY = null;
  ptr.el.classList.add('is-settling');
  if (ptr.pull < PTR_TRIGGER) { ptrSet(0); return; }
  ptr.busy = true;
  ptr.el.classList.add('is-refreshing');
  ptrSet(56);
  $('#ptr-text').textContent = 'Refreshing…';
  await refreshCurrentScreen();
  ptr.el.classList.remove('is-refreshing');
  ptrSet(0);
  ptr.busy = false;
});
screensRoot.addEventListener('touchcancel', () => { ptr.startY = null; ptr.el.classList.add('is-settling'); ptrSet(0); });

// ---------- Edit profile ----------
const editSheet = $('#edit-sheet');
const edit = { photoBlob: null, removePhoto: false, previewUrl: null };

// Crop to a centered square and shrink to 400×400 JPEG before uploading.
function squareJpeg(file, size = 400) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(img,
        (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not read that image.'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t an image we can use. Try a JPEG or PNG.')); };
    img.src = url;
  });
}
function paintEditAvatar() {
  const me = backend.me;
  const shown = edit.previewUrl ? { ...me, photoURL: edit.previewUrl }
    : edit.removePhoto ? { ...me, photoURL: '' } : me;
  paintAvatar($('#edit-avatar'), shown);
  $('#edit-photo-remove').hidden = !shown.photoURL;
}
function syncBioCount() {
  $('#edit-bio-count').textContent = `${$('#edit-bio').value.length}/120`;
}
function openEditProfile() {
  const me = backend.me;
  if (edit.previewUrl) URL.revokeObjectURL(edit.previewUrl);
  Object.assign(edit, { photoBlob: null, removePhoto: false, previewUrl: null });
  $('#edit-name').value = me.name || '';
  $('#edit-bio').value = me.bio || '';
  $('#edit-link').value = me.link || '';
  $('#edit-error').hidden = true;
  $('#edit-photo-input').value = '';
  syncBioCount();
  paintEditAvatar();
  editSheet.hidden = false;
  backdrop.hidden = false;
}
function closeEditProfile() {
  editSheet.hidden = true;
  backdrop.hidden = true;
}
function editError(msg) {
  $('#edit-error').textContent = msg;
  $('#edit-error').hidden = false;
}
// Accepts "mysite.com" and adds https:// so links always open correctly.
function normalizeLink(raw) {
  const v = raw.trim();
  if (!v) return '';
  const withScheme = /^https?:\/\//i.test(v) ? v : 'https://' + v;
  try {
    const u = new URL(withScheme);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
    return u.href.length <= 200 ? u.href : null;
  } catch (e) { return null; }
}
$('#edit-profile').addEventListener('click', openEditProfile);
$('#edit-cancel').addEventListener('click', closeEditProfile);
$('#edit-bio').addEventListener('input', syncBioCount);
$('#edit-photo-input').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    edit.photoBlob = await squareJpeg(file);
    edit.removePhoto = false;
    if (edit.previewUrl) URL.revokeObjectURL(edit.previewUrl);
    edit.previewUrl = URL.createObjectURL(edit.photoBlob);
    $('#edit-error').hidden = true;
    paintEditAvatar();
  } catch (err) { editError(err.message); }
});
$('#edit-photo-remove').addEventListener('click', () => {
  if (edit.previewUrl) URL.revokeObjectURL(edit.previewUrl);
  Object.assign(edit, { photoBlob: null, removePhoto: true, previewUrl: null });
  $('#edit-photo-input').value = '';
  paintEditAvatar();
});
async function saveProfile() {
  const name = $('#edit-name').value.trim();
  const bio = $('#edit-bio').value.trim();
  const link = normalizeLink($('#edit-link').value);
  if (!name) return editError('Enter your name.');
  if (bio.length > 120) return editError('Keep your bio to 120 characters.');
  if (link === null) return editError('That link doesn’t look right. Try something like https://yourwebsite.com');
  const btn = $('#edit-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    await backend.updateProfile({ name, bio, link, photoBlob: edit.photoBlob, removePhoto: edit.removePhoto });
    closeEditProfile();
    render();
    toast('Profile updated');
  } catch (err) {
    console.error(err);
    editError(friendlyError(err));
  }
  btn.disabled = false;
  btn.textContent = 'Save';
}
$('#edit-save').addEventListener('click', saveProfile);
$('#edit-form').addEventListener('submit', e => { e.preventDefault(); saveProfile(); });

// ---------- Account ----------
const deleteSheet = $('#delete-sheet');
function openDeleteSheet() {
  $('#delete-password').value = '';
  $('#delete-error').hidden = true;
  deleteSheet.hidden = false;
  backdrop.hidden = false;
  $('#delete-password').focus();
}
function closeDeleteSheet() {
  deleteSheet.hidden = true;
  backdrop.hidden = true;
}
$('#delete-open').addEventListener('click', openDeleteSheet);
$('#delete-cancel').addEventListener('click', closeDeleteSheet);
$('#delete-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#delete-submit');
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  try {
    await backend.deleteAccount($('#delete-password').value);
    closeDeleteSheet();
    toast('Your account was deleted');
  } catch (err) {
    console.error(err);
    $('#delete-error').textContent = friendlyError(err);
    $('#delete-error').hidden = false;
  }
  btn.disabled = false;
  btn.textContent = 'Delete my account';
});
$('#sign-out').addEventListener('click', () => {
  stopPlayback();
  backend.signOut();
});

// ---------- Sign in ----------
const auth = $('#auth');
const authForm = $('#auth-form');
const AUTH_COPY = {
  signin: { submit: 'Sign in' },
  signup: { submit: 'Create account' },
  reset: { submit: 'Send reset link', hint: 'Enter your email and we’ll send you a link to reset your password.' },
  profile: { submit: 'Continue', hint: 'Pick the name and @handle people will see.' },
};
function setAuthMode(mode) {
  auth.dataset.mode = mode;
  authForm.querySelectorAll('[data-for]').forEach(el => {
    el.hidden = !el.dataset.for.split(' ').includes(mode);
  });
  $('#tab-signin').setAttribute('aria-selected', String(mode === 'signin'));
  $('#tab-signup').setAttribute('aria-selected', String(mode === 'signup'));
  $('#auth-password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('#auth-submit').textContent = AUTH_COPY[mode].submit;
  $('#auth-hint').textContent = AUTH_COPY[mode].hint || '';
  $('#auth-hint').hidden = !AUTH_COPY[mode].hint;
  $('#auth-error').hidden = true;
}
function authError(msg) {
  $('#auth-error').textContent = msg;
  $('#auth-error').hidden = false;
}
function showAuth(mode) {
  stopPlayback();
  setAuthMode(mode);
  auth.hidden = false;
}
$('#auth-tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]');
  if (b) setAuthMode(b.dataset.mode);
});
$('#auth-forgot').addEventListener('click', () => setAuthMode('reset'));
$('#auth-back').addEventListener('click', () => setAuthMode('signin'));
$('#auth-signout').addEventListener('click', () => backend.signOut());
$('#auth-handle').addEventListener('input', e => {
  e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
});
authForm.addEventListener('submit', async e => {
  e.preventDefault();
  const mode = auth.dataset.mode;
  const v = id => $(id).value;
  const btn = $('#auth-submit');
  btn.disabled = true;
  $('#auth-error').hidden = true;
  try {
    if (mode === 'signin') await backend.signIn(v('#auth-email'), v('#auth-password'));
    if (mode === 'signup') {
      if (!v('#auth-name').trim()) throw new Error('Enter your name.');
      await backend.signUp({ email: v('#auth-email'), password: v('#auth-password'), name: v('#auth-name'), handle: v('#auth-handle') });
      onSignedIn();
    }
    if (mode === 'profile') {
      await backend.createProfile({ name: v('#auth-name'), handle: v('#auth-handle') });
      onSignedIn();
    }
    if (mode === 'reset') {
      await backend.resetPassword(v('#auth-email'));
      setAuthMode('signin');
      toast('Check your email for a reset link');
    }
  } catch (err) {
    console.error(err);
    // The account was made but the profile wasn't (say, the handle was just taken):
    // finish on the profile step instead of trying to sign up again.
    if (mode === 'signup' && backend.signedIn && !backend.me) setAuthMode('profile');
    authError(friendlyError(err));
    // The account exists but the handle step failed: finish it on the profile step.
    if (mode === 'signup' && backend.me == null && backend.signedIn) setAuthMode('profile');
  }
  btn.disabled = false;
});

// ---------- Feed loading ----------
let feedSeq = 0;
async function refreshFeed() {
  if (!backend.me) return;
  const seq = ++feedSeq;
  try {
    const following = await backend.getFollowing();
    state.requested = await backend.getRequested();
    loadRequests();
    const [memos, signals] = await Promise.all([
      backend.loadFeed(),
      backend.discoverSignals().catch(e => { console.warn('Discover signals unavailable', e); return null; }),
    ]);
    if (seq !== feedSeq) return;
    state.following = following;
    state.memos = memos;
    state.signals = signals;
  } catch (e) {
    console.error(e);
    if (seq === feedSeq) toast(friendlyError(e));
  }
  state.loading = false;
  if (sheet.hidden && cfSheet.hidden && commentsSheet.hidden && !['user', 'people'].includes(state.screen)) render();
}

function onSignedIn() {
  if (!backend.me) return;
  auth.hidden = true;
  state.screen = 'home';
  state.filter = null;
  state.loading = true;
  state.memos = [];
  urlCache.clear();
  render();
  backend.getCloseFriends().then(ids => { state.closeCount = ids.size; }).catch(() => {});
  listening.sync()
    .then(changed => { if (changed && !state.loading && sheet.hidden && ['home', 'discover'].includes(state.screen)) render(); })
    .catch(e => console.warn('Couldn’t load listened memos', e));
  refreshFeed();
}

// ---------- Boot ----------
const EMULATOR_CONFIG = {
  apiKey: 'demo-key', authDomain: 'demo-gopherturtle.firebaseapp.com', projectId: 'demo-gopherturtle',
  storageBucket: 'demo-gopherturtle.appspot.com', appId: 'demo-app',
};
// The loading screen stays up until the app is connected and knows who you are,
// so nothing (like Post) can be used before it's ready.
const bootScreen = $('#boot');
function bootMessage(text, retry) {
  $('#boot-text').textContent = text;
  $('#boot-retry').hidden = !retry;
}
$('#boot-retry').addEventListener('click', () => location.reload());

async function boot() {
  // Add ?emulators to the URL to use the local Firebase emulators (npm run emulators).
  const emulators = /[?&]emulators\b/.test(location.search);
  // The emulators always use a separate demo project, never your real one.
  const config = emulators ? EMULATOR_CONFIG : firebaseConfig;
  const slow = setTimeout(() => bootMessage('Still loading… This is taking longer than usual. Check your connection.', true), 12000);
  if (config) {
    try {
      const mod = await import('./backend-firebase.js');
      friendlyError = mod.friendlyError;
      backend = mod.createFirebaseBackend(config, { emulators });
    } catch (e) {
      // With real accounts configured, never fall back to demo mode: say what happened instead.
      console.error('TwoCents could not connect', e);
      clearTimeout(slow);
      bootMessage('TwoCents couldn’t load. Check your internet connection (and any content blocker), then try again.', true);
      return;
    }
  } else {
    backend = createDemoBackend();
  }
  app.dataset.mode = backend.mode;

  backend.init(user => {
    clearTimeout(slow);
    bootScreen.hidden = true;
    if (!user) { showAuth('signin'); return; }
    if (user.needsProfile) { showAuth('profile'); return; }
    if (user.error) { showAuth('signin'); authError(user.error); return; }
    onSignedIn();
  });
}
boot();

// Refresh the "5m ago" labels once a minute.
setInterval(() => {
  if (!backend || !backend.me || !sheet.hidden || !cfSheet.hidden || !speedMenu.hidden) return;
  if (state.screen === 'home') renderHome();
  if (state.screen === 'discover') renderDiscover();
}, 60 * 1000);
