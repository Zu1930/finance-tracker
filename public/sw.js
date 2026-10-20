/**
 * Service worker: офлайн-просмотр и push-уведомления. Без зависимостей.
 * Страницы и /api/data — сначала сеть, без связи — последняя сохранённая копия.
 * /_next/static — из кеша: имена файлов с хешем, содержимое не меняется.
 * Остальное API — только сеть: записи без связи ставит в очередь само приложение.
 */
const CACHE = "ft-v1";
// Ответ /api/data из кеша помечается заголовком: приложение показывает «нет связи» и время данных
const OFFLINE_HEADER = "x-ft-offline";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

async function networkFirst(req, mark) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    // Не кешируем редирект на /login и ошибки: офлайн должен показывать последние настоящие данные
    if (res.ok && !res.redirected) {
      const copy = res.clone();
      const headers = new Headers(copy.headers);
      headers.set("x-ft-saved-at", new Date().toISOString());
      await cache.put(req, new Response(await copy.blob(), { status: copy.status, headers }));
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === "navigate" });
    if (!hit) throw err;
    if (!mark) return hit;
    const headers = new Headers(hit.headers);
    headers.set(OFFLINE_HEADER, "1");
    return new Response(await hit.blob(), { status: 200, headers });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // ponytail: старые файлы /_next/static копятся в кеше; чистить по манифесту сборки, если кеш станет заметным
  if (url.pathname.startsWith("/_next/static/")) return e.respondWith(cacheFirst(req));
  if (url.pathname === "/api/data") return e.respondWith(networkFirst(req, true));
  if (url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") return e.respondWith(networkFirst(req, false));
});

// ---------- Push ----------
self.addEventListener("push", (e) => {
  const d = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(d.title || "SPEND.LOG", {
      body: d.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: d.tag,
      data: { url: d.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const win = wins.find((w) => w.url.startsWith(self.location.origin));
      if (win) {
        await win.focus();
        return win.navigate(url);
      }
      return self.clients.openWindow(url);
    })(),
  );
});
