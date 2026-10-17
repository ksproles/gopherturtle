/* cc me — find the remote workers around you today.
 * Vanilla JS modules, no build step. Data comes from a backend (demo for now:
 * example people, everything stored on this device).
 */
import { STATUSES, STATUS_ORDER, SPOTS, OPEN_TO, CITIES, cityKey, cityName } from './constants.js';
import { createDemoBackend } from './backend-demo.js';
import { discord } from './discord-config.js';

const backend = createDemoBackend();
const me = backend.me;

const state = {
  tab: 'today',
  people: [],
  waves: [],
  editingCheckin: false,
  editingProfile: false,
  cityFilter: null,     // city key on People; '' = everywhere; null = follow your city today
  statusFilter: null,   // null = all statuses
  draftStatus: null,    // status being picked in the check-in form
  draftSpot: '',
};

// ---------- Helpers ----------
const $ = sel => document.querySelector(sel);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
function avatar(p, size = '') {
  return `<span class="avatar ${size}" style="--c:${esc(p.color)}" aria-hidden="true">${esc(initials(p.name))}</span>`;
}
function statusPill(status, long = false) {
  const s = STATUSES[status] || STATUSES.breaks;
  return `<span class="status-pill" data-status="${status}">${s.emoji} ${esc(long ? s.label : s.short)}</span>`;
}
function whereText(t) {
  return [t.spot, cityName(t.city)].filter(Boolean).join(' · ');
}
// Only http(s) links; adds https:// when people type "mysite.com".
function normalizeUrl(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(t) ? t : 'https://' + t);
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.href : null;
  } catch (e) { return null; }
}
const prettyUrl = u => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
function handleFrom(name) {
  return (String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '') || 'me').slice(0, 20).padEnd(3, '_');
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// Sort: up to chat first, then breaks, then focus; people who checked in today before defaults.
function byAvailability(a, b) {
  return STATUS_ORDER.indexOf(a.today.status) - STATUS_ORDER.indexOf(b.today.status)
    || (b.today.checkedIn - a.today.checkedIn)
    || a.name.localeCompare(b.name);
}

// ---------- Discord links ----------
function channelUrl(id) {
  if (discord.guildId && id) return `https://discord.com/channels/${discord.guildId}/${id}`;
  return discord.inviteUrl || '';
}
const namedChannelUrl = name => channelUrl((discord.channels || {})[name]);
const cityChannelUrl = key => channelUrl((discord.cityChannels || {})[key]);
const hasCityChannel = key => CITIES.some(c => c.key === key);

// ---------- Shared pieces ----------
function renderStatusPicker(el, selected, onPick) {
  el.innerHTML = STATUS_ORDER.map(k => {
    const s = STATUSES[k];
    return `<button type="button" class="status-option" data-status="${k}" aria-pressed="${k === selected}">
      <span class="so-emoji" aria-hidden="true">${s.emoji}</span>
      <span class="so-text"><strong>${esc(s.label)}</strong><small>${esc(s.hint)}</small></span>
    </button>`;
  }).join('');
  el.onclick = e => {
    const b = e.target.closest('.status-option');
    if (!b) return;
    el.querySelectorAll('.status-option').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    onPick(b.dataset.status);
  };
}

function waveButton(p, compact = false) {
  if (p.today.status === 'focus' && !p.waved) {
    return `<button class="wave-btn" disabled title="Heads-down today">${compact ? '🎧 Focusing' : '🎧 Focusing today'}</button>`;
  }
  return `<button class="wave-btn" data-wave="${esc(p.id)}" aria-pressed="${p.waved}">${p.waved ? '👋 Waved' : '👋 Wave'}</button>`;
}

function personRow(p, extra = '') {
  const line = p.today.note || p.workingOn;
  return `<li class="person" data-id="${esc(p.id)}">
    <button class="person-main" data-open="${esc(p.id)}">
      ${avatar(p)}
      <span class="person-text">
        <span class="person-name">${esc(p.name)} ${statusPill(p.today.status)}</span>
        <span class="person-where">📍 ${esc(whereText(p.today))}${p.today.checkedIn ? '' : ' <span class="muted">(usual)</span>'}</span>
        ${line ? `<span class="person-line">${esc(line)}</span>` : ''}
      </span>
    </button>
    ${extra || waveButton(p, true)}
  </li>`;
}

// ---------- Today ----------
function greeting() {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${me.name.split(' ')[0] || 'there'}`;
}

function renderToday() {
  $('#greeting').textContent = greeting();
  const t = backend.myToday();
  const editing = state.editingCheckin || !t.checkedIn;
  const form = $('#checkin-form');
  const card = $('#today-card');

  if (editing && form.hidden) {
    // Open the form prefilled with today's check-in, or your defaults.
    state.draftStatus = t.status;
    state.draftSpot = t.spot;
    renderStatusPicker($('#status-picker'), t.status, s => { state.draftStatus = s; });
    $('#ci-city').value = t.city;
    $('#ci-spot').value = SPOTS.includes(t.spot) ? '' : t.spot;
    $('#ci-note').value = t.note;
    renderSpotPicker();
    $('#ci-cancel').hidden = !t.checkedIn;
  }
  form.hidden = !editing;
  card.hidden = editing;
  if (!editing) {
    card.dataset.status = t.status;
    card.innerHTML = `
      <p class="eyebrow">Today you're</p>
      <p class="today-status">${STATUSES[t.status].emoji} ${esc(STATUSES[t.status].label)}</p>
      <p class="today-where">📍 ${esc(whereText(t))}</p>
      ${t.note ? `<p class="today-note">“${esc(t.note)}”</p>` : ''}
      <div class="row-end"><button class="ghost-btn" id="ci-clear">Clear</button><button class="secondary-btn" id="ci-edit">Change</button></div>`;
  }

  // Who's around in the city you're in today.
  const key = cityKey(t.city);
  const here = state.people.filter(p => cityKey(p.today.city) === key).sort(byAvailability);
  $('#around-title').textContent = `In ${cityName(t.city) || 'your city'} today`;
  $('#status-counts').innerHTML = STATUS_ORDER.map(s => {
    const n = here.filter(p => p.today.status === s).length;
    return `<button class="count" data-status="${s}" data-count-status="${s}"><strong>${n}</strong> ${esc(STATUSES[s].short.toLowerCase())}</button>`;
  }).join('');
  $('#around-list').innerHTML = here.length
    ? here.slice(0, 4).map(p => personRow(p)).join('')
    : `<li class="empty">Nobody else in ${esc(cityName(t.city))} yet. Invite a friend, or say hi in the Discord.</li>`;

  const waves = state.waves;
  $('#waves').hidden = !waves.length;
  $('#waves-list').innerHTML = waves.map(w => personRow(w.person, `
    <span class="wave-actions">
      ${w.person.waved ? '<span class="muted small">Waved back</span>' : `<button class="wave-btn" data-wave="${esc(w.person.id)}">👋 Wave back</button>`}
      <button class="icon-btn" data-dismiss="${esc(w.person.id)}" aria-label="Dismiss wave from ${esc(w.person.name)}">✕</button>
    </span>`)).join('');
}

function renderSpotPicker() {
  $('#spot-picker').innerHTML = SPOTS.map(s =>
    `<button type="button" class="pill" data-spot="${esc(s)}" aria-pressed="${state.draftSpot === s}">${esc(s)}</button>`).join('');
}

$('#spot-picker').addEventListener('click', e => {
  const b = e.target.closest('[data-spot]');
  if (!b) return;
  state.draftSpot = state.draftSpot === b.dataset.spot ? '' : b.dataset.spot;
  $('#ci-spot').value = '';
  renderSpotPicker();
});
$('#ci-spot').addEventListener('input', () => { state.draftSpot = ''; renderSpotPicker(); });

$('#checkin-form').addEventListener('submit', async e => {
  e.preventDefault();
  const city = $('#ci-city').value.trim();
  if (!city) return;
  await backend.checkIn({
    status: state.draftStatus || me.defaultStatus,
    city: cityName(city),
    spot: $('#ci-spot').value.trim() || state.draftSpot,
    note: $('#ci-note').value,
  });
  state.editingCheckin = false;
  $('#checkin-form').hidden = true;
  state.cityFilter = null;
  render();
  toast('Checked in for today');
});
$('#ci-cancel').addEventListener('click', () => { state.editingCheckin = false; $('#checkin-form').hidden = true; render(); });
$('#today-card').addEventListener('click', async e => {
  if (e.target.id === 'ci-edit') { state.editingCheckin = true; render(); }
  if (e.target.id === 'ci-clear') { await backend.clearCheckIn(); $('#checkin-form').hidden = true; render(); }
});
$('#around-all').addEventListener('click', () => { state.cityFilter = null; state.statusFilter = null; go('people'); });
$('#status-counts').addEventListener('click', e => {
  const b = e.target.closest('[data-count-status]');
  if (!b) return;
  state.cityFilter = null;
  state.statusFilter = b.dataset.countStatus;
  go('people');
});

// ---------- People ----------
function renderPeople() {
  const myKey = cityKey(backend.myToday().city);
  const cityKeyFilter = state.cityFilter == null ? myKey : state.cityFilter;

  // City pills: yours today first, then other places people are in, then everywhere.
  const counts = new Map();
  state.people.forEach(p => {
    const k = cityKey(p.today.city);
    if (!counts.has(k)) counts.set(k, { name: cityName(p.today.city), n: 0 });
    counts.get(k).n++;
  });
  if (!counts.has(myKey)) counts.set(myKey, { name: cityName(backend.myToday().city), n: 0 });
  const keys = [myKey, ...[...counts.keys()].filter(k => k !== myKey).sort((a, b) => counts.get(b).n - counts.get(a).n)];
  $('#city-filter').innerHTML = keys.map(k =>
    `<button class="pill" data-city="${esc(k)}" aria-pressed="${cityKeyFilter === k}">${k === myKey ? '📍 ' : ''}${esc(counts.get(k).name)} <span class="pill-n">${counts.get(k).n}</span></button>`).join('')
    + `<button class="pill" data-city="" aria-pressed="${cityKeyFilter === ''}">🌍 Everywhere <span class="pill-n">${state.people.length}</span></button>`;

  $('#status-filter').innerHTML = `<button class="pill" data-sf="" aria-pressed="${!state.statusFilter}">All</button>`
    + STATUS_ORDER.map(s => `<button class="pill status-pill-btn" data-status="${s}" data-sf="${s}" aria-pressed="${state.statusFilter === s}">${STATUSES[s].emoji} ${esc(STATUSES[s].short)}</button>`).join('');

  const list = state.people
    .filter(p => cityKeyFilter === '' || cityKey(p.today.city) === cityKeyFilter)
    .filter(p => !state.statusFilter || p.today.status === state.statusFilter)
    .sort(byAvailability);
  const where = cityKeyFilter === '' ? 'everywhere' : `in ${counts.get(cityKeyFilter) ? counts.get(cityKeyFilter).name : 'this city'}`;
  $('#people-label').textContent = `${list.length} ${list.length === 1 ? 'person' : 'people'} ${where} today`
    + (state.statusFilter ? ` · ${STATUSES[state.statusFilter].label.toLowerCase()}` : '');
  $('#people-list').innerHTML = list.length
    ? list.map(p => personRow(p)).join('')
    : '<li class="empty">Nobody matches yet. Try another status or Everywhere.</li>';
}

$('#city-filter').addEventListener('click', e => {
  const b = e.target.closest('[data-city]');
  if (b) { state.cityFilter = b.dataset.city; renderPeople(); }
});
$('#status-filter').addEventListener('click', e => {
  const b = e.target.closest('[data-sf]');
  if (b) { state.statusFilter = b.dataset.sf || null; renderPeople(); }
});

// ---------- Someone's profile ----------
let sheetPersonId = null;
async function openPerson(id) {
  const p = await backend.getPerson(id);
  if (!p) return;
  sheetPersonId = id;
  const t = p.today;
  const key = cityKey(t.city);
  const url = normalizeUrl(p.website);
  const chanUrl = hasCityChannel(key) ? cityChannelUrl(key) : '';
  $('#person-body').innerHTML = `
    <div class="ps-head">
      ${avatar(p, 'lg')}
      <div>
        <h2 id="ps-name">${esc(p.name)}</h2>
        <p class="muted">@${esc(p.handle)} · based in ${esc(cityName(p.baseCity))}</p>
      </div>
    </div>
    <div class="ps-today" data-status="${t.status}">
      <p class="eyebrow">${t.checkedIn ? 'Today' : 'Usually'}</p>
      <p class="today-status">${STATUSES[t.status].emoji} ${esc(STATUSES[t.status].label)}</p>
      <p>📍 ${esc(whereText(t))}</p>
      ${t.note ? `<p class="today-note">“${esc(t.note)}”</p>` : ''}
    </div>
    ${p.workingOn ? `<h3 class="section-title">Working on</h3><p>${esc(p.workingOn)}</p>` : ''}
    ${url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener nofollow">🔗 ${esc(prettyUrl(url))}</a></p>` : ''}
    ${p.openTo && p.openTo.length ? `<h3 class="section-title">Open to</h3><div class="pill-row">${p.openTo.map(o => `<span class="pill static">${esc(o)}</span>`).join('')}</div>` : ''}
    <div class="ps-actions">
      ${waveButton(p)}
      ${p.discord ? `<button class="secondary-btn" data-copy="${esc(p.discord)}">Copy Discord: ${esc(p.discord)}</button>` : ''}
    </div>
    ${chanUrl ? `<p class="small"><a href="${esc(chanUrl)}" target="_blank" rel="noopener">Find more people in #${esc(key)} on Discord →</a></p>` : ''}`;
  $('#sheet-backdrop').hidden = false;
  $('#person-sheet').hidden = false;
  $('#ps-close').focus();
}
function closePerson() {
  sheetPersonId = null;
  $('#sheet-backdrop').hidden = true;
  $('#person-sheet').hidden = true;
}
$('#ps-close').addEventListener('click', closePerson);
$('#sheet-backdrop').addEventListener('click', closePerson);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetPersonId) closePerson(); });

// Opening profiles, waving, dismissing waves and copying handles work the same everywhere.
$('#app').addEventListener('click', async e => {
  const open = e.target.closest('[data-open]');
  const wave = e.target.closest('[data-wave]');
  const dismiss = e.target.closest('[data-dismiss]');
  const copy = e.target.closest('[data-copy]');
  if (wave) {
    const id = wave.dataset.wave;
    const on = await backend.toggleWave(id);
    const p = state.people.find(x => x.id === id);
    toast(on ? `Waved at ${p ? p.name.split(' ')[0] : 'them'} 👋` : 'Wave taken back');
    await refresh();
    if (sheetPersonId === id) openPerson(id);
  } else if (dismiss) {
    await backend.dismissWave(dismiss.dataset.dismiss);
    await refresh();
  } else if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.copy); toast('Discord username copied'); }
    catch (err) { toast(`Their Discord is ${copy.dataset.copy}`); }
  } else if (open) {
    openPerson(open.dataset.open);
  }
});

// ---------- Community (Discord) ----------
const GENERAL_CHANNELS = [
  ['welcome', 'Start here: how cc me works'],
  ['introductions', 'Say who you are and what you’re working on'],
  ['general', 'Anything and everything'],
  ['looking-to-chat', 'Up for a call or coffee right now'],
  ['cowork-sessions', 'Drop-in video coworking and focus sprints'],
  ['wins', 'Shipped something? Tell everyone'],
];

function channelRow(name, desc, url, badge = '') {
  const inner = `<span class="ch-hash" aria-hidden="true">#</span><span class="ch-text"><strong>${esc(name)}</strong>${desc ? `<small>${esc(desc)}</small>` : ''}</span>${badge}`;
  return `<li>${url ? `<a class="channel" href="${esc(url)}" target="_blank" rel="noopener">${inner}<span class="ch-go" aria-hidden="true">→</span></a>` : `<span class="channel off">${inner}</span>`}</li>`;
}

function renderCommunity() {
  const open = !!discord.inviteUrl;
  const join = $('#discord-join');
  join.hidden = !open;
  if (open) join.href = discord.inviteUrl;
  $('#discord-note').hidden = open;

  const t = backend.myToday();
  const mine = [];
  const add = (city, label) => {
    const key = cityKey(city);
    if (!key || mine.some(m => m.key === key)) return;
    mine.push({ key, name: cityName(city), label });
  };
  add(me.baseCity, 'Your base');
  add(t.city, 'Where you are today');
  $('#my-channels').innerHTML = mine.map(m => hasCityChannel(m.key)
    ? channelRow(m.key, `${m.name} · ${m.label}`, cityChannelUrl(m.key), `<span class="ch-badge">${esc(m.label)}</span>`)
    : channelRow(m.key, `No ${m.name} channel yet. Ask for one in #city-requests.`, '', '')).join('');

  $('#general-channels').innerHTML = GENERAL_CHANNELS.map(([n, d]) => channelRow(n, d, namedChannelUrl(n))).join('');

  // Cities where people are today float to the top.
  const here = new Map();
  state.people.forEach(p => { const k = cityKey(p.today.city); here.set(k, (here.get(k) || 0) + 1); });
  const cities = [...CITIES].sort((a, b) => (here.get(b.key) || 0) - (here.get(a.key) || 0) || a.name.localeCompare(b.name));
  $('#city-channels').innerHTML = cities.map(c => {
    const n = here.get(c.key) || 0;
    return channelRow(c.key, n ? `${c.name} · ${n} on cc me today` : c.name, cityChannelUrl(c.key));
  }).join('');

  const req = namedChannelUrl('city-requests');
  const reqLink = $('#city-requests-link');
  if (req) { reqLink.href = req; reqLink.target = '_blank'; reqLink.rel = 'noopener'; }
  else reqLink.removeAttribute('href');
}

// ---------- Profile ----------
function renderProfile() {
  const view = $('#profile-view');
  const form = $('#profile-form');
  view.hidden = state.editingProfile;
  form.hidden = !state.editingProfile;
  if (state.editingProfile) return;
  const url = normalizeUrl(me.website);
  view.innerHTML = `
    <div class="card profile-card">
      <div class="ps-head">
        ${avatar(me, 'lg')}
        <div>
          <h2>${esc(me.name)}</h2>
          <p class="muted">@${esc(me.handle)} · based in ${esc(cityName(me.baseCity))}</p>
        </div>
      </div>
      <p class="small">Default status: ${statusPill(me.defaultStatus, true)}</p>
      <h3 class="section-title">Working on</h3>
      <p class="${me.workingOn ? '' : 'muted'}">${esc(me.workingOn || 'Tell people what you do or what you’re building. It’s the easiest way to start a conversation.')}</p>
      ${url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener">🔗 ${esc(prettyUrl(url))}</a></p>` : ''}
      ${me.discord ? `<p class="small">Discord: <strong>${esc(me.discord)}</strong></p>` : ''}
      ${me.openTo.length ? `<h3 class="section-title">Open to</h3><div class="pill-row">${me.openTo.map(o => `<span class="pill static">${esc(o)}</span>`).join('')}</div>` : ''}
      <div class="row-end"><button class="primary-btn" id="pf-edit">Edit profile</button></div>
    </div>
    ${backend.mode === 'demo' ? `<div class="card demo-card">
      <p class="small"><strong>Demo mode.</strong> The other people are examples and everything stays on this device.</p>
      <button class="ghost-btn" id="demo-reset">Start over</button>
    </div>` : ''}`;
}

let draftOpenTo = [];
let draftDefault = 'breaks';
function openProfileForm() {
  state.editingProfile = true;
  $('#pf-name').value = me.name;
  $('#pf-handle').value = me.handle;
  $('#pf-city').value = me.baseCity;
  $('#pf-working').value = me.workingOn;
  $('#pf-website').value = me.website;
  $('#pf-discord').value = me.discord;
  draftDefault = me.defaultStatus;
  draftOpenTo = [...me.openTo];
  renderStatusPicker($('#pf-status'), draftDefault, s => { draftDefault = s; });
  renderOpenTo();
  renderProfile();
  $('#pf-name').focus();
}
function renderOpenTo() {
  $('#pf-open').innerHTML = OPEN_TO.map(o => `<button type="button" class="pill" data-open-to="${esc(o)}" aria-pressed="${draftOpenTo.includes(o)}">${esc(o)}</button>`).join('');
}
$('#pf-open').addEventListener('click', e => {
  const b = e.target.closest('[data-open-to]');
  if (!b) return;
  const o = b.dataset.openTo;
  draftOpenTo = draftOpenTo.includes(o) ? draftOpenTo.filter(x => x !== o) : [...draftOpenTo, o];
  renderOpenTo();
});
$('#pf-website').addEventListener('input', e => e.target.setCustomValidity(''));
$('#pf-handle').addEventListener('input', e => { e.target.value = e.target.value.toLowerCase(); });
$('#profile-form').addEventListener('submit', async e => {
  e.preventDefault();
  const site = $('#pf-website');
  const url = normalizeUrl(site.value);
  if (url === null) { site.setCustomValidity('Enter a web address like yoursite.com'); site.reportValidity(); return; }
  await backend.saveProfile({
    name: $('#pf-name').value.trim(),
    handle: $('#pf-handle').value.trim(),
    baseCity: cityName($('#pf-city').value),
    defaultStatus: draftDefault,
    workingOn: $('#pf-working').value.trim(),
    website: url,
    discord: $('#pf-discord').value.trim(),
    openTo: draftOpenTo,
  });
  state.editingProfile = false;
  render();
  toast('Profile saved');
});
$('#pf-cancel').addEventListener('click', () => { state.editingProfile = false; renderProfile(); });
$('#profile-view').addEventListener('click', async e => {
  if (e.target.id === 'pf-edit') openProfileForm();
  if (e.target.id === 'demo-reset' && confirm('Clear your profile, check-ins and waves on this device?')) {
    await backend.reset();
    location.reload();
  }
});

// ---------- First run ----------
let obStatus = 'breaks';
function showOnboarding() {
  $('#onboard').hidden = false;
  renderStatusPicker($('#ob-status'), obStatus, s => { obStatus = s; });
  $('#ob-name').focus();
}
$('#onboard-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('#ob-name').value.trim();
  await backend.saveProfile({
    name,
    handle: handleFrom(name),
    baseCity: cityName($('#ob-city').value),
    defaultStatus: obStatus,
    onboarded: true,
  });
  $('#onboard').hidden = true;
  $('#checkin-form').hidden = true;  // refill it with the city you just entered
  render();
  toast('Welcome! Add what you’re working on in Profile.');
});

// ---------- Navigation ----------
function go(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach(t => {
    if (t.dataset.tab === tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== 'screen-' + tab; });
  $('.screens').scrollTop = 0;
  render();
}
document.querySelector('.tabbar').addEventListener('click', e => {
  const t = e.target.closest('.tab');
  if (t) go(t.dataset.tab);
});

function render() {
  if (state.tab === 'today') renderToday();
  if (state.tab === 'people') renderPeople();
  if (state.tab === 'community') renderCommunity();
  if (state.tab === 'profile') renderProfile();
}

async function refresh() {
  [state.people, state.waves] = await Promise.all([backend.listPeople(), backend.listWaves()]);
  render();
}

// ---------- Start ----------
$('#topbar-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
$('#city-list').innerHTML = CITIES.map(c => `<option value="${esc(c.name)}">`).join('');
await refresh();
if (!me.onboarded) showOnboarding();
