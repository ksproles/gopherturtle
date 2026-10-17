# cc me

A coworking app for people who work remotely. Each day you say how you're working and where, and you can see who else is working near you: who's up for a chat, who's free on breaks, and who's heads-down. It's for meeting people in personal or professional ways. A Discord server, with general channels and one channel per city, is where the conversations happen.

This folder is a separate app from TwoCents (the rest of this repository). It uses the same setup: plain web code in `www/`, with no build step.

## Run it

```sh
cd ccme
npm run serve        # http://localhost:8010
```

It runs in **demo mode** for now. The other people are examples, and everything you enter stays on your device. To clear it, go to **Profile → Start over**.

## Features

**First run.** Enter your name, your **base location** (where you usually work from) and your default status.

**Today**
- **Daily status:** 💬 **Looking to chat**, ☕ **Open to talking on breaks**, or 🎧 **Focused work day**.
- **Where you're working from today:** a city (it starts as your base location), a spot (Home, Café, Coworking space, Library… or type your own, like "Merit Coffee on 5th"), and an optional note ("big table by the window, lunch ~12:30").
- A check-in only lasts for that day and resets at midnight. Until you check in, people see your default status and your base location, labeled "(usual)".
- **In [your city] today:** a count of people by status, plus the people who are most available. Tap a count to see that group.
- **Waves:** people who'd like to connect with you. You can wave back or dismiss a wave.

**People.** Everyone, filtered by city (where you are today, any other city people are in, or Everywhere) and by status. The list puts people up to chat first, then people on breaks, then people having a focus day. Tap someone to see their profile: what they're doing today, what they're working on, their website, what they're open to, and their Discord username (tap to copy it). **Wave** says "I'd like to connect." To respect focus days, you can't wave at someone who is having one.

**Community.** The Discord:
- **Your cities:** the channels for your base city and for wherever you are today.
- **Everyone:** #welcome, #introductions, #general, #looking-to-chat, #cowork-sessions, #wins.
- **Cities:** one channel per city. Cities where people are today are listed first.
- If your city has no channel, you can ask for one in #city-requests.

**Profile.** Your name, username, base location, default status, what you're working on, website, Discord username, and **Open to** tags. The tags mix personal and professional on purpose: Coffee, Lunch, Walks, Coworking sessions, Just making friends, Feedback on my work, Collaborators, Mentoring, Being mentored, Hiring, Job hunting, Talking shop.

City names are matched loosely, so "Brooklyn", "NYC" and "New York" all count as New York. The known cities and the other names they go by are listed in `www/constants.js`.

## Discord

The app links to the Discord server; it doesn't host chat itself. The Community tab reads `www/discord-config.js`. Until that file has an invite link, the tab shows the planned channel layout and a note that the Discord isn't open yet.

To set up the server:

1. Create a Discord server (Discord → **+** → Create My Own).
2. Create a bot at <https://discord.com/developers/applications>: **New Application → Bot → Reset Token**, then copy the token.
3. Invite the bot to your server: **OAuth2 → URL Generator**, tick `bot`, then under permissions tick **Manage Channels** and **Create Instant Invite**. Open the URL it generates.
4. Copy your server ID. Turn on Discord **Settings → Advanced → Developer Mode**, then right-click the server and choose **Copy Server ID**.
5. Run:
   ```sh
   cd ccme
   DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... npm run setup:discord
   ```
   This creates the categories and channels (Start here, Everyone, and Cities with one channel per city in `constants.js`), makes an invite link that never expires, and writes `www/discord-config.js`. You can run it again safely: existing channels are reused. To add a city, add it to `CITIES` and run the script again.

You can also fill in `www/discord-config.js` by hand.

## Data model (for a shared backend)

`www/backend-demo.js` defines the interface that a real backend, such as Firebase, would also implement: `listPeople`, `getPerson`, `saveProfile`, `myToday`, `checkIn`, `clearCheckIn`, `toggleWave`, `listWaves`, `dismissWave`. With Firestore, it would look like this:

```
users/{uid}                    {name, handle, color, baseCity, baseCityKey, defaultStatus, workingOn, website, discord, openTo[]}
checkins/{uid}_{YYYY-MM-DD}    {uid, day, status, city, cityKey, spot, note, at}   query: day == today && cityKey == X
waves/{from}_{to}              {from, to, day, at}                                  the recipient reads, the sender creates or deletes
```

## Next steps

- A shared backend (accounts, real people) using the Firebase setup TwoCents already has.
- Profile photos, and blocking and reporting (TwoCents already has both).
- Packaging it as iPhone and Android apps with Capacitor, the same way as TwoCents.
- Optional: a Discord bot that posts a daily "who's around" summary in each city channel.
