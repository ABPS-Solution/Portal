// ═══════════════════════════════════════════════════════════════════════
// sw.js — offline app-shell caching.
//
// WHAT THIS DOES: keeps a copy of the app itself (index.html + its 65
// script files) so that losing connectivity shows the working app instead
// of a blank tab or a browser error page. It does NOT make any API call
// work offline — every apFetch/acFetch request goes straight to the
// network and fails normally when there isn't one. Writes in this system
// are server-authoritative on purpose (stock counts, invoice numbers,
// session state all decided under DB locks), so nothing here queues or
// replays them.
//
// ★ THE STALE-DEPLOY TRAP ★
// index.html deliberately sends `Cache-Control: no-cache, no-store,
// must-revalidate` — added after a real incident where people ran old JS
// against new markup. Those meta tags become INERT once a service worker
// is installed: the SW is the cache authority from then on. So this file
// has to reproduce that guarantee itself, which it does two ways:
//   1. HTML is NETWORK-FIRST. An online user always gets fresh markup,
//      regardless of CACHE_VERSION. Cache is only a fallback for when the
//      network is actually gone.
//   2. JS is cache-first (that's what makes offline work), so it is only
//      safe while CACHE_VERSION rotates on every deploy that changes a
//      script. `.github/workflows/deploy-frontend.yml` fails the build if
//      abps-frontend/** changed and this constant did not — that guard is
//      the thing standing between us and repeating the original bug.
//
// NO PRECACHE LIST, deliberately: caching happens at runtime as files are
// actually requested. A hardcoded list of 65 script paths would silently
// drift the first time someone adds a file. One normal online visit
// populates everything the app uses.
//
// KILL SWITCH: set CACHE_VERSION to the string "OFF" and redeploy — the
// SW then unregisters itself and deletes its caches on next activation.
// A broken service worker is sticky in users' browsers, so this exists to
// avoid needing every user to clear site data by hand.
// ═══════════════════════════════════════════════════════════════════════

const CACHE_VERSION = 'abps-v70';
const CACHE_NAME = `abps-shell-${CACHE_VERSION}`;

self.addEventListener('install', (event) => {
  // Take over as soon as this version is installed rather than waiting
  // for every existing tab to close — paired with clients.claim() below.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (CACHE_VERSION === 'OFF') {
      const names = await caches.keys();
      await Promise.all(names.filter(n => n.startsWith('abps-shell-')).map(n => caches.delete(n)));
      await self.registration.unregister();
      return;
    }
    // Drop every cache from a previous CACHE_VERSION.
    const names = await caches.keys();
    await Promise.all(
      names.filter(n => n.startsWith('abps-shell-') && n !== CACHE_NAME).map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (CACHE_VERSION === 'OFF') return;          // kill switch: behave as if absent
  if (req.method !== 'GET') return;             // never touch API POSTs
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Google/CDN scripts stay untouched
  // The backend is a different origin, so API traffic never reaches here
  // — but be explicit in case that ever changes.
  if (url.pathname.startsWith('/api/') || url.pathname === '/exec') return;

  const isHTML = req.mode === 'navigate' ||
                 (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    // Network-first: preserves the anti-stale-deploy guarantee the
    // no-cache meta tags used to provide.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (_) {
        const cached = await caches.match(req);
        if (cached) return cached;
        // Nothing cached and no network — fall back to the app shell if
        // we have it, so a deep link still renders something usable.
        const shell = await caches.match('./index.html');
        if (shell) return shell;
        throw _;
      }
    })());
    return;
  }

  // Everything else same-origin (the 65 scripts, plus any static asset):
  // cache-first for genuine offline load, revalidating in the background
  // so a same-version edit still propagates on the next visit.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          await cache.put(req, fresh);
        } catch (_) { /* offline — keep serving the cached copy */ }
      })());
      return cached;
    }
    const fresh = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, fresh.clone());
    return fresh;
  })());
});
