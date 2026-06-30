import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, createUserWithEmailAndPassword, signOut as fbSignOut } from "firebase/auth";
import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getStorage, ref, uploadString, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

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

export async function triggerBackup() {
  const fn = httpsCallable(functionsInstance, "triggerBackup");
  const res = await fn({});
  return res.data;
}

export async function restoreBackup(backupId) {
  const fn = httpsCallable(functionsInstance, "restoreBackup");
  const res = await fn({ backupId });
  return res.data;
}

// ───────────────────────────────────────────────────────────
// Stockage des photos et signatures du bon de livraison/retour (Firebase Storage).
// Indispensable pour les photos : les intégrer directement dans Firestore (en base64) ferait
// exploser la taille du document partagé "orders" (limite stricte de 1 Mo chez Firestore).
// ───────────────────────────────────────────────────────────
const storage = getStorage(app);

// Upload d'une signature (dataURL généré par le pad de signature canvas).
export async function uploadSignature(orderId, kind, dataUrl) {
  const path = `signatures/${orderId}_${kind}_${Date.now()}.png`;
  const r = ref(storage, path);
  await uploadString(r, dataUrl, "data_url");
  return await getDownloadURL(r);
}

// Upload d'une photo (fichier issu de l'appareil photo ou de la galerie).
export async function uploadPhoto(orderId, kind, file, index) {
  const ext = (file.type && file.type.split("/")[1]) || "jpg";
  const path = `photos/${orderId}_${kind}_${Date.now()}_${index}.${ext}`;
  const r = ref(storage, path);
  await uploadBytes(r, file);
  return await getDownloadURL(r);
}

// Supprime une photo de Storage à partir de son URL de téléchargement (suppression manuelle
// depuis l'app). Ignore silencieusement si le fichier n'existe déjà plus.
export async function deletePhoto(url) {
  try {
    await deleteObject(ref(storage, url));
  } catch (e) {
    if (e && e.code !== "storage/object-not-found") throw e;
  }
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
