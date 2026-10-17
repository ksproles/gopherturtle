// Demo backend: example people around the world, everything stored on this device.
// A shared backend (e.g. Firebase) would implement the same methods; see README.md → "Data model".
import { todayKey } from './constants.js';

const prefs = {
  get(key, fallback) {
    try { const v = localStorage.getItem('ccme.' + key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('ccme.' + key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  },
  clear() {
    try { Object.keys(localStorage).filter(k => k.startsWith('ccme.')).forEach(k => localStorage.removeItem(k)); } catch (e) { /* storage unavailable */ }
  },
};

const PALETTE = ['#d9542a', '#1f8a62', '#6b5bd2', '#b5791f', '#2f6fb6', '#a3456b', '#3a8a8a', '#7a5a2f'];

// Example people. `today` is their check-in for the current day (null = using their defaults).
const SEED = [
  { id: 'u1', name: 'Maya Ortiz', handle: 'mayabuilds', baseCity: 'Austin', defaultStatus: 'breaks',
    workingOn: 'Building a scheduling tool for dog groomers. Solo founder, pre-launch.', website: 'https://example.com/maya',
    discord: 'mayabuilds', openTo: ['Coffee', 'Feedback on my work', 'Collaborators'],
    today: { status: 'chat', city: 'Austin', spot: 'Café', note: 'At Merit on 5th until 3, big table, come sit' } },
  { id: 'u2', name: 'Jonah Pike', handle: 'jonahp', baseCity: 'Austin', defaultStatus: 'focus',
    workingOn: 'Product designer at a remote fintech. Into film photography on weekends.', website: '',
    discord: 'jonah.pike', openTo: ['Walks', 'Just making friends', 'Talking shop'],
    today: { status: 'breaks', city: 'Austin', spot: 'Library', note: 'Central Library 4th floor, lunch ~12:30' } },
  { id: 'u3', name: 'Priya Natarajan', handle: 'priyan', baseCity: 'Austin', defaultStatus: 'breaks',
    workingOn: 'Writing a newsletter about climate tech. Freelance data viz.', website: 'https://example.com/priya',
    discord: 'priyan', openTo: ['Lunch', 'Collaborators', 'Hiring'],
    today: { status: 'focus', city: 'Austin', spot: 'Home', note: 'Deadline day 🫠' } },
  { id: 'u4', name: 'Theo Brandt', handle: 'theob', baseCity: 'Denver', defaultStatus: 'chat',
    workingOn: 'Backend engineer, open source maintainer. Looking for climbing partners.', website: 'https://example.com/theo',
    discord: 'theob', openTo: ['Coworking sessions', 'Just making friends', 'Mentoring'],
    today: { status: 'chat', city: 'Austin', spot: 'Coworking space', note: 'In town till Friday! Show me your favorite taco spot' } },
  { id: 'u5', name: 'Ruth Achebe', handle: 'ruthwrites', baseCity: 'New York', defaultStatus: 'breaks',
    workingOn: 'Copywriter for B2B startups. Working on my first novel on the side.', website: 'https://example.com/ruth',
    discord: 'ruthwrites', openTo: ['Coffee', 'Feedback on my work', 'Being mentored'], today: null },
  { id: 'u6', name: 'Sam Okafor', handle: 'samokafor', baseCity: 'New York', defaultStatus: 'chat',
    workingOn: 'Indie game dev. Shipping a cozy farming game this winter.', website: 'https://example.com/sam',
    discord: 'samokafor', openTo: ['Coworking sessions', 'Collaborators', 'Walks'],
    today: { status: 'chat', city: 'New York', spot: 'Café', note: 'Devoción in Williamsburg all day' } },
  { id: 'u7', name: 'Lena Fischer', handle: 'lenaf', baseCity: 'Berlin', defaultStatus: 'breaks',
    workingOn: 'UX researcher, contracting. Slow-traveling Europe this year.', website: '',
    discord: 'lenaf', openTo: ['Lunch', 'Just making friends', 'Job hunting'],
    today: { status: 'breaks', city: 'Lisbon', spot: 'Coworking space', note: 'Second Home, terrace at lunch' } },
  { id: 'u8', name: 'Diego Ramírez', handle: 'diegor', baseCity: 'Mexico City', defaultStatus: 'chat',
    workingOn: 'Running a tiny agency that builds Shopify stores. Always up for padel.', website: 'https://example.com/diego',
    discord: 'diegor', openTo: ['Coffee', 'Hiring', 'Talking shop'],
    today: { status: 'chat', city: 'Mexico City', spot: 'Café', note: 'Roma Norte, Café Avellaneda' } },
  { id: 'u9', name: 'Hannah Lee', handle: 'hannahl', baseCity: 'Lisbon', defaultStatus: 'focus',
    workingOn: 'ML engineer at a remote-first startup. Learning Portuguese, badly.', website: '',
    discord: 'hannah.lee', openTo: ['Walks', 'Mentoring'],
    today: { status: 'focus', city: 'Lisbon', spot: 'Home', note: '' } },
  { id: 'u10', name: 'Marcus Webb', handle: 'marcusw', baseCity: 'London', defaultStatus: 'breaks',
    workingOn: 'Podcast producer. Making a show about people who changed careers at 40.', website: 'https://example.com/marcus',
    discord: 'marcuswebb', openTo: ['Coffee', 'Collaborators', 'Just making friends'], today: null },
];

export function createDemoBackend() {
  const day = todayKey();
  const people = SEED.map((p, i) => ({ ...p, color: PALETTE[i % PALETTE.length] }));
  const byId = Object.fromEntries(people.map(p => [p.id, p]));

  const me = Object.assign({
    id: 'me', name: '', handle: '', color: PALETTE[0], baseCity: '', defaultStatus: 'breaks',
    workingOn: '', website: '', discord: '', openTo: [], onboarded: false,
  }, prefs.get('profile', {}));

  // Check-ins are kept per day; an old one simply stops applying at midnight.
  const stored = prefs.get('checkin', null);
  let myCheckin = stored && stored.day === day ? stored : null;

  let wavesSent = new Set(prefs.get('wavesSent', []));
  // Two example waves so the inbox has something in it.
  let wavesIn = prefs.get('wavesIn', [{ from: 'u4', at: Date.now() - 25 * 60 * 1000 }, { from: 'u1', at: Date.now() - 2 * 60 * 60 * 1000 }]);

  // What someone is doing today: their check-in, or their defaults if they haven't.
  function todayOf(p, checkin) {
    if (checkin) return { status: checkin.status, city: checkin.city || p.baseCity, spot: checkin.spot || '', note: checkin.note || '', checkedIn: true };
    return { status: p.defaultStatus, city: p.baseCity, spot: '', note: '', checkedIn: false };
  }
  const withToday = p => ({ ...p, today: todayOf(p, p.today), waved: wavesSent.has(p.id) });

  return {
    mode: 'demo',
    me,

    myToday() { return todayOf(me, myCheckin); },

    async listPeople() {
      return people.map(withToday);
    },

    async getPerson(id) {
      return byId[id] ? withToday(byId[id]) : null;
    },

    async saveProfile(patch) {
      Object.assign(me, patch);
      prefs.set('profile', me);
      return me;
    },

    async checkIn({ status, city, spot, note }) {
      myCheckin = { day, status, city: city.trim(), spot: spot.trim(), note: note.trim(), at: Date.now() };
      prefs.set('checkin', myCheckin);
      return todayOf(me, myCheckin);
    },

    async clearCheckIn() {
      myCheckin = null;
      prefs.set('checkin', null);
      return todayOf(me, null);
    },

    // A wave says "I'd like to connect"; they see it in their Waves. Tap again to take it back.
    async toggleWave(id) {
      if (wavesSent.has(id)) wavesSent.delete(id); else wavesSent.add(id);
      prefs.set('wavesSent', [...wavesSent]);
      return wavesSent.has(id);
    },

    async listWaves() {
      return wavesIn.filter(w => byId[w.from]).map(w => ({ ...w, person: withToday(byId[w.from]) }));
    },

    async dismissWave(fromId) {
      wavesIn = wavesIn.filter(w => w.from !== fromId);
      prefs.set('wavesIn', wavesIn);
    },

    async reset() { prefs.clear(); },
  };
}
