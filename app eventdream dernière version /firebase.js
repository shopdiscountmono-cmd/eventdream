import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, createUserWithEmailAndPassword, signOut as fbSignOut } from "firebase/auth";
import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";
import { getFunctions, httpsCallable } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyD4WXB0wFeDtakmUC2uUGEeDutKlBuG8cU",
  authDomain: "eventdream-app.firebaseapp.com",
  projectId: "eventdream-app",
  storageBucket: "eventdream-app.firebasestorage.app",
  messagingSenderId: "881676818782",
  appId: "1:881676818782:web:77b339331ef984d25fd7cf"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Région où sont déployées les Cloud Functions (doit correspondre à functions/index.js)
const functionsInstance = getFunctions(app, "europe-west9");

// Envoie une campagne email (objet + contenu HTML + liste des ids clients destinataires).
// La clé API Brevo reste côté serveur (secret Cloud Functions), jamais exposée au navigateur.
export async function sendCampaignEmail({ subject, htmlBody, recipientIds }) {
  const fn = httpsCallable(functionsInstance, "sendCampaign");
  const res = await fn({ subject, htmlBody, recipientIds });
  return res.data;
}

// Application secondaire dédiée à la création de comptes :
// elle permet de créer un nouvel utilisateur SANS déconnecter le compte courant.
const secondaryApp = initializeApp(firebaseConfig, "secondary");
const secondaryAuth = getAuth(secondaryApp);

// Crée un compte employé sans changer la session de l'admin connecté.
export async function createUserAsAdmin(email, password) {
  await createUserWithEmailAndPassword(secondaryAuth, email, password);
  await fbSignOut(secondaryAuth);
}

// ───────────────────────────────────────────────
// Notifications push (Firebase Cloud Messaging)
// ───────────────────────────────────────────────

// Clé VAPID générée dans Firebase Console > Paramètres > Cloud Messaging > Web Push
const VAPID_KEY = "BEnXd2sVehCiYcgH2kv7kBEDMnmjpZkLrp79UljuKC31RiokhlTyys0iVj7EYLa-ZtPuu_4MKG-VTBfBNIxwhM8";

// Demande la permission de notification à l'utilisateur, enregistre le service worker
// dédié, et retourne le token FCM de cet appareil (ou null si refusé / non supporté).
export async function registerPushNotifications() {
  try {
    const supported = await isSupported();
    if (!supported) {
      console.warn("Notifications push non supportées sur cet appareil/navigateur.");
      return null;
    }
    if (!("Notification" in window)) return null;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;

    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    return token || null;
  } catch (err) {
    console.error("Erreur lors de l'enregistrement aux notifications push :", err);
    return null;
  }
}

// Écoute les notifications reçues quand l'app est ouverte au premier plan
// (callback appelé avec le payload reçu).
export async function listenForegroundMessages(callback) {
  try {
    const supported = await isSupported();
    if (!supported) return;
    const messaging = getMessaging(app);
    onMessage(messaging, callback);
  } catch (err) {
    console.error("Erreur listenForegroundMessages :", err);
  }
}
