# Sonic Moments — handover brief

## What it is
A personal PWA. One user (me), Android, Chrome. Repo: `StevenJK/sonic-feels`.
Live at https://stevenjk.github.io/sonic-feels/ via GitHub Pages (branch `main`, root).
The **entire app is a single file: `index.html`** — HTML, CSS and JS inline. No build
step, no dependencies, no framework. Keep it that way.

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
- **Storage** — IndexedDB store `atoms` in db `sonic-moments`. Atom shape:
  `{ id, t, lat, lng, acc, frames: [Blob], audio: Blob, seconds, mode }`
- **Replay** — audio decoded whole into an AudioBuffer, played via
  AudioBufferSourceNode through gain + limiter. Frames follow `AudioContext.currentTime`.
- **Backup** — export/import all moments as one JSON file (blobs base64'd).
- **Share** — renders a real video (canvas + muxed audio via MediaRecorder,
  1080x1350, slow Ken Burns) for Instagram. Prefers mp4, falls back to webm.

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

## Deployment
GitHub Pages, branch `main`, root, file must be lowercase `index.html`.
Note: camera/mic/GPS require HTTPS, so it only works from the Pages URL, never `file://`.

## What I want next (roughly in order)
1. **Manifest + service worker** — proper installable PWA: icon, standalone display,
   offline capture. Matters because I'll use this travelling with no signal.
2. **Trip timeline** — string moments into a scrubbable journey on a map: drag through
   time and the photo, the place and the sound change together. This was the original
   vision and isn't built yet.
3. **Random nudge notifications** — prompt me at random times to capture a moment,
   since I have the habit of taking photos but not of capturing sound. Needs a small
   push scheduler; background *capture* is impossible on Android and is not the goal —
   the nudge just opens the app to the capture screen.
4. Optional later: run the audio through a recognition API (ACRCloud/AudD) to identify
   any music in a clip. Deliberately optional — the raw sound is the artifact, and a
   busker or a street will never be recognisable.

## Style notes
- Single file. No dependencies. No frameworks. No network calls.
- Dark, warm palette: ink `#14110d`, paper `#f4efe6`, accent `#e0895f`. Georgia serif
  for text, monospace for labels and metadata.
- Keep it terse and readable — I'm not a developer and I read this code on a phone.
