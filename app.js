/* Gopher Turtle — scrollable voice memos.
 * Vanilla JS, no build step. Memos you record are kept in IndexedDB on this device.
 */
(() => {
  'use strict';

  // ---------- Constants ----------
  const AUDIENCES = {
    close: { label: 'Close friends', feedLabel: 'Close friends' },
    followers: { label: 'Followers only', feedLabel: 'Following' },
    global: { label: 'Global', feedLabel: 'Global' },
  };
  const MAX_SECONDS = 60;
  const BARS = 44;

  const ME = { id: 'me', name: 'You', handle: 'you', color: '#2f6b4f' };

  const PEOPLE = [
    { id: 'u1', name: 'Maya Ortiz', handle: 'mayasays', color: '#c2553a', rel: 'close' },
    { id: 'u2', name: 'Jonah Pike', handle: 'jonahp', color: '#3b6fb6', rel: 'close' },
    { id: 'u3', name: 'Priya Natarajan', handle: 'priyan', color: '#8a4fb0', rel: 'followers' },
    { id: 'u4', name: 'Theo Brandt', handle: 'theob', color: '#2f8a7a', rel: 'followers' },
    { id: 'u5', name: 'Ruth Achebe', handle: 'ruthreads', color: '#b5791f', rel: 'followers' },
    { id: 'u6', name: 'Field Notes Radio', handle: 'fieldnotes', color: '#4e6b2f', rel: null },
    { id: 'u7', name: 'Sam Okafor', handle: 'samokafor', color: '#a3456b', rel: null },
    { id: 'u8', name: 'Lena Fischer', handle: 'lenaf', color: '#5560b8', rel: null },
  ];
  const byId = Object.fromEntries([ME, ...PEOPLE].map(p => [p.id, p]));

  const MIN = 60 * 1000;
  const now = Date.now();
  // Example memos so the feed has something in it on first open.
  const SEED = [
    { user: 'u1', aud: 'close', ago: 4 * MIN, dur: 23, caption: 'ok you will NOT believe what happened at the farmers market', likes: 6, replies: 2 },
    { user: 'u6', aud: 'global', ago: 18 * MIN, dur: 48, caption: 'Dawn chorus from the marsh — three warblers and something we can’t ID. Help?', likes: 312, replies: 41 },
    { user: 'u3', aud: 'followers', ago: 41 * MIN, dur: 31, caption: 'Hot take: the second album is better', likes: 27, replies: 9 },
    { user: 'u2', aud: 'close', ago: 1.6 * 60 * MIN, dur: 12, caption: 'running 10 late, save me a seat', likes: 2, replies: 1 },
    { user: 'u7', aud: 'global', ago: 3 * 60 * MIN, dur: 56, caption: 'Day 40 of learning cello. Be gentle.', likes: 1204, replies: 188 },
    { user: 'u4', aud: 'followers', ago: 5 * 60 * MIN, dur: 19, caption: 'Quick update on the garden box build', likes: 14, replies: 3 },
    { user: 'u5', aud: 'followers', ago: 9 * 60 * MIN, dur: 38, caption: 'Reading the first page of the book club pick out loud', likes: 33, replies: 6 },
    { user: 'u8', aud: 'global', ago: 22 * 60 * MIN, dur: 27, caption: 'Street musician in Lisbon, had to share', likes: 589, replies: 24 },
    { user: 'u1', aud: 'close', ago: 26 * 60 * MIN, dur: 9, caption: 'goodnight turtles 🐢', likes: 8, replies: 0 },
  ].map((m, i) => ({
    id: 'seed-' + i,
    userId: m.user,
    audience: m.aud,
    createdAt: now - m.ago,
    duration: m.dur,
    caption: m.caption,
    likes: m.likes,
    replies: m.replies,
    liked: false,
    seed: i + 1,
    peaks: seededPeaks(i + 1),
  }));

  // ---------- State ----------
  const state = {
    memos: [...SEED],
    filter: null,      // null = everything, newest first
    screen: 'home',
    query: '',
  };

  // ---------- Elements ----------
  const $ = sel => document.querySelector(sel);
  const app = $('#app');
  const feedEl = $('#feed');
  const feedLabel = $('#feed-label');

  // ---------- Helpers ----------
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }
  function seededPeaks(seed) {
    const r = rng(seed * 7919);
    const out = [];
    let v = .4;
    for (let i = 0; i < BARS; i++) {
      v = Math.min(1, Math.max(.12, v + (r() - .5) * .55));
      out.push(+(v * (.6 + r() * .4)).toFixed(3));
    }
    return out;
  }
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
    return name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
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
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  // ---------- Storage (IndexedDB, best effort) ----------
  const db = (() => {
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
    };
  })();

  // ---------- Rendering ----------
  const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4.5" height="16" rx="1.2"/><rect x="13.5" y="4" width="4.5" height="16" rx="1.2"/></svg>';

  function memoHTML(m) {
    const u = byId[m.userId] || ME;
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
        ${m.caption ? `<p class="memo-caption">${esc(m.caption)}</p>` : ''}
        <div class="player">
          <button class="play-btn" data-act="play" aria-label="Play memo from ${esc(u.name)}">${ICON_PLAY}</button>
          <div class="wave" data-act="seek" role="presentation">${bars}</div>
          <span class="dur">${fmtDur(m.duration)}</span>
        </div>
        <div class="memo-actions">
          <button class="act ${m.liked ? 'liked' : ''}" data-act="like" aria-pressed="${m.liked}" aria-label="Like">
            <svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>
            <span>${fmtCount(m.likes)}</span>
          </button>
          <button class="act" data-act="reply" aria-label="Reply with a voice memo">
            <svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>
            <span>${fmtCount(m.replies)}</span>
          </button>
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
    const list = sorted(state.memos.filter(m => !state.filter || m.audience === state.filter));
    feedLabel.textContent = state.filter
      ? `${AUDIENCES[state.filter].feedLabel} · newest first`
      : 'Everything, newest first';
    renderList(feedEl, list, state.filter
      ? `No ${AUDIENCES[state.filter].feedLabel.toLowerCase()} memos yet.`
      : 'No memos yet. Tap Post to record the first one.');
    document.querySelectorAll('.chip').forEach(c =>
      c.setAttribute('aria-pressed', String(c.dataset.filter === state.filter)));
  }

  function renderSearch() {
    const q = state.query.trim().toLowerCase();
    const people = PEOPLE.filter(p => !q || p.name.toLowerCase().includes(q) || p.handle.includes(q));
    $('#people').innerHTML = people.length ? people.map(p => `
      <li class="person">
        <div class="avatar" style="--av:${p.color}">${esc(initials(p.name))}</div>
        <div class="memo-who">
          <div class="memo-name">${esc(p.name)}</div>
          <div class="memo-meta">@${esc(p.handle)}</div>
        </div>
        ${p.rel
          ? `<span class="rel" data-aud="${p.rel}">${p.rel === 'close' ? 'Close friend' : 'Following'}</span>`
          : `<span class="rel none">Not following</span>`}
      </li>`).join('') : '<li class="empty">No people match.</li>';

    const memos = sorted(state.memos.filter(m => {
      if (!q) return m.audience === 'global';
      const u = byId[m.userId] || ME;
      return (m.caption || '').toLowerCase().includes(q) || u.name.toLowerCase().includes(q) || u.handle.includes(q);
    }));
    renderList($('#search-results'), memos, q ? `Nothing matches “${esc(state.query)}”.` : 'No global memos yet.');
  }

  function renderProfile() {
    $('#profile-avatar').style.setProperty('--av', ME.color);
    $('#profile-avatar').textContent = initials(ME.name);
    $('#profile-name').textContent = ME.name;
    $('#profile-handle').textContent = '@' + ME.handle;
    const mine = sorted(state.memos.filter(m => m.userId === ME.id));
    $('#stat-memos').textContent = mine.length;
    renderList($('#my-feed'), mine, 'You haven’t posted yet. Tap Post to record your first memo.');
  }

  function render() {
    app.dataset.screen = state.screen;
    document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== 'screen-' + state.screen; });
    document.querySelectorAll('.tab[data-screen]').forEach(t =>
      t.classList.toggle('is-active', t.dataset.screen === state.screen));
    if (state.screen === 'home') renderHome();
    if (state.screen === 'search') renderSearch();
    if (state.screen === 'profile') renderProfile();
  }

  // ---------- Playback ----------
  const audio = new Audio();
  audio.preload = 'auto';
  const urlCache = new Map();
  const player = { memo: null, raf: 0 };

  async function sourceFor(m) {
    if (urlCache.has(m.id)) return urlCache.get(m.id);
    let blob = m.blob;
    if (!blob) blob = await synthMemo(m.seed || 1, m.duration);
    const url = URL.createObjectURL(blob);
    urlCache.set(m.id, url);
    return url;
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
        ? fmtDur(m.duration * (1 - frac))
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
    if (m && state.screen === 'home') {
      const card = feedEl.querySelector(`.memo[data-id="${CSS.escape(m.id)}"]`);
      const next = card && card.nextElementSibling;
      if (next && next.dataset.id) {
        next.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const nm = state.memos.find(x => x.id === next.dataset.id);
        if (nm) togglePlay(nm);
      }
    }
  });
  audio.addEventListener('pause', () => player.memo && markPlaying(player.memo.id, true));

  // Babble-like placeholder audio for the example memos, rendered offline to a WAV blob.
  async function synthMemo(seed, seconds) {
    const rate = 22050;
    const len = Math.ceil(rate * seconds);
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const r = rng(seed * 104729);
    let buf;
    if (Ctx) {
      const ctx = new Ctx(1, len, rate);
      const out = ctx.createGain();
      out.gain.value = .5;
      out.connect(ctx.destination);
      const base = 110 + r() * 110;
      let t = .15;
      while (t < seconds - .2) {
        const syll = .08 + r() * .18;
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const f = base * (.85 + r() * .4);
        osc.frequency.setValueAtTime(f, t);
        osc.frequency.linearRampToValueAtTime(f * (.9 + r() * .2), t + syll);
        const formant = ctx.createBiquadFilter();
        formant.type = 'bandpass';
        formant.frequency.value = 500 + r() * 1800;
        formant.Q.value = 4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(.6, t + .02);
        g.gain.linearRampToValueAtTime(0, t + syll);
        osc.connect(formant).connect(g).connect(out);
        osc.start(t);
        osc.stop(t + syll + .02);
        t += syll + (r() < .15 ? .35 + r() * .4 : .02 + r() * .06);
      }
      buf = (await ctx.startRendering()).getChannelData(0);
    } else {
      buf = new Float32Array(len);
    }
    return wavBlob(buf, rate);
  }

  function wavBlob(samples, rate) {
    const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
    const w = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE');
    w(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    w(36, 'data'); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([view], { type: 'audio/wav' });
  }

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

  async function startRecording() {
    resetRecorder();
    rec.demo = false;
    try {
      if (!navigator.mediaDevices || !window.MediaRecorder) throw new Error('unsupported');
      rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
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
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg']
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
    const memo = {
      id: 'me-' + Date.now(),
      userId: ME.id,
      audience: selectedAudience(),
      createdAt: Date.now(),
      duration: rec.duration,
      caption: $('#caption').value.trim(),
      likes: 0,
      replies: 0,
      liked: false,
      peaks: downsample(rec.levels, BARS),
      blob: rec.blob,
    };
    state.memos.push(memo);
    db.put(memo);
    closeSheet();
    state.screen = 'home';
    state.filter = null;
    render();
    feedEl.closest('.screen').scrollTo({ top: 0, behavior: 'smooth' });
    toast('Posted to ' + AUDIENCES[memo.audience].label.toLowerCase());
  }

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
    if (tab.dataset.screen === state.screen && state.screen === 'home') {
      feedEl.closest('.screen').scrollTo({ top: 0, behavior: 'smooth' });
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
    if (act === 'play') togglePlay(m);
    if (act === 'seek') {
      const rect = btn.getBoundingClientRect();
      togglePlay(m, Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
    }
    if (act === 'like') {
      m.liked = !m.liked;
      m.likes += m.liked ? 1 : -1;
      cardsFor(m.id).forEach(c => {
        const b = c.querySelector('[data-act="like"]');
        b.classList.toggle('liked', m.liked);
        b.setAttribute('aria-pressed', String(m.liked));
        b.querySelector('span').textContent = fmtCount(m.likes);
      });
      if (m.userId === ME.id) db.put(m);
    }
    if (act === 'reply') openSheet();
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
  backdrop.addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

  // ---------- Boot ----------
  render();
  db.all().then(saved => {
    if (!saved || !saved.length) return;
    const known = new Set(state.memos.map(m => m.id));
    saved.forEach(m => { if (!known.has(m.id)) state.memos.push(m); });
    render();
  });
  // Refresh the "5m ago" labels once a minute.
  setInterval(() => { if (!sheet.hidden) return; render(); }, 60 * 1000);
})();
