<img src="icons/icon-192.png" alt="" width="72" align="right">

# Sonic Moments or Sonic Feels

**A photo you can hear.**

Capture a moment as a picture *plus ten seconds of the ambient sound of that place*,
stamped with the time and where you were standing. Play it back later and the sound is
what brings the place back — the traffic, the room, the birds, whatever was going on
around you while you took it.

The idea came from using Shazam on trips and noticing that the music it caught recalled
a place better than any of the photos did.

→ **[stevenjk.github.io/sonic-feels](https://stevenjk.github.io/sonic-feels/)**

Android Chrome. Add it to your home screen and it behaves like an app: opens in its own
window, works with no signal.

## Everything stays on your phone

There is no account, no backend, no analytics, and **the app makes no network calls at
all** — not one. Your moments live in IndexedDB on the device and never leave it. Even
the map is drawn from your own GPS points rather than fetched, because asking a tile
server for the tiles covering your trip would tell that server where you'd been.

The flip side of that: your moments are only ever on your phone. Clearing site data for
the domain in Chrome's settings deletes them for good, so `EXPORT BACKUP` writes the
whole lot to a single file worth keeping somewhere.

## Using it

**Capture** — two modes:

- `PHOTO + CLEAN SOUND` — takes one still, shuts the camera off entirely, then records
  ten seconds of audio. This is the one to use.
- `FRAMES + SOUND` — keeps the camera live and grabs a frame a second alongside the
  audio, so playback flickers gently through the ten seconds.

Ten seconds is the default, with 20 and 30 available for when you know there's music
worth catching and want more of it. The choice is remembered.

**Moments** — everything captured, newest at the bottom, over a trace of where they
were. Tap one to replay it, or render it as a video for sharing — a slow Ken Burns
drift over the still with the sound underneath, sized for Instagram.

When a moment caught music you want named, there are two ways out. `SAVE AUDIO` writes
the clip as a WAV, normalised and ready to upload to any identifier that accepts files.
`LOOP OUT LOUD` plays it on repeat for a *second* device to listen to.

Not one device, though: a recogniser takes exclusive audio focus, so Android pauses the
loop the moment Shazam starts listening and it hears nothing at all. Same reason Shazam
can't identify what your own Spotify is playing. Neither route uploads anything from the
app itself — no key, no account, no server.

Once something has named the track, `ADD SONG LINK` puts it back on the moment. Paste a
link on its own, or an artist and title alongside it, and the moment carries it from then
on — shown when you play it, marked in the library, and in the journey readout. The app
stores the text and nothing more; it never contacts Spotify, and tapping the link is your
browser leaving rather than the app reaching out.

**Journey** — the point of the whole thing. Moments group themselves into trips by
time, and dragging the scrubber moves through one: the photo, the place on the trace
and the sound all change together. `PLAY JOURNEY` walks a whole trip on its own.

**Nudges** — an optional toggle that occasionally asks you to capture the sound of
wherever you are, for anyone who has the habit of taking photos but not of recording
sound. Deliberately imprecise: see below.

## How it's built

The whole app is **one file** — `index.html`, with the HTML, CSS and JavaScript inline.
No build step, no dependencies, no framework, nothing to install. Open it in an editor
and the entire thing is in front of you.

The only other files are the ones a PWA can't keep inline: `manifest.webmanifest`,
`sw.js` and `icons/`. No app logic lives in them.

| | |
|---|---|
| Camera, microphone | `getUserMedia`, with all voice processing off |
| Recording | `MediaRecorder`, audio only |
| Playback | Web Audio — decoded to a buffer, peak-normalised, limited |
| Storage | IndexedDB |
| Offline | service worker caching the app's own files |
| Nudges | Periodic Background Sync |

Two things are worth knowing before changing anything:

**The awkward parts are awkward for a reason.** Recording video and audio together
starved the audio encoder and produced gated, stuttering sound, so the app never records
video at all. The voice-processing defaults meant for phone calls gate out music and
ambience, so all three are explicitly off — which makes recordings very quiet, so the
level is restored on playback instead of at capture. Each of those cost real debugging.
They're written down in **[BRIEF.md](BRIEF.md)** as a list of things not to undo.

**Nudges can't be scheduled, only hoped for.** Android gives a web app no alarm clock.
Web Push would be precise but needs a server that knows your schedule, which this app
refuses to have. So nudges ride on Periodic Background Sync: Chrome wakes the installed
app when it feels like it, and the service worker decides whether to say anything —
waking hours only, never twice within eighteen hours, and most wake-ups thrown away at
random so they don't arrive like clockwork. Roughly one a day, at a moment the app
doesn't get to choose.

## Running your own

Camera, microphone and GPS all require HTTPS, so opening `index.html` from disk gets you
the interface and nothing that works. It needs to be served.

The live version is GitHub Pages from `main`, served from the repo root — every path in
the app is relative, so it doesn't mind being hosted in a subfolder. Fork it, turn Pages
on, and it's yours.

One quirk to expect once it's deployed: the service worker serves its cached copy first
and refreshes in the background, so a change shows up the *second* time the app is
opened, not the first.

---

A personal project, built for one phone. Fork it freely; it isn't looking for features.
