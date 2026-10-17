#!/usr/bin/env node
// Lays out the cc me Discord server and writes www/discord-config.js so the
// app's Community tab links straight to each channel.
//
//   DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... npm run setup:discord
//
// Safe to run again: channels that already exist (same name) are reused, and
// new cities added to CITIES in www/constants.js get a channel on the next run.
// The bot needs the Manage Channels and Create Invite permissions. See README.md → "Discord".
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CITIES } from '../www/constants.js';

const API = 'https://discord.com/api/v10';
const TEXT = 0;
const CATEGORY = 4;

// Category -> channels (name, topic). Channel names match discord-config.js.
const LAYOUT = [
  ['Start here', [
    ['welcome', 'How cc me works. Set your status in the app, then come say hi.'],
    ['introductions', 'Who you are, where you’re based, and what you’re working on.'],
  ]],
  ['Everyone', [
    ['general', 'Anything and everything.'],
    ['looking-to-chat', 'Up for a call or a coffee right now? Post here.'],
    ['cowork-sessions', 'Drop-in video coworking and focus sprints.'],
    ['wins', 'Shipped something, landed a client, finished a chapter? Tell everyone.'],
    ['city-requests', 'Want a channel for your city? Ask here.'],
  ]],
  ['Cities', CITIES.map(c => [c.key, `Remote workers in and passing through ${c.name}. Who’s around today?`])],
];

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
if (!token || !guildId) {
  console.error('Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID. See README.md → "Discord".');
  process.exit(1);
}

async function api(method, path, body) {
  for (;;) {
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      const { retry_after = 1 } = await res.json().catch(() => ({}));
      await new Promise(r => setTimeout(r, retry_after * 1000 + 100));
      continue;
    }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
    return res.json();
  }
}

const existing = await api('GET', `/guilds/${guildId}/channels`);
const find = (name, type, parentId) => existing.find(c => c.name === name && c.type === type && (parentId === undefined || c.parent_id === parentId));

async function ensure(name, type, extra = {}) {
  const found = find(name, type, type === CATEGORY ? undefined : extra.parent_id);
  if (found) return found;
  const made = await api('POST', `/guilds/${guildId}/channels`, { name, type, ...extra });
  existing.push(made);
  console.log(`  created ${type === CATEGORY ? 'category' : '#'}${name}`);
  return made;
}

const channels = {};
const cityChannels = {};
for (const [category, list] of LAYOUT) {
  const cat = await ensure(category, CATEGORY);
  for (const [name, topic] of list) {
    const ch = await ensure(name, TEXT, { parent_id: cat.id, topic });
    if (category === 'Cities') cityChannels[name] = ch.id; else channels[name] = ch.id;
  }
}

// One invite that never expires, pointing at #welcome.
const invite = await api('POST', `/channels/${channels.welcome}/invites`, { max_age: 0, max_uses: 0, unique: false });
const inviteUrl = `https://discord.gg/${invite.code}`;

const out = fileURLToPath(new URL('../www/discord-config.js', import.meta.url));
await writeFile(out, `// The cc me Discord. Written by scripts/setup-discord.mjs; safe to edit by hand.
//
// While \`inviteUrl\` is empty, the Community tab shows the channel layout with
// a note that the Discord isn't open yet.
export const discord = ${JSON.stringify({ inviteUrl, guildId, channels, cityChannels }, null, 2)};
`);
console.log(`\nDone. Invite: ${inviteUrl}\nWrote ${out}`);
