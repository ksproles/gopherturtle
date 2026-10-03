/* Gopher Turtle — scrollable voice memos.
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
  rate: SPEEDS.includes(prefs.get('rate', 1)) ? prefs.get('rate', 1) : 1,
};

// ---------- Elements ----------
const $ = sel => document.querySelector(sel);
const app = $('#app');
const feedEl = $('#feed');
const discoverEl = $('#discover-feed');
// Home shows close friends + following; global memos live on Discover.
const HOME_AUDIENCES = ['close', 'followers'];
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

function memoHTML(m) {
  const u = m.author;
  const mine = m.userId === backend.me.id;
  const aud = AUDIENCES[m.audience];
  const bars = m.peaks.map(p => `<i style="height:${Math.round(12 + p * 88)}%"></i>`).join('');
  return `
    <li class="memo" data-aud="${m.audience}" data-id="${m.id}">
      <div class="memo-head">
        <div class="avatar" style="--av:${u.color}">${esc(initials(u.name))}</div>
        <div class="memo-who">
          <div class="memo-name">${esc(u.name)}</div>
          <div class="memo-meta">@${esc(u.handle)} · ${timeAgo(m.createdAt)}</div>
        </div>
        <span class="aud-badge">${aud.label}</span>
      </div>
      ${m.caption ? `<p class="memo-caption">${esc(filterText(m.caption))}</p>` : ''}
      <div class="player">
        <button class="play-btn" data-act="play" aria-label="Play memo from ${esc(u.name)}. Press and hold for playback speed.">${ICON_PLAY}</button>
        <div class="wave" data-act="seek" role="presentation">${bars}</div>
        ${state.rate !== 1 ? `<span class="speed-tag">${state.rate}×</span>` : ''}
        <span class="dur">${fmtDur(m.duration)}</span>
      </div>
      <div class="memo-actions">
        <button class="act ${m.liked ? 'liked' : ''}" data-act="like" aria-pressed="${m.liked}" aria-label="Like">
          <svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>
          <span>${fmtCount(m.likes)}</span>
        </button>
        <button class="act" data-act="comments" aria-label="Comments">
          <svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>
          <span>${fmtCount(m.comments || 0)}</span>
        </button>
        ${mine ? `<button class="act act-delete" data-act="delete" aria-label="Delete this memo">
          <svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
          <span>Delete</span>
        </button>` : `<button class="more-btn" data-act="more" aria-label="More options for this memo">${ICON_MORE}</button>`}
      </div>
    </li>`;
}

function renderList(el, memos, emptyText) {
  el.innerHTML = memos.length
    ? memos.map(memoHTML).join('')
    : `<li class="empty">${emptyText}</li>`;
  if (player.memo) markPlaying(player.memo.id, true);
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
  const list = sorted(state.memos.filter(m =>
    HOME_AUDIENCES.includes(m.audience) && (!state.filter || m.audience === state.filter)));
  feedLabel.textContent = state.filter
    ? `${AUDIENCES[state.filter].feedLabel} · newest first`
    : 'Close friends and following, newest first';
  renderList(feedEl, list, state.filter
    ? `No ${AUDIENCES[state.filter].feedLabel.toLowerCase()} memos yet.`
    : 'No memos from close friends or people you follow yet. Find people in Search, or check out Discover.');
  document.querySelectorAll('.chip').forEach(c =>
    c.setAttribute('aria-pressed', String(c.dataset.filter === state.filter)));
}

function renderDiscover() {
  if (state.loading && !state.memos.length) {
    discoverEl.innerHTML = '<li class="empty">Loading memos…</li>';
    return;
  }
  renderList(discoverEl, sorted(state.memos.filter(m => m.audience === 'global')),
    'No global memos yet. Post one with the audience set to Global.');
}

let searchSeq = 0;
async function renderSearch() {
  const seq = ++searchSeq;
  const q = state.query.trim().toLowerCase();
  let people = [];
  try { people = await backend.searchPeople(q); }
  catch (e) { toast(friendlyError(e)); }
  if (seq !== searchSeq) return;
  $('#people').innerHTML = people.length ? people.map(p => `
    <li class="person" data-uid="${esc(p.id)}">
      <div class="avatar" style="--av:${esc(p.color)}">${esc(initials(p.name))}</div>
      <div class="memo-who">
        <div class="memo-name">${esc(p.name)}</div>
        <div class="memo-meta">@${esc(p.handle)}${p.close ? ' · <span class="cf-tag">Close friend</span>' : ''}</div>
      </div>
      ${p.blocked
        ? `<button class="unblock-btn" data-unblock="${esc(p.id)}">Unblock</button>`
        : `<button class="follow-btn" data-follow="${esc(p.id)}" aria-pressed="${p.following}">${p.following ? 'Following' : 'Follow'}</button>`}
    </li>`).join('') : `<li class="empty">${q ? 'No people match.' : 'No one else is here yet.'}</li>`;

  const memos = sorted(state.memos.filter(m => {
    if (!q) return false;
    const u = m.author;
    return (m.caption || '').toLowerCase().includes(q) || u.name.toLowerCase().includes(q) || u.handle.includes(q);
  }));
  renderList($('#search-results'), memos, q ? `No memos match “${esc(state.query)}”.` : 'Type to search memo captions.');
}

function renderProfile() {
  const me = backend.me;
  $('#profile-avatar').style.setProperty('--av', me.color);
  $('#profile-avatar').textContent = initials(me.name);
  $('#profile-name').textContent = me.name;
  $('#profile-handle').textContent = '@' + me.handle;
  // Your profile is what other people see, so close friends memos stay off it.
  const mine = sorted(state.memos.filter(m => m.userId === me.id && m.audience !== 'close'));
  $('#stat-memos').textContent = mine.length;
  $('#cf-count').textContent = `${state.closeCount} ${state.closeCount === 1 ? 'person' : 'people'}`;
  renderList($('#my-feed'), mine, 'Memos you post to followers or Global show up here.');
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

function render() {
  app.dataset.screen = state.screen;
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== 'screen-' + state.screen; });
  document.querySelectorAll('.tab[data-screen]').forEach(t =>
    t.classList.toggle('is-active', t.dataset.screen === state.screen));
  if (state.screen === 'home') renderHome();
  if (state.screen === 'discover') renderDiscover();
  if (state.screen === 'search') renderSearch();
  if (state.screen === 'profile') renderProfile();
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
    const m = state.memos.find(x => x.id === id);
    card.querySelector('.dur').textContent = frac > 0 && m
      ? fmtDur(m.duration * (1 - frac) / state.rate)
      : fmtDur(m ? m.duration : 0);
  });
}
function tick() {
  if (!player.memo) return;
  const d = audio.duration && isFinite(audio.duration) ? audio.duration : player.memo.duration;
  paintProgress(player.memo.id, Math.min(1, audio.currentTime / d));
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
    audio.src = await sourceFor(m);
    if (player.memo !== m) return;
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
    toast('Couldn’t play this memo.');
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
  const m = player.memo;
  stopPlayback();
  // Keep scrolling hands-free: play the next memo in the visible feed.
  const listEl = { home: feedEl, discover: discoverEl }[state.screen];
  if (m && listEl) {
    const card = listEl.querySelector(`.memo[data-id="${CSS.escape(m.id)}"]`);
    const next = card && card.nextElementSibling;
    if (next && next.dataset.id) {
      next.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const nm = state.memos.find(x => x.id === next.dataset.id);
      if (nm) togglePlay(nm);
    }
  }
});
audio.addEventListener('pause', () => player.memo && markPlaying(player.memo.id, true));

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
  if (e && e.name === 'NotAllowedError') return 'Gopher Turtle needs your microphone. Allow microphone access in your browser or phone settings, then tap record again.';
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

async function submitPost() {
  if (!rec.blob) return;
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
        <div class="avatar" style="--av:${esc(p.color)}">${esc(initials(p.name))}</div>
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
  const m = card && state.memos.find(x => x.id === card.dataset.id);
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
  if (act === 'delete') confirmDelete(btn, m);
  if (act === 'comments') openComments(m);
  if (act === 'more') memoMenu(m);
});

const paintLike = m => cardsFor(m.id).forEach(c => {
  const b = c.querySelector('[data-act="like"]');
  b.classList.toggle('liked', m.liked);
  b.setAttribute('aria-pressed', String(m.liked));
  b.querySelector('span').textContent = fmtCount(m.likes);
});
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

// First tap arms the button, second tap deletes.
async function confirmDelete(btn, m) {
  if (!btn.classList.contains('confirm')) {
    btn.classList.add('confirm');
    btn.querySelector('span').textContent = 'Tap again to delete';
    setTimeout(() => {
      if (!btn.isConnected) return;
      btn.classList.remove('confirm');
      btn.querySelector('span').textContent = 'Delete';
    }, 3000);
    return;
  }
  if (player.memo && player.memo.id === m.id) stopPlayback();
  try {
    await backend.deleteMemo(m);
    state.memos = state.memos.filter(x => x.id !== m.id);
    render();
    toast('Memo deleted');
  } catch (e) { toast(friendlyError(e)); }
}

// Follow / unfollow / unblock from search.
$('#people').addEventListener('click', async e => {
  const unblockBtn = e.target.closest('[data-unblock]');
  if (unblockBtn) {
    try {
      await backend.unblock(unblockBtn.dataset.unblock);
      toast('Unblocked');
      renderSearch();
      refreshFeed();
    } catch (err) { toast(friendlyError(err)); }
    return;
  }
  const btn = e.target.closest('[data-follow]');
  if (!btn) return;
  const id = btn.dataset.follow;
  const on = btn.getAttribute('aria-pressed') !== 'true';
  btn.disabled = true;
  try {
    if (on) await backend.follow(id); else await backend.unfollow(id);
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? 'Following' : 'Follow';
    refreshFeed();
  } catch (err) {
    toast(on && err && err.code === 'permission-denied' ? 'You can’t follow this account.' : friendlyError(err));
  }
  btn.disabled = false;
});

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
  else closeSheet();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!speedMenu.hidden) closeSpeedMenu();
  else if (!actionSheet.hidden) closeActions(null);
  else if (!commentsSheet.hidden) closeComments();
  else if (!blockedSheet.hidden) closeBlocked();
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
      <div class="avatar" style="--av:${esc(u.color)}">${esc(initials(u.name))}</div>
      <div class="comment-body">
        <div class="comment-meta"><b>${esc(u.name)}</b> · ${timeAgo(c.createdAt)}</div>
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
  cardsFor(m.id).forEach(c => { c.querySelector('[data-act="comments"] span').textContent = fmtCount(n); });
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
      <div class="avatar" style="--av:${esc(p.color)}">${esc(initials(p.name))}</div>
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
    const memos = await backend.loadFeed();
    if (seq !== feedSeq) return;
    state.memos = memos;
  } catch (e) {
    console.error(e);
    if (seq === feedSeq) toast(friendlyError(e));
  }
  state.loading = false;
  if (sheet.hidden && cfSheet.hidden && commentsSheet.hidden) render();
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
  refreshFeed();
}

// ---------- Boot ----------
const EMULATOR_CONFIG = {
  apiKey: 'demo-key', authDomain: 'demo-gopherturtle.firebaseapp.com', projectId: 'demo-gopherturtle',
  storageBucket: 'demo-gopherturtle.appspot.com', appId: 'demo-app',
};
async function boot() {
  // Add ?emulators to the URL to use the local Firebase emulators (npm run emulators).
  const emulators = /[?&]emulators\b/.test(location.search);
  // The emulators always use a separate demo project, never your real one.
const config = emulators ? EMULATOR_CONFIG : firebaseConfig;
  if (config) {
    try {
      const mod = await import('./backend-firebase.js');
      friendlyError = mod.friendlyError;
      backend = mod.createFirebaseBackend(config, { emulators });
    } catch (e) {
      console.error('Firebase failed to load, falling back to demo mode', e);
    }
  }
  if (!backend) backend = createDemoBackend();
  app.dataset.mode = backend.mode;

  backend.init(user => {
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
