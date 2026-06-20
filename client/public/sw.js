// DH SCUBA Photo Gallery — Minimal Service Worker
// Required for PWA install prompt (beforeinstallprompt event)
// No caching: photos are served fresh from the server

self.addEventListener('install', () => {
  // Skip waiting so activation happens immediately
  self.skipWaiting();
});

self.addEventListener('activate', () => {
  // Claim all clients so the SW controls the page immediately
  self.clients.claim();
});

// No fetch handler — let all requests pass through to the network