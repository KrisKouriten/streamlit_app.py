/* Minimal service worker for installability.
 * Deliberately does NOT cache anything — this is an authenticated finance app,
 * and a stale cached shell could show the wrong data or a logged-in view to the
 * wrong person. Its only job is to exist with a fetch handler so browsers offer
 * the "install as app" experience. Requests pass straight through to the network. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Pass-through: no offline cache by design.
});
