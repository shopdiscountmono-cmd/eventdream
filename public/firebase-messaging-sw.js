// firebase-messaging-sw.js
// Service worker dédié aux notifications push EventDream.
// Doit rester à la racine de "public/" pour être servi sur /firebase-messaging-sw.js

importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyD4WXB0wFeDtakmUC2uUGEeDutKlBuG8cU",
  authDomain: "eventdream-app.firebaseapp.com",
  projectId: "eventdream-app",
  storageBucket: "eventdream-app.firebasestorage.app",
  messagingSenderId: "881676818782",
  appId: "1:881676818782:web:77b339331ef984d25fd7cf"
});

const messaging = firebase.messaging();

// Force la nouvelle version du service worker à s'activer immédiatement (sans attendre la
// fermeture totale de tous les onglets/PWA) — sinon les mises à jour de ce fichier peuvent
// rester invisibles pendant longtemps sur certains appareils (notamment iPhone/PWA).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Reçoit la notification quand l'app/onglet est fermé ou en arrière-plan.
// Message "data-only" (voir functions/index.js) : on lit title/body dans payload.data,
// pas dans payload.notification (qui causerait un double affichage automatique).
messaging.onBackgroundMessage((payload) => {
  const title = (payload.data && payload.data.title) || "EventDream";
  const options = {
    body: (payload.data && payload.data.body) || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: payload.data || {},
    vibrate: [200, 100, 200],
  };
  self.registration.showNotification(title, options);
});

// Au clic sur la notification : ouvre ou ramène l'app au premier plan
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clientsArr) => {
      if (clientsArr.length > 0) {
        return clientsArr[0].focus();
      }
      return self.clients.openWindow("/");
    })
  );
});
