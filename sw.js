/* ═══════════════════════════════════════════════════════════════
   GEOPORTAL APS — Service Worker v2.0
   Corporación Biocomercio Sostenible
   Estrategia: Cache-First para assets estáticos,
               Network-First para datos Supabase,
               Cola offline para envíos de campo.
═══════════════════════════════════════════════════════════════ */

const CACHE_NAME   = 'geoportal-aps-v9';
const CACHE_STATIC = 'geoportal-static-v9';
const CACHE_TILES  = 'geoportal-tiles-v1';

/* Assets que se cachean al instalar */
const STATIC_ASSETS = [
  './index.html',
  './app.html',
  './reporte.html',
  './campo.html',
  './manifest.json',
  './manifest-campo.json',
  /* CDN críticos — se cachean en primera visita */
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js',
  'https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap'
];

/* ── INSTALL: pre-cachear assets críticos ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      /* Cachear cada asset individualmente — ignorar fallos de CDN */
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(() => { /* CDN puede fallar en primer install */ })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/* ── ACTIVATE: limpiar caches antiguas ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => ![CACHE_NAME, CACHE_STATIC, CACHE_TILES].includes(k))
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH: estrategia por tipo de request ── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* 1. Tiles de mapa → Cache-First (tiles son estáticos por zoom/coord) */
  if (
    url.hostname.includes('google.com') ||
    url.hostname.includes('arcgisonline.com') ||
    url.hostname.includes('opentopomap.org') ||
    url.hostname.includes('tile.openstreetmap.org')
  ) {
    event.respondWith(
      caches.open(CACHE_TILES).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(resp => {
            if (resp.ok) cache.put(event.request, resp.clone());
            return resp;
          }).catch(() => cached || new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  /* 2. Supabase API → Network-First (datos siempre frescos) */
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request.clone())
        .then(resp => resp)
        .catch(() => {
          /* Si falla, devolver respuesta vacía para que qSave encole */
          return new Response(JSON.stringify({ data: [], error: { message: 'offline' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  /* 3. Google Fonts → Cache-First */
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_STATIC).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(resp => {
            if (resp.ok) cache.put(event.request, resp.clone());
            return resp;
          }).catch(() => cached || new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  /* 4. CDN JS/CSS → Cache-First */
  if (
    url.hostname.includes('cdn.jsdelivr.net') ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('cdnjs.cloudflare.com')
  ) {
    event.respondWith(
      caches.open(CACHE_STATIC).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(resp => {
            if (resp.ok) cache.put(event.request, resp.clone());
            return resp;
          }).catch(() => cached || new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  /* 5. Archivos locales (HTML/CSS/JS) → Network-First para reflejar cambios */
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request).then(resp => {
        if (resp.ok) {
          caches.open(CACHE_STATIC).then(cache => cache.put(event.request, resp.clone()));
        }
        return resp;
      }).catch(() =>
        caches.match(event.request)
      )
    );
    return;
  }
});

/* ── BACKGROUND SYNC: reintentar cola offline ── */
self.addEventListener('sync', event => {
  if (event.tag === 'sync-queue') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage({ type: 'SYNC_REQUEST' }));
      })
    );
  }
});

/* ── PUSH NOTIFICATIONS (futuro) ── */
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || 'Geoportal APS', {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/badge-72.png',
    tag: 'aps-notif'
  });
});
