# Sonic Moments — handover brief

## What it is
A personal PWA. One user (me), Android, Chrome. Repo: `StevenJK/sonic-feels`.
Live at https://stevenjk.github.io/sonic-feels/ via GitHub Pages (branch `main`, root).
The **entire app is a single file: `index.html`** — HTML, CSS and JS inline. No build
step, no dependencies, no framework. Keep it that way.

The only other files are the ones a PWA can't do without, because the browser insists
they be separate: `manifest.webmanifest`, `sw.js`, and `icons/`. No app logic lives in
them. Everything the app *does* still belongs in `index.html`.

## The idea
Capture a moment as a **photo plus ten seconds of the ambient sound of that place**,
stamped with time and GPS. Later, replay it — the sound is what triggers the memory of
the place. Think "a photo you can hear". Originally inspired by using Shazam on trips
and finding the captured music recalled the location better than the photos did.

Everything is local. IndexedDB on the device. **The app makes zero network calls.**
No accounts, no backend, no analytics. Do not add any.

## Current state — working
- **Capture, two modes** (toggle on the capture screen):
  - `FRAMES + SOUND` — camera stays live, grabs one frame/sec for 10s + audio.
  - `PHOTO + CLEAN SOUND` — **this is the real product.** Takes one still, stops the
    camera hardware entirely, then records 10s of audio.
- **Storage** — IndexedDB db `sonic-moments` (v2), store `atoms`. Atom shape:
  `{ id, t, lat, lng, acc, frames: [Blob], audio: Blob, seconds, mode }`
  A second store `prefs` holds settings the service worker needs to read, keyed by `k`.
- **Replay** — audio decoded whole into an AudioBuffer, played via
  AudioBufferSourceNode through gain + limiter. Frames follow `AudioContext.currentTime`.
- **Backup** — export/import all moments as one JSON file (blobs base64'd).
- **Share** — renders a real video (canvas + muxed audio via MediaRecorder,
  1080x1350, slow Ken Burns) for Instagram. Prefers mp4, falls back to webm.
- **Identify music** — `LOOP FOR SHAZAM` plays the clip out loud on repeat so Shazam
  can hear it through the mic while you switch apps. MediaSession is what keeps it
  playing once the app is backgrounded. Nothing is uploaded; no key, no account.
- **Installable PWA** — manifest (standalone, portrait, warm palette, dot-and-rings
  icon) plus a service worker that caches the app shell. Add to Home Screen gives a
  real app window, and it opens and captures with no signal at all.
- **Trip timeline** (`JOURNEY` tab) — moments auto-group into trips by time (a gap
  over 8h starts a new one). Drag the scrubber and the photo, the trace and the sound
  move together; `PLAY JOURNEY` walks the whole trip on its own, clip after clip.
- **Random nudges** — toggle at the bottom of `MOMENTS`. Read the constraint below
  before touching this: it is the one feature the platform genuinely limits.

## Hard-won constraints — DO NOT REGRESS THESE
These cost many rounds of debugging. Every one is load-bearing.

1. **The camera starves the microphone.** Recording video and audio simultaneously
   produced badly chopped, gated audio on this phone. Fix: never record video. Record
   **audio only** (`new MediaStream([audioTrack])`), and get pictures either from live
   canvas grabs off the preview or, in photo mode, by stopping the camera entirely
   first. In photo mode the camera track is `.stop()`ed *before* recording starts and
   restarted after. This is the difference between working and not.

2. **Voice processing destroys ambient audio.** getUserMedia defaults
   (`echoCancellation`, `noiseSuppression`, `autoGainControl`) are tuned for speech and
   gate out music and ambience. All three are explicitly **false**. Do not re-enable
   them "to improve quality".

3. **Capture clean, fix on playback.** Because auto-gain is off, recordings are very
   quiet. Level is restored at playback with **peak normalisation** (`normaliseGain()`,
   scans for peak, scales toward 0.89, capped at 40x) plus a DynamicsCompressor acting
   as a limiter. Never fix loudness at capture time — that reintroduces gating.

4. **Never play audio through an `<audio>` element.** MediaRecorder's webm has no
   duration index; seeking it stalls and fragments playback. Always decode fully with
   `decodeAudioData` and play the buffer.

5. **Frames must be pre-decoded** before playback so image swaps can't jank the thread.

6. **The share video needs motion.** A fully static canvas can stop emitting frames and
   produce a broken video — the slow Ken Burns zoom keeps `captureStream` alive.

7. **The timeline decodes lazily and caps what it holds.** A decoded 10s clip is about
   3.8MB, so a whole trip in memory is hundreds of MB. `loadClip()` decodes on demand
   and `bufCache` keeps only the last 6. Don't pre-decode a trip.

8. **Scrubbing waits for the drag to settle.** Sound starts only after the scrubber
   rests for `SCRUB_SETTLE` (140ms), or a fast swipe fires a clip per moment and the
   whole thing machine-guns. Clips fade in and out rather than cutting — a hard stop
   on ambient sound is an audible click.

9. **No map tiles, ever.** The map is an abstract trace of the GPS points, not a real
   map, because fetching tiles would tell a server where you've been — the one feature
   that would quietly undo the premise. `fitTrace()` is deliberately shaped so a raster
   layer could be drawn behind it later if that trade is ever worth making.

10. **Nudges cannot be scheduled, only hoped for.** Android gives a web app no alarm
    clock. Web Push would be precise but needs a server that knows your schedule, which
    the app refuses to have; Notification Triggers is the right API but never shipped
    to stable Chrome. What's left is **Periodic Background Sync**: Chrome wakes the
    installed app when it feels like it, at most every few hours, and `maybeNudge()` in
    `sw.js` decides whether to say anything — checking waking hours, an 18h minimum gap,
    then throwing away 55% of wakes at random so nudges don't arrive like clockwork.
    The app cannot pick the moment, only what to do with the moments it's handed. If
    nudges ever stop, that's Chrome deciding the app isn't used enough to be worth
    waking, and there is no code fix for it.

11. **The `prefs` store made the database v2 — the upgrade is guarded.** `onupgradeneeded`
    checks `objectStoreNames.contains()` before creating anything, because on an existing
    phone `atoms` already holds every moment ever captured and creating a store twice
    throws, taking the whole database with it. Never make that handler unconditional.

12. **The service worker only ever touches our own files.** It ignores anything that
   isn't a same-origin `http(s)` GET, which deliberately keeps it away from the `blob:`
   and `data:` URLs the camera, the player and the backup importer pass around. It is
   still true that the app makes zero calls to anything but itself.

## Deployment
GitHub Pages, branch `main`, root, file must be lowercase `index.html`.
Note: camera/mic/GPS require HTTPS, so it only works from the Pages URL, never `file://`.
Every path is relative (`./`), so the app doesn't care that Pages serves it from the
`/sonic-feels/` subfolder.

Updating: the service worker serves the cached copy first and refreshes it in the
background, so a change to `index.html` shows up the **second** time the app is opened
after a deploy. Bumping `VERSION` in `sw.js` throws the old copy away cleanly.

## Decided against — don't rebuild these
- **A recognition API (ACRCloud/AudD) for identifying music.** Their APIs sign each
  request with a secret, which can't live in a public single-page app, so it would need
  a proxy — a backend, plus the recording leaving the phone and reaching a third party.
  `LOOP FOR SHAZAM` gets the same answer for no key, no server and no upload, and the
  audio never leaves the device. The only thing lost is the answer being stored on the
  moment. Not worth the trade.
- **Map tiles.** See constraint 9.

## What I want next
Nothing outstanding. The original list is done.

## Style notes
- All app logic in one file. No dependencies. No frameworks. No network calls.
- Dark, warm palette: ink `#14110d`, paper `#f4efe6`, accent `#e0895f`. Georgia serif
  for text, monospace for labels and metadata.
- Keep it terse and readable — I'm not a developer and I read this code on a phone.
