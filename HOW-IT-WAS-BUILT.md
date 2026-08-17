# Sonic Moments — how it got built, and what fought back

A rundown of a small personal app, and more usefully, the list of things that
turned out to be harder than they looked. Written for anyone curious about the
build rather than the product.

**The app:** [stevenjk.github.io/sonic-feels](https://stevenjk.github.io/sonic-feels/) ·
**the code:** [github.com/StevenJK/sonic-feels](https://github.com/StevenJK/sonic-feels)

## The idea

Capture a moment as a photo *plus ten seconds of the ambient sound of that place*,
stamped with the time and GPS. Play it back later and the sound is what brings the
place back — the traffic, the room, the birds, whatever was going on around you.

It came from using Shazam on trips and noticing that the music it caught recalled a
place better than any of the photos did.

Everything stays on the phone. No account, no backend, no analytics, and the app makes
no network calls at all — not one. Moments live in IndexedDB on the device.

## The shape of it

Android Chrome, installed to the home screen. **The entire app is one file** —
`index.html`, about 1,500 lines with the HTML, CSS and JavaScript inline. No build
step, no dependencies, no framework. The only other files are the three a PWA can't
keep inline: a manifest, a ~160-line service worker, and some icons.

That constraint was deliberate and it held for the whole build. It means the thing can
be read end to end on a phone, and there's no toolchain to rot.

| | |
|---|---|
| Camera, mic | `getUserMedia`, with every voice-processing default off |
| Recording | `MediaRecorder`, audio only |
| Playback | Web Audio — decode to a buffer, peak-normalise, limit |
| Storage | IndexedDB (moments and settings) |
| Offline | service worker caching the app's own files |
| Nudges | Periodic Background Sync |
| Video export | canvas `captureStream` + muxed audio |

Four screens: **Capture**, **Moments** (the library), **Journey** (a scrubbable trip),
and a backup export/import because losing the lot to a cleared cache would be grim.

## What fought back

This is the interesting part. Roughly in the order it bit.

**1. The camera starves the microphone.** Recording video and audio together produced
badly chopped, gated audio. The fix was to stop recording video at all: `MediaRecorder`
gets a stream containing *only* the mic, and pictures come from painting the live
preview onto a canvas once a second. In the main capture mode the camera track is
`.stop()`ed *before* recording starts and restarted after. That one decision is the
difference between the app working and not.

**2. Voice processing destroys ambient sound.** `getUserMedia` defaults —
`echoCancellation`, `noiseSuppression`, `autoGainControl` — are tuned for phone calls
and gate out exactly what this app exists to record. All three are explicitly `false`.
Every instinct to turn them back on "to improve quality" is wrong.

**3. Which makes everything very quiet.** With auto-gain off, recordings sit far too
low. The answer was to capture clean and fix it on playback: scan for the peak, scale
toward 0.89 (capped at 40×), and run it through a compressor as a limiter. Never fix
loudness at capture, because that reintroduces the gating.

**4. `MediaRecorder`'s webm has no duration index.** Play it through an `<audio>`
element and seeking stalls and fragments. So audio is always decoded whole with
`decodeAudioData` and played as one buffer. Frames are pre-decoded too, so swapping
pictures can't jank the thread mid-playback.

**5. A static canvas stops producing video frames.** The share feature renders a real
video for Instagram — 1080×1350, the still with the sound muxed in. A completely
motionless canvas can stop emitting frames and yield a broken file. The slow Ken Burns
zoom is there to look nice *and* to keep `captureStream` alive.

**6. A cache-first service worker means updates land on the second launch.** The worker
serves its cached copy instantly (that's what makes it work offline), then refreshes in
the background. So a deploy shows up the *next* time you open the app, not this time.
Surprising the first time; obvious in hindsight.

**7. A timeline of clustered events can't be time-proportional.** The Journey scrubber
steps moment to moment rather than by elapsed time. Moments cluster — fifteen in one
afternoon, then nothing until evening — and on a real timeline those clusters are a
pixel wide and impossible to hit with a thumb. The actual times go in the readout
underneath.

**8. Scrubbing needed a debounce.** Sound follows the scrubber, so a fast swipe across
a trip fired a clip per moment and machine-gunned. Sound now waits for the drag to rest
for 140ms. Clips fade in and out rather than cutting, because a hard stop on ambient
audio is an audible click.

**9. Decoded audio is enormous.** A decoded ten-second clip is about 3.8MB, so holding
a whole trip in memory would be hundreds of megabytes. Clips decode on demand and only
the last six are kept.

**10. Maps mean tiles, and tiles mean telling a server where you've been.** Requesting
the map tiles covering a trip would hand that server your locations — the one feature
that would quietly undo the app's whole premise. So there is no map, only an abstract
trace of the GPS points: dots and a dotted path, the walked portion highlighted. For a
trip you took yourself, the *shape* is usually enough to recognise it.

**11. Android gives a web app no alarm clock.** The nudge feature — an occasional prompt
to record the sound of where you are — can't be scheduled. Web Push would be precise but
needs a server that knows your schedule. Notification Triggers is the right API and never
shipped to stable. What's left is Periodic Background Sync: Chrome wakes the installed
app when *it* feels like it, and the worker decides whether to speak — waking hours only,
never twice in 18 hours, and 55% of wake-ups discarded at random so nudges don't arrive
like clockwork. The app can't pick the moment; the UI says so rather than implying a
precision it doesn't have.

**12. Adding a settings store meant a schema migration on a database full of real
memories.** Service workers can't read `localStorage`, so settings had to go in
IndexedDB, which took it to v2. On a phone that already holds every moment ever
captured, an unguarded `onupgradeneeded` calling `createObjectStore` on an existing
store throws — and takes the whole database with it. That one got tested by seeding a
real v1 database and upgrading it before it went anywhere near the phone.

**13. And the one that survived an entire feature: a recogniser on your phone cannot
hear your phone.** The plan for naming music in a clip was to skip third-party APIs
entirely — play the clip out loud on a loop and let Shazam listen. Built it, shipped it,
tuned it. Then discovered Shazam won't identify audio playing on the same device *at
all* — not even Spotify. Android hands a recogniser exclusive audio focus, which pauses
all other playback the instant it starts listening, so it hears silence. Echo
cancellation on the mic input would cancel the speaker anyway.

The irony: the MediaSession added to keep the loop alive across an app switch is
precisely what makes the browser a well-behaved media app that *obeys* the pause.

So it became two honest routes instead: export the clip as a normalised WAV to upload to
an identifier that accepts files, or loop it out loud for a *second* device to hear.

## Things worth taking away

- **The awkward code was the load-bearing code.** Almost every strange-looking decision
  in that file is a scar. They're written down in `BRIEF.md` as a list of things not to
  undo, because they all look like mistakes until you know why.
- **Test the platform assumption before building on it.** #13 cost a whole feature. It
  wasn't a coding error — the code worked perfectly. The premise was wrong, and only
  real hardware said so.
- **Refusing a feature is a design decision.** Both the map tiles and the recognition
  API were technically easy and got declined, because each would have meant the app
  quietly phoning somewhere with your location or your recordings.
- **Say what a feature can't do.** The nudges are imprecise by platform limitation, so
  the UI states that plainly instead of pretending.
- **One file, no dependencies, no build step** was never a hardship. For something this
  size it removed an entire category of problems.

## Built with an AI coding agent

The whole thing was written in conversation with Claude Code — describing what I wanted,
reading back what it built, testing on the phone and reporting what broke. The pattern
that worked: the agent was good at holding the accumulated constraints in mind and not
regressing them, and good at testing its own work in a headless browser before I ever
saw it. What it couldn't do was hold a real phone, which is exactly where #13 came from
and why I kept testing on the device after every change.
