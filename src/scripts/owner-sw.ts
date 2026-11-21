// Register the owner app's service worker (lets it install and open offline).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {});
}
