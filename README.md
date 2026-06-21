# MMM-NowPlaying

A [MagicMirror²](https://github.com/MichMich/MagicMirror) module that shows what's currently playing on your Google Nest / Chromecast speakers. It discovers speakers automatically on your local network and displays album art, song title, artist, and the speaker name — with play/pause/skip controls right on the mirror.

No Google account, no API keys, no cloud — everything talks directly to the speakers over your local network using the Cast protocol.

---

## Features

- **Auto-discovers** all Google Nest / Chromecast devices via mDNS (the same way the Google Home app does)
- **Single speaker** → large album art card with title, artist, speaker name, and controls
- **Multiple speakers playing** → stacked list with thumbnails, titles, and speaker names
- **Transport controls** — play/pause, previous, next, stop (works with Spotify, YouTube Music, and most Cast apps)
- **Real-time updates** — display refreshes within seconds of a track change

---

## Layout

### One speaker active

```
┌──────────────────────────┐
│                          │
│       Album Art          │
│                          │
│ Song Title               │
│ Artist Name              │
│ Album Name               │
│ KITCHEN SPEAKER          │
│                          │
│  ⏮   ⏸   ⏭   ⏹        │
└──────────────────────────┘
```

### Multiple speakers active

```
┌──────────────────────────────────────┐
│ [art]  Song Title        KITCHEN     │
│        Artist Name                   │
├──────────────────────────────────────┤
│ [art]  Another Song      LIVING ROOM │
│        Artist Name 2                 │
└──────────────────────────────────────┘
```

---

## Prerequisites

- MagicMirror² installed and running
- Node.js 18 or later (comes with modern MagicMirror)
- Google Nest / Chromecast speakers **on the same local network** as the Pi
- No port forwarding or firewall changes needed — Cast uses mDNS on the local subnet

---

## Installation

### 1. Clone the module

```bash
cd ~/MagicMirror/modules
git clone https://github.com/johnster000/MMM-NowPlaying.git
```

### 2. Install dependencies

```bash
cd MMM-NowPlaying
npm install
```

### 3. Add to your MagicMirror config

Open `~/MagicMirror/config/config.js` and add an entry to the `modules` array:

```js
{
  module: "MMM-NowPlaying",
  position: "top_left",
  config: {
    maxWidth: "360px"
  }
}
```

### 4. Restart MagicMirror

```bash
pm2 restart MagicMirror
```

The module will discover your Nest speakers automatically within a few seconds of starting. When nothing is playing it shows nothing; the widget appears as soon as music starts.

---

## Admin Interface

Open `http://<mirror-ip>:8083` from any browser on your local network.

- **Device list** — all discovered speakers with name, IP, last-seen time, and a live now-playing status dot
- **Rediscover** — forces a fresh mDNS scan; useful when a speaker's IP has changed due to DHCP. Wait ~4 seconds for devices to re-announce
- **✕ button** — removes a stale device entry from the cache

Discovered devices are saved to `data/devices.json` so they are immediately available after a MagicMirror restart without waiting for mDNS.

---

## Configuration Options

| Option | Default | Description |
|---|---|---|
| `adminPort` | `8083` | Port the admin interface listens on. |
| `pollInterval` | `5000` | How often (ms) to check each speaker for status updates. |
| `updateFadeSpeed` | `500` | Fade animation duration (ms) when the display refreshes. |
| `maxWidth` | `"360px"` | Maximum widget width. Match this to your MagicMirror region width. |
| `showAlbum` | `true` | Show album name below artist in the big card. |
| `devices` | `[]` | Optional manual device list — see below. |

### Manual device list

If mDNS discovery doesn't work on your network (e.g., the Pi is on a different VLAN than your speakers), you can specify devices by IP:

```js
config: {
  maxWidth: "360px",
  devices: [
    { name: "Kitchen",     host: "192.168.1.101" },
    { name: "Living Room", host: "192.168.1.102" },
    { name: "Bedroom",     host: "192.168.1.103" }
  ]
}
```

Manual devices and mDNS-discovered devices can coexist; duplicates are merged.

### Full config example

```js
{
  module: "MMM-NowPlaying",
  position: "top_left",
  config: {
    pollInterval:    5000,
    updateFadeSpeed: 400,
    maxWidth:        "340px",
    showAlbum:       true
  }
}
```

---

## Transport Controls

Tapping a control button on the mirror sends the command directly to the speaker via the Cast protocol.

| Button | Action |
|---|---|
| ⏮ | Previous track (queue-aware apps only) |
| ⏸ / ▶ | Pause / Resume |
| ⏭ | Next track (queue-aware apps only) |
| ⏹ | Stop |

**Previous / next compatibility:** queue skip works with YouTube Music, Spotify (when cast from the phone app), Plex, and other apps that implement the Cast queue API. Apps that stream a single track (e.g., a browser tab casting audio) will not respond to skip.

---

## Supported Apps

Any app that supports Google Cast will work for display. Transport controls depend on the app:

| App | Display | Play/Pause | Skip |
|---|---|---|---|
| Spotify | ✅ | ✅ | ✅ |
| YouTube Music | ✅ | ✅ | ✅ |
| YouTube | ✅ | ✅ | ✅ |
| Plex | ✅ | ✅ | ✅ |
| Browser tab cast | ✅ | ✅ | ❌ |
| Apple Music (via Cast) | ✅ | ✅ | varies |

---

## Troubleshooting

### No speakers discovered

1. Confirm the Pi and your Nest speakers are on the **same network subnet** — mDNS does not cross router boundaries.
2. Try adding your speakers manually via the `devices` config option (see above).
3. Check that port **8009** is not blocked by a local firewall on the Pi.

### Connection errors / "TLS handshake failed" on Node.js 18+

Some older Cast devices use TLS cipher suites that newer OpenSSL deprecates. Try starting MagicMirror with the legacy provider:

```bash
NODE_OPTIONS=--openssl-legacy-provider npm start
# or if using pm2:
NODE_OPTIONS=--openssl-legacy-provider pm2 restart MagicMirror
```

### Album art not loading

Album art URLs come directly from the streaming service (Spotify CDN, YouTube, etc.) and are loaded by the Pi's browser. If art doesn't appear, check that the Pi has internet access.

### Controls not responding

The Cast protocol allows multiple senders to read status, but control commands can conflict if another app (e.g., Google Home, Spotify Connect) is actively managing the speaker at the same moment. Try the button again — it usually succeeds on the second tap.

---

## Data & Privacy

This module makes no external network requests. All communication is local:
- mDNS discovery: LAN only
- Cast protocol: direct TCP to the speaker's IP on port 8009
- Album art: loaded by the browser from the streaming service CDN (the same URL your phone would load)

---

## License

MIT
