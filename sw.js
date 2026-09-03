"use strict";
// ═══════════════════════════════════════════════════════════════
// SONIC MOMENTS — service worker. Also serves Garage Log at
// /garage-log/, which is a separate installable app but sits on this
// same origin, so one worker at the site root covers both.
// Its only job is to keep this app's own files on the device so it
// opens with no signal at all. It touches nothing but the files listed
// below, all from this same origin: no third-party requests, no
// analytics, no background sync. The moments themselves are never
// involved — those live in IndexedDB and never leave the phone.
// ═══════════════════════════════════════════════════════════════

// Bump this after changing index.html or garage-log/index.html. Not
// strictly required — the app shell refreshes itself on the next open
// either way — but bumping it throws the old copy away cleanly.
const VERSION = "v4";
const CACHE = "sonic-moments-" + VERSION;

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "garage-log/index.html",
  "garage-log/manifest.webmanifest",
  "icons/garage-192.png",
  "icons/garage-512.png",
  "icons/garage-apple-touch.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache first, so the app opens instantly and works with no signal, then
// quietly refresh the stored copy in the background — a new deploy is
// picked up the next time the app is opened.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  // Only ordinary web requests for our own files. Anything else — and in
  // particular the blob: and data: URLs the camera, the player and the
  // backup importer pass around — is left completely alone.
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const shell = url.pathname.includes("/garage-log") ? "garage-log/index.html" : "index.html";
      const hit = await cache.match(req, { ignoreSearch: true })
        || (req.mode === "navigate" ? await cache.match(shell) : null);

      const fresh = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      return hit || (await fresh) || Response.error();
    })
  );
});

// ── random nudges ────────────────────────────────────────────
// Chrome wakes this worker every so often — its call entirely, no more
// than every few hours, and only while the app is installed. Each wake
// is a chance to nudge, not an instruction to: most are thrown away, so
// the nudges land at unpredictable times instead of on a timetable.
// Mirrors the constants in index.html.
const NUDGE_MIN_GAP = 18 * 60 * 60 * 1000;
const NUDGE_SKIP = 0.55;                     // odds a given wake stays quiet

const NUDGES = [
  "What does it sound like where you are?",
  "Ten seconds of right here.",
  "Is there a sound here worth keeping?",
  "You'd photograph this. Listen to it instead.",
  "Wherever you're standing — how does it sound?",
];

// The page owns this database; the worker only reads its own settings
// row and writes the timestamp back. Opened without a version so it can
// never trigger an upgrade of its own.
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("sonic-moments");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function getNudgePrefs() {
  const d = await openDB();
  if (!d.objectStoreNames.contains("prefs")) return null;
  return new Promise((res) => {
    const rq = d.transaction("prefs").objectStore("prefs").get("nudge");
    rq.onsuccess = () => res(rq.result || null);
    rq.onerror = () => res(null);
  });
}
async function setNudgePrefs(v) {
  const d = await openDB();
  if (!d.objectStoreNames.contains("prefs")) return;
  return new Promise((res) => {
    const tx = d.transaction("prefs", "readwrite");
    tx.objectStore("prefs").put(v);
    tx.oncomplete = res; tx.onerror = res;
  });
}

async function maybeNudge() {
  const p = await getNudgePrefs().catch(() => null);
  if (!p || !p.on) return;

  const h = new Date().getHours();
  const awake = p.from <= p.to ? (h >= p.from && h < p.to) : (h >= p.from || h < p.to);
  if (!awake) return;                                    // don't wake anyone at 4am
  if (Date.now() - (p.last || 0) < NUDGE_MIN_GAP) return;
  if (Math.random() < NUDGE_SKIP) return;

  await setNudgePrefs({ ...p, last: Date.now() });
  await self.registration.showNotification("Sonic Moments", {
    body: NUDGES[Math.floor(Math.random() * NUDGES.length)],
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: "nudge",
    data: { url: "./?nudge=1" },
  });
}

self.addEventListener("periodicsync", (e) => {
  if (e.tag === "nudge") e.waitUntil(maybeNudge());
});

// Tapping the nudge should land on the capture screen — reusing the
// window if one is already open rather than stacking up another.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of open) {
      if (c.url.startsWith(self.registration.scope)) {
        c.postMessage({ type: "nudge" });
        return c.focus();
      }
    }
    return self.clients.openWindow(new URL("./?nudge=1", self.location.href).href);
  })());
});
