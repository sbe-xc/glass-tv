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

## Keyboard

| Browsing | |
| --- | --- |
| Arrows | Move focus (tvOS-style spatial navigation) |
| Enter | Play |
| Tab / ⇧Tab, 1–5 | Switch tabs |
| `/` | Search |
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
