// A service worker that would answer every request with its own words. It must never be registered.
self.addEventListener("fetch", (event) => {
  event.respondWith(new Response("Answered by the service worker"));
});
