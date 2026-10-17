// The cc me Discord. Fill this in by hand, or run `npm run setup:discord`
// (scripts/setup-discord.mjs) to create the channels and write this file.
//
// While `inviteUrl` is empty, the Community tab shows the channel layout with
// a note that the Discord isn't open yet.
export const discord = {
  // A permanent invite, e.g. 'https://discord.gg/abc123'.
  inviteUrl: '',
  // Server ID (Discord → Server Settings → Widget, or right-click the server → Copy Server ID).
  guildId: '',
  // Channel IDs by name. Channels without an ID open the invite instead.
  channels: {
    'welcome': '',
    'introductions': '',
    'general': '',
    'looking-to-chat': '',
    'cowork-sessions': '',
    'wins': '',
    'city-requests': '',
  },
  // City channel IDs, keyed like CITIES in constants.js ('austin', 'new-york', ...).
  cityChannels: {},
};
