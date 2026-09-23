/* Score It — offline support. Network first, so a deploy shows up on the next launch
   with no version to bump; the cache only answers when the network can't. */
const CACHE = "score-it";
const FILES = [
  "./", "index.html", "styles.css", "app.js", "manifest.json",
  "icon.svg", "icon-180.png", "icon-192.png", "icon-512.png",
];
const TIMEOUT = 3000;   // past this a flaky connection gets the cached copy
let stalledUntil = 0;   // after one timeout, the page's other files skip the wait

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
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

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;

  // "no-cache" revalidates past the browser's HTTP cache (Pages serves max-age=600),
  // otherwise a fresh deploy could hide behind a stale copy for ten minutes.
  const net = fetch(req, { cache: "no-cache" }).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  });
  e.waitUntil(net.catch(() => {}));   // a slow response still lands in the cache

  const cached = () => caches.match(req, { ignoreSearch: true })
    .then((hit) => hit || (req.mode === "navigate" ? caches.match("./") : undefined));

  e.respondWith(new Promise((resolve, reject) => {
    const wait = Date.now() < stalledUntil ? 0 : TIMEOUT;
    const timer = setTimeout(() => {
      stalledUntil = Date.now() + 10000;
      cached().then((hit) => hit && resolve(hit));
    }, wait);
    net.then((res) => { clearTimeout(timer); resolve(res); })
      .catch(() => { clearTimeout(timer); cached().then((hit) => hit ? resolve(hit) : reject()); });
  }));
});
