# GlassTV

An Apple TV–style IPTV player for macOS. Native window vibrancy (real glass), tvOS-like focus
navigation, categories, countries, search, favorites, and channel surfing — fed by the public
[iptv-org/iptv](https://github.com/iptv-org/iptv) playlist (~11,000 channels).

## Run

```bash
npm start
```

The first launch downloads `index.m3u` from iptv-org and caches it for 12 hours in
`~/Library/Application Support/glasstv/`. Hit ↻ in the top bar to refresh.

## Build a .app / .dmg

```bash
npm run dist
```

Output lands in `dist/`.

## Your own sources

Click the download icon in the top bar (or press ⌘,) to open **Sources**. Add any M3U/M3U8
playlist URL, or an **Xtream Codes** login (server, username, password) from a provider you
subscribe to. Each source is validated on add, cached like the built-in playlist, gets its own
row on Watch Now, and its channels flow into Categories, Search, Favorites and the Sports hub.
Credentials are stored locally in `~/Library/Application Support/glasstv/sources.json`.

## Sports hub

The **Sports** tab groups every sports channel (built-in and yours) by sport — Football,
Basketball, Motorsport, Combat, Cricket, … — and checks streams in the background so live ones
get a green dot and dead ones are dimmed (toggle **Hide offline** to drop them). At the top, a
Premier League strip shows the current matchweek with kick-off times, live scores and results
(data from TheSportsDB). **Find channel** lists the channels in your sources most likely to carry
that match — your own sources first.

Live Premier League and Sky Sports are only available from licensed broadcasters; GlassTV does not
bundle or locate those streams. Add a subscription that gives you an M3U or Xtream login and the
match finder will surface it.

## Keyboard

| Browsing | |
| --- | --- |
| Arrows | Move focus (tvOS-style spatial navigation) |
| Enter | Play |
| Tab / ⇧Tab, 1–6 | Switch tabs |
| `/` | Search |
| ⌘, | Sources |
| F | Toggle favorite on the focused channel |
| Esc | Back |

| Watching | |
| --- | --- |
| ↑ / ↓ (or ← / →) | Surf to the next / previous channel in the current list |
| L | Channel list drawer (type to filter, Enter to jump) |
| I | Show channel info |
| F | Favorite |
| M | Mute |
| Space | Pause / resume |
| ⌃⌘F or double‑click | Fullscreen |
| Esc | Back to browsing |

Dead streams show a glass error card; while surfing they auto-skip after 5 seconds.
Radio streams get an audio-only stage instead of a black screen.

## How it works

- `main.js` — Electron main process: vibrancy window, playlist fetch + cache, and per-host
  `User-Agent` / `Referer` injection for streams that require them (`#EXTVLCOPT`).
- `renderer/playlist.js` — M3U parser; derives country from `tvg-id`, quality from the name
  suffix, categories from `group-title`.
- `renderer/app.js` — Views, spatial focus, favorites / recents (localStorage).
- `renderer/player.js` — hls.js playback, surfing, drawer, error handling, audio-only mode.

Stream availability is whatever iptv-org currently lists; many are geo-blocked or flaky.
