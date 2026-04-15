// PayFlow AP - Service Worker v1.0.0
const CACHE_NAME = 'payflow-ap-v1';
const STATIC_CACHE_NAME = 'payflow-static-v1';
const DYNAMIC_CACHE_NAME = 'payflow-dynamic-v1';

// App Shell - Critical resources for offline functionality
const APP_SHELL = [
  '/',
  '/auth/login',
  '/manifest.json',
  '/icons/icon-192x192.jpg',
  '/icons/icon-512x512.jpg',
];

// Install Event - Cache app shell
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching app shell...');
        // Cache what we can, don't fail if some resources aren't available
        return Promise.allSettled(
          APP_SHELL.map((url) => 
            cache.add(url).catch((err) => {
              console.log(`[SW] Failed to cache ${url}:`, err);
            })
          )
        );
      })
      .then(() => {
        console.log('[SW] App shell cached successfully');
        return self.skipWaiting();
      })
  );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => {
              // Delete old versions of our caches
              return name.startsWith('payflow-') && 
                     name !== STATIC_CACHE_NAME && 
                     name !== DYNAMIC_CACHE_NAME;
            })
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Service worker activated');
        return self.clients.claim();
      })
  );
});

// Fetch Event - Network-first with cache fallback strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip cross-origin requests (except for fonts/icons)
  if (url.origin !== location.origin) {
    // Allow caching of external fonts
    if (!url.hostname.includes('fonts.googleapis.com') && 
        !url.hostname.includes('fonts.gstatic.com')) {
      return;
    }
  }
  
  // Skip API routes and auth-related requests
  if (url.pathname.startsWith('/api/') || 
      url.pathname.includes('supabase') ||
      url.pathname.includes('auth')) {
    return;
  }

  // For navigation requests (HTML pages) - Network first, cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone and cache successful responses
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(DYNAMIC_CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Try cache, then fallback to offline page
          return caches.match(request)
            .then((cachedResponse) => {
              if (cachedResponse) {
                return cachedResponse;
              }
              // Return cached home page as fallback
              return caches.match('/');
            });
        })
    );
    return;
  }

  // For static assets (JS, CSS, images) - Stale while revalidate
  if (request.destination === 'script' || 
      request.destination === 'style' || 
      request.destination === 'image' ||
      request.destination === 'font') {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          const fetchPromise = fetch(request)
            .then((networkResponse) => {
              if (networkResponse.ok) {
                const responseClone = networkResponse.clone();
                caches.open(STATIC_CACHE_NAME).then((cache) => {
                  cache.put(request, responseClone);
                });
              }
              return networkResponse;
            })
            .catch(() => cachedResponse);
          
          // Return cached version immediately, update in background
          return cachedResponse || fetchPromise;
        })
    );
    return;
  }

  // Default: Network first with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(DYNAMIC_CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// Handle messages from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((cacheNames) => {
      cacheNames.forEach((name) => {
        if (name.startsWith('payflow-')) {
          caches.delete(name);
        }
      });
    });
  }
});

// Background sync for offline invoice submissions (future enhancement)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-invoices') {
    console.log('[SW] Background sync: invoices');
    // Future: Implement offline invoice queue sync
  }
});

// Push notifications (future enhancement)
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  const data = event.data.json();
  const options = {
    body: data.body || 'New notification from PayFlow AP',
    icon: '/icons/icon-192x192.jpg',
    badge: '/icons/icon-192x192.jpg',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/',
    },
    actions: data.actions || [],
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'PayFlow AP', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const url = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Try to focus an existing window
        for (const client of clientList) {
          if (client.url === url && 'focus' in client) {
            return client.focus();
          }
        }
        // Open new window if none found
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});
