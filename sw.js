"use strict";
// ═══════════════════════════════════════════════════════════════
// SONIC MOMENTS — service worker.
// Its only job is to keep this app's own files on the device so it
// opens with no signal at all. It touches nothing but the files listed
// below, all from this same origin: no third-party requests, no
// analytics, no background sync. The moments themselves are never
// involved — those live in IndexedDB and never leave the phone.
// ═══════════════════════════════════════════════════════════════

// Bump this after changing index.html. Not strictly required — the app
// shell refreshes itself on the next open either way — but bumping it
// throws the old copy away cleanly.
const VERSION = "v1";
const CACHE = "sonic-moments-" + VERSION;

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
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
      const hit = await cache.match(req, { ignoreSearch: true })
        || (req.mode === "navigate" ? await cache.match("index.html") : null);

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
