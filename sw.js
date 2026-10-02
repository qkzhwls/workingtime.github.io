// === sw.js === 서비스워커 (PWA)
// 전략: network-first (온라인이면 항상 최신 → 잦은 배포에도 stale 없음).
//        네트워크 실패(오프라인) 시에만 마지막으로 캐시된 응답을 제공.
// 주의: 크로스오리진(Firebase/구글 CDN/Apps Script) 요청에는 관여하지 않음(그대로 네트워크).
const CACHE = 'work-app-v2';

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    let url;
    try { url = new URL(req.url); } catch (e) { return; }
    if (url.origin !== self.location.origin) return; // 크로스오리진은 SW 미관여

    // cache:'no-cache' → 서버와 항상 재검증(변경 시 200, 미변경 시 304). 온라인이면 stale 없음.
    event.respondWith(
        fetch(req, { cache: 'no-cache' })
            .then(res => {
                if (res && res.ok && res.type === 'basic') {
                    const copy = res.clone();
                    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
                }
                return res;
            })
            .catch(() => caches.match(req).then(m => m || Promise.reject(new Error('offline & uncached'))))
    );
});
