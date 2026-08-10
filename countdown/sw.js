"use strict";
// ═══════════════════════════════════════════════════════════════
// DAY COUNT — service worker.
//
// Two jobs, both local. Keep this app's own files on the device so it
// opens with the radio off, and — when Chrome bothers to wake it — look
// at the dates already stored on the phone and say something if one of
// them has come close. It fetches nothing from anywhere but this origin
// and sends nothing anywhere at all.
// ═══════════════════════════════════════════════════════════════

// Bump after changing index.html. Not strictly required — the shell
// refreshes itself on the next open either way — but it throws the old
// copy away cleanly.
const VERSION = "v1";
const CACHE = "day-count-" + VERSION;

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

// Cache first, so it opens instantly and works with no signal, then
// quietly refresh the stored copy — a new deploy is picked up the next
// time the app is opened, not this time.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

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

// ── milestone alerts ─────────────────────────────────────────
// Android gives a web app no alarm clock. Web Push would be precise but
// needs a server that knows your dates, and this app refuses to have
// one. So alerts ride on Periodic Background Sync: Chrome wakes the
// installed app when it feels like it, and this decides whether any
// flagged date has crossed a marker since it last looked. That means an
// alert can be hours late, or never arrive — it's a nudge, not a
// reminder you can lean on.
const DAY = 86400000;
const MILESTONES = [100, 50, 30, 14, 7, 3, 2, 1, 0];   // mirrored in index.html
const MIN_GAP = 4 * 60 * 60 * 1000;                    // quiet for this long after speaking
const WAKE_FROM = 8, WAKE_TO = 22;                     // nobody wants this at 4am
const MAX_PER_WAKE = 3;

// The page owns this database; the worker only reads it and writes back
// which markers it has announced. Opened without a version so it can
// never trigger an upgrade of its own.
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("day-count");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function once(rq) {
  return new Promise((res) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); });
}

// Same calendar-day arithmetic as the page: snap both ends to local
// midnight, because the days the clocks change aren't 24 hours long.
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (a, b) => Math.round((midnight(b) - midnight(a)) / DAY);

function shiftYear(base, year) {
  const m = base.getMonth(), d = base.getDate();
  const c = new Date(year, m, d);
  if (c.getMonth() !== m) return new Date(year, m + 1, 0);   // 29 Feb → 28 Feb
  return c;
}
function occurrence(ev, now) {
  const [y, m, d] = ev.date.split("-").map(Number);
  const base = new Date(y, m - 1, d);
  if (ev.repeat !== "year") return base;
  const today = midnight(now);
  let cand = shiftYear(base, today.getFullYear());
  if (cand < today) cand = shiftYear(base, today.getFullYear() + 1);
  return cand;
}

function line(title, days) {
  if (days === 0) return `${title} — today.`;
  if (days === 1) return `${title} — tomorrow.`;
  return `${title} — ${days} days away.`;
}

async function checkDates() {
  const db = await openDB().catch(() => null);
  if (!db || !db.objectStoreNames.contains("prefs") || !db.objectStoreNames.contains("events")) return;

  const prefs = await once(db.transaction("prefs").objectStore("prefs").get("settings"));
  if (!prefs || !prefs.alerts) return;

  const now = new Date();
  const h = now.getHours();
  if (h < WAKE_FROM || h >= WAKE_TO) return;
  if (now.getTime() - (prefs.last || 0) < MIN_GAP) return;

  const events = await once(db.transaction("events").objectStore("events").getAll());
  if (!events || !events.length) return;

  const due = [];
  for (const ev of events) {
    if (!ev.alert) continue;
    const occ = occurrence(ev, now);
    const days = daysBetween(now, occ);
    if (days < 0) continue;

    // Every marker at or above the current distance has been reached;
    // the smallest of them is the one just crossed. Announce that one
    // and mark the lot, so a stretch of wake-ups doesn't work backwards
    // through the list announcing 100 days out on the day itself.
    const reached = MILESTONES.filter((m) => days <= m);
    if (!reached.length) continue;
    const latest = Math.min.apply(null, reached);

    // Repeating events come round again, so the marks are tagged with
    // the year they belong to rather than being permanent.
    const cycle = ev.repeat === "year" ? occ.getFullYear() : "one";
    const keys = reached.map((m) => cycle + ":" + m);
    const marked = Array.isArray(ev.marked) ? ev.marked : [];
    if (marked.includes(cycle + ":" + latest)) continue;

    due.push({ ev, days, marked: marked.concat(keys.filter((k) => !marked.includes(k))) });
  }
  if (!due.length) return;

  due.sort((a, b) => a.days - b.days);
  const speak = due.slice(0, MAX_PER_WAKE);

  // Write the marks back before showing anything: a notification that
  // fails to appear is a nuisance, one that appears four times is worse.
  const wtx = db.transaction(["events", "prefs"], "readwrite");
  for (const d of speak) wtx.objectStore("events").put({ ...d.ev, marked: d.marked });
  wtx.objectStore("prefs").put({ ...prefs, last: now.getTime() });
  await new Promise((res) => { wtx.oncomplete = res; wtx.onerror = res; });

  for (const d of speak) {
    await self.registration.showNotification("Day Count", {
      body: line(d.ev.title, d.days),
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: "milestone-" + d.ev.id,
      data: { url: "./" },
    });
  }

  // While we're awake, put the nearest count on the icon too.
  try {
    if (prefs.badge && "setAppBadge" in self.navigator) {
      const next = events
        .map((ev) => daysBetween(now, occurrence(ev, now)))
        .filter((n) => n >= 0)
        .sort((a, b) => a - b)[0];
      if (next === undefined) await self.navigator.clearAppBadge();
      else await self.navigator.setAppBadge(next);
    }
  } catch (err) {}
}

self.addEventListener("periodicsync", (e) => {
  if (e.tag === "countdown") e.waitUntil(checkDates());
});

// Tapping an alert should land on the count, reusing the window if one
// is already open rather than stacking up another.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of open) {
      if (c.url.startsWith(self.registration.scope)) return c.focus();
    }
    return self.clients.openWindow(new URL("./", self.location.href).href);
  })());
});
