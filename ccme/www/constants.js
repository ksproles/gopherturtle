// Shared lists: statuses, places, "open to" tags and the cities with their own channel.

// Daily statuses. `short` is used on chips and pills where space is tight.
export const STATUSES = {
  chat: { label: 'Looking to chat', short: 'Up to chat', emoji: '💬', hint: 'Come say hi, grab a coffee, sit together.' },
  breaks: { label: 'Open to talking on breaks', short: 'On breaks', emoji: '☕', hint: 'Working, but happy to talk at lunch or between calls.' },
  focus: { label: 'Focused work day', short: 'Focus day', emoji: '🎧', hint: 'Heads-down today. Waves wait until tomorrow.' },
};
export const STATUS_ORDER = ['chat', 'breaks', 'focus'];

// Quick picks for "where today"; anything else can be typed.
export const SPOTS = ['Home', 'Café', 'Coworking space', 'Library', 'Office', 'Hotel', 'Outside'];

// What people are up for. Mixes personal and professional on purpose.
export const OPEN_TO = [
  'Coffee', 'Lunch', 'Walks', 'Coworking sessions', 'Just making friends',
  'Feedback on my work', 'Collaborators', 'Mentoring', 'Being mentored', 'Hiring', 'Job hunting', 'Talking shop',
];

// Cities with a channel on the Discord. The key is the channel name (see
// discord-config.js and scripts/setup-discord.mjs); `match` lists other ways
// people type the same place.
export const CITIES = [
  { key: 'austin', name: 'Austin', match: ['austin, tx', 'atx'] },
  { key: 'new-york', name: 'New York', match: ['nyc', 'new york city', 'brooklyn', 'manhattan', 'queens'] },
  { key: 'san-francisco', name: 'San Francisco', match: ['sf', 'bay area', 'oakland'] },
  { key: 'los-angeles', name: 'Los Angeles', match: ['la', 'l.a.'] },
  { key: 'chicago', name: 'Chicago', match: ['chi'] },
  { key: 'denver', name: 'Denver', match: ['boulder'] },
  { key: 'seattle', name: 'Seattle', match: [] },
  { key: 'portland', name: 'Portland', match: ['pdx'] },
  { key: 'miami', name: 'Miami', match: [] },
  { key: 'toronto', name: 'Toronto', match: [] },
  { key: 'mexico-city', name: 'Mexico City', match: ['cdmx', 'ciudad de mexico', 'ciudad de méxico'] },
  { key: 'london', name: 'London', match: [] },
  { key: 'lisbon', name: 'Lisbon', match: ['lisboa'] },
  { key: 'berlin', name: 'Berlin', match: [] },
  { key: 'barcelona', name: 'Barcelona', match: [] },
  { key: 'bali', name: 'Bali', match: ['canggu', 'ubud'] },
];

// "  Brooklyn " -> 'new-york'; unknown places get a slug of their own.
export function cityKey(text) {
  const t = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return '';
  const head = t.split(',')[0].trim();
  const hit = CITIES.find(c => c.name.toLowerCase() === t || c.name.toLowerCase() === head || c.match.includes(t) || c.match.includes(head));
  if (hit) return hit.key;
  return head.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Display name for a place: the known spelling if we have one, otherwise what they typed.
export function cityName(text) {
  const key = cityKey(text);
  const hit = CITIES.find(c => c.key === key);
  return hit ? hit.name : String(text || '').trim().split(',')[0].trim();
}

// Local calendar date, so "today" turns over at the user's midnight.
export function todayKey(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
