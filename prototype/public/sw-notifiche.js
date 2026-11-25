/* Importato dal Service Worker generato (workbox importScripts).
 * Tocco su un avviso di sistema: porta in primo piano l'app e apre la pagina collegata. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/notifiche';
  const url = new URL(self.registration.scope);
  url.hash = '#' + link;
  event.waitUntil((async () => {
    const finestre = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of finestre) {
      if (c.url.startsWith(self.registration.scope)) {
        await c.focus();
        if ('navigate' in c) return c.navigate(url.href);
        return undefined;
      }
    }
    return self.clients.openWindow(url.href);
  })());
});
