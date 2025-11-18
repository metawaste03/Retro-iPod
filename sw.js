const CACHE_NAME = 'retro-youtube-ipod-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/index.tsx',
  '/App.tsx',
  '/types.ts',
  '/components/icons.tsx',
  '/services/youtubeService.ts',
  '/icon.svg',
  'https://cdn.tailwindcss.com',
  'https://www.youtube.com/iframe_api',
  'https://aistudiocdn.com/react@^19.2.0',
  'https://aistudiocdn.com/react-dom@^19.2.0/client',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache and caching app shell');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Cache hit - return response
        if (response) {
          return response;
        }

        const fetchRequest = event.request.clone();

        return fetch(fetchRequest).then(
          (response) => {
            // Don't cache invalid responses or youtube video streams
            const requestUrl = new URL(event.request.url);
            if (!response || response.status !== 200 || (response.type !== 'basic' && response.type !== 'cors') || requestUrl.hostname.includes('googlevideo.com')) {
              return response;
            }

            const responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          }
        );
      })
  );
});

// --- Media Control Communication ---

const broadcastActionToClients = async (action) => {
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  clients.forEach((client) => {
    client.postMessage({ type: 'MEDIA_CONTROL', action });
  });
};

// The service worker doesn't directly receive Media Session API events, as those are handled
// by the main app window. However, this demonstrates how the service worker *would* control
// playback if it received an external event, for example, from a custom notification.
self.addEventListener('notificationclick', (event) => {
  // For a custom notification with actions: actions: [{ action: 'play', title: 'Play' }, ...]
  const validActions = ['play', 'pause', 'nexttrack', 'previoustrack'];
  if (validActions.includes(event.action)) {
    broadcastActionToClients(event.action);
  }
});

// Listens for playback state updates from the app to stay in sync.
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'PLAYBACK_STATE_UPDATE') {
        // The service worker could potentially use this state for other background tasks.
    }
});