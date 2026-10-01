# Gopher Turtle 🐢

Scrollable voice memos. Open the app and scroll through memos from your close friends, people you follow, and the world, newest first.

## What's in the prototype

**Home**
- A top bar with three color-coded filters: **Close friends** (green), **Following** (blue), **Global** (orange). Tap one to show only that audience. Tap it again to go back to everything.
- With no filter selected, the feed shows every memo from newest to oldest.
- Each memo card carries its audience color: a stripe down the side, a badge, a play button, and a waveform that fills in as it plays.
- When a memo finishes, the next one in the feed plays automatically, so you can listen hands-free.

**Bottom bar**: Home · Post · Search · Profile

**Post**
1. Tap **Post** and a recorder sheet slides up.
2. Tap the red button to record (up to 1 minute) and tap again to stop. A live waveform shows your voice while you record.
3. Play it back or redo it.
4. Choose who can hear it: **Close friends**, **Followers only**, or **Global**. Add an optional caption.
5. Tap **Post**. The memo shows up at the top of your feed.

**Search**: find people (shows whether they're a close friend, someone you follow, or neither) and search memo captions.

**Profile**: your stats and the memos you've posted.

## Running it

It's a plain HTML/CSS/JS web app with no build step.

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

To try it on your phone, serve it over HTTPS (browsers only allow microphone access on `https://` or `localhost`). For example, deploy the folder to GitHub Pages, Netlify, or Vercel, open it in Safari or Chrome, and use "Add to Home Screen" to install it like an app.

If the microphone isn't available, the recorder falls back to a demo recording so you can still walk through the posting flow.

## Notes

- The example people and memos are placeholder data, and their audio is generated babble.
- Memos you record are saved in your browser (IndexedDB) on that device only. There's no server yet, so other people can't see your posts.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Screens: top bar, feed, search, profile, tab bar, recorder sheet |
| `styles.css` | Design tokens (audience colors, light and dark mode) and layout |
| `app.js` | Feed, filters, playback, recording, posting, local storage |
| `manifest.webmanifest`, `icons/` | Lets the app be installed to a phone's home screen |
