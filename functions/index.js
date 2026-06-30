const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { getStorage } = require("firebase-admin/storage");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions");
const { google } = require("googleapis");

const BREVO_API_KEY = defineSecret("BREVO_API_KEY");

initializeApp();
const db = getFirestore();
const REGION = "europe-west9";
// Cloud Scheduler (utilisé par onSchedule) ne supporte pas europe-west9 : on utilise une région
// voisine compatible pour la fonction planifiée uniquement. Aucun impact sur les données (toujours
// stockées sur Firestore europe-west9) ni sur la fonction de validation, qui reste en europe-west9.
const SCHEDULER_REGION = "europe-west1";
// Compte de service par défaut du projet, utilisé pour s'authentifier auprès de Google Sheets
// sans gérer de clé/secret manuellement (le Sheet doit être partagé en Éditeur avec cette adresse).
const SHEETS_SERVICE_ACCOUNT = "eventdream-app@appspot.gserviceaccount.com";

// Statuts de commande considérés "actifs" (alignés sur la logique du tableau de bord App.jsx)
const ACTIVE_STATUSES = ["Confirmée", "Préparée", "En livraison", "Livrée", "En cours"];

// ───────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────

// Lit la liste BRUTE des tokens d'appareils enregistrés (app/pushTokens → value: [{token, userEmail, ...}])
// et retire les doublons (même token présent plusieurs fois → notifications en double sinon).
// Ne fait AUCUN filtrage par rôle ici : c'est sendToAll qui s'en occupe selon le besoin.
async function getTokenEntries() {
  const ref = db.collection("app").doc("pushTokens");
  const snap = await ref.get();
  const value = snap.exists ? snap.data().value : [];
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const deduped = value.filter(t => {
    if (!t.token || seen.has(t.token)) return false;
    seen.add(t.token);
    return true;
  });
  if (deduped.length !== value.length) {
    await ref.set({ value: deduped });
    logger.info(`Nettoyage : ${value.length - deduped.length} token(s) en double retiré(s) de Firestore.`);
  }
  return deduped;
}

// Lit la table des rôles (app/userRoles → value: {"email": "livreur"|"admin"}).
// Un email absent de cette table est considéré "admin" par défaut (cohérent avec App.jsx).
async function getRoleMap() {
  const snap = await db.collection("app").doc("userRoles").get();
  const value = snap.exists ? snap.data().value : {};
  return (value && typeof value === "object" && !Array.isArray(value)) ? value : {};
}

// Retire les tokens devenus invalides (désinstallation, permission révoquée...)
async function cleanupInvalidTokens(invalidTokens) {
  if (!invalidTokens.length) return;
  const ref = db.collection("app").doc("pushTokens");
  const snap = await ref.get();
  const value = snap.exists ? snap.data().value : [];
  if (!Array.isArray(value)) return;
  const cleaned = value.filter(t => !invalidTokens.includes(t.token));
  if (cleaned.length !== value.length) {
    await ref.set({ value: cleaned });
    logger.info(`Nettoyage : ${value.length - cleaned.length} token(s) invalide(s) retiré(s).`);
  }
}

// Envoie une notification aux appareils enregistrés, et nettoie les tokens invalides.
// options.excludeRoles : liste de rôles à exclure de CETTE notification précise (ex: ["livreur"]
// pour "Commande validée", qui ne les concerne pas) — n'affecte pas le stockage des tokens.
// IMPORTANT : message "data-only" (pas de champ "notification") — sinon le navigateur affiche
// automatiquement une notification EN PLUS de celle affichée par notre service worker,
// causant un double affichage sur chaque appareil.
async function sendToAll(title, body, data = {}, options = {}) {
  const excludeRoles = options.excludeRoles || [];
  let entries = await getTokenEntries();
  if (excludeRoles.length) {
    const roles = await getRoleMap();
    entries = entries.filter(t => {
      const email = (t.userEmail || "").toLowerCase();
      const role = roles[email] || "admin";
      return !excludeRoles.includes(role);
    });
  }
  const tokens = entries.map(t => t.token);
  if (!tokens.length) {
    logger.info("Aucun appareil destinataire pour cette notification.");
    return;
  }
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    data: { title, body, ...data },
    webpush: { fcmOptions: { link: "/" } },
  });
  const invalid = [];
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
        invalid.push(tokens[i]);
      }
    }
  });
  await cleanupInvalidTokens(invalid);
  logger.info(`Notification envoyée : "${title}" — ${res.successCount}/${tokens.length} succès.`);
}

function fmtDateFr(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// ───────────────────────────────────────────────────────────
// 1) Notification à la validation d'une commande (Devis → Confirmée)
// ───────────────────────────────────────────────────────────
exports.onOrderValidated = onDocumentWritten(
  { document: "app/orders", region: REGION },
  async (event) => {
    const before = event.data.before.exists ? event.data.before.data().value : [];
    const after = event.data.after.exists ? event.data.after.data().value : [];
    if (!Array.isArray(after)) return;

    // Vérifie le réglage global avant de faire quoi que ce soit
    const settingsSnap = await db.collection("app").doc("settings").get();
    const settings = settingsSnap.exists ? settingsSnap.data().value : {};
    if (settings && settings.notifyOnValidation === false) return;

    const beforeById = new Map((Array.isArray(before) ? before : []).map(o => [o.id, o]));

    const newlyValidated = after.filter(o => {
      if (o.status !== "Confirmée") return false;
      const prev = beforeById.get(o.id);
      return !prev || prev.status !== "Confirmée";
    });
    if (!newlyValidated.length) return;

    // Protection anti-doublon : Eventarc peut parfois livrer le même évènement deux fois.
    // On mémorise les commandes déjà notifiées pour ignorer une éventuelle 2e livraison.
    const notifiedRef = db.collection("app").doc("notifiedAlerts");
    const notifiedSnap = await notifiedRef.get();
    const notified = notifiedSnap.exists ? (notifiedSnap.data().value || {}) : {};
    const newKeys = {};

    for (const order of newlyValidated) {
      const alertKey = `${order.id}:validation`;
      if (notified[alertKey]) continue;
      const when = order.deliveryDate ? ` — ${fmtDateFr(order.deliveryDate)}` : "";
      await sendToAll(
        "✅ Commande validée",
        `${order.clientName || "Client"}${when}`,
        { orderId: order.id, kind: "validation" },
        { excludeRoles: ["livreur"] }
      );
      newKeys[alertKey] = true;
    }

    if (Object.keys(newKeys).length) {
      await notifiedRef.set({ value: { ...notified, ...newKeys } });
    }
  }
);

// ───────────────────────────────────────────────────────────
// 2) Vérification planifiée : livraison / retrait / retour qui approchent
//    Tourne toutes les 15 minutes.
// ───────────────────────────────────────────────────────────
exports.checkUpcomingDates = onSchedule(
  { schedule: "every 15 minutes", region: SCHEDULER_REGION, timeZone: "Europe/Paris" },
  async () => {
    const [ordersSnap, settingsSnap, notifiedSnap] = await Promise.all([
      db.collection("app").doc("orders").get(),
      db.collection("app").doc("settings").get(),
      db.collection("app").doc("notifiedAlerts").get(),
    ]);

    const orders = ordersSnap.exists ? ordersSnap.data().value : [];
    const settings = settingsSnap.exists ? settingsSnap.data().value : {};
    const notified = notifiedSnap.exists ? (notifiedSnap.data().value || {}) : {};
    if (!Array.isArray(orders) || !orders.length) return;

    const now = new Date();
    const toNotify = []; // { key, title, body, order }
    const newNotifiedKeys = {};

    for (const order of orders) {
      if (!ACTIVE_STATUSES.includes(order.status)) continue;

      // Détermine quel évènement (livraison / retrait / retour) surveiller pour cette commande,
      // en fonction de la phase en cours (alignée sur la logique du tableau de bord).
      let kind = null, targetDate = null, targetTime = null;
      if (order.phase === "retour") {
        kind = "retour";
        targetDate = order.returnDate;
        targetTime = order.returnTime;
      } else if (order.deliveryMode === "livraison") {
        kind = "livraison";
        targetDate = order.deliveryDate;
        targetTime = order.deliveryTime;
      } else {
        kind = "retrait";
        targetDate = order.deliveryDate;
        targetTime = order.deliveryTime;
      }

      // "Préparation" est un évènement indépendant et supplémentaire : il concerne le départ
      // (deliveryDate) quel que soit le mode (livraison ou retrait), tant que la commande n'est
      // pas encore passée en phase retour — alignée sur la carte "À préparer" du tableau de bord.
      const checks = [{ kind, targetDate, targetTime }];
      if (order.phase !== "retour" && order.deliveryDate) {
        checks.push({ kind: "preparation", targetDate: order.deliveryDate, targetTime: order.deliveryTime });
      }

      for (const check of checks) {
        processEventCheck(order, check, settings, now, notified, newNotifiedKeys, toNotify);
      }
    }

    if (!toNotify.length) return;

    for (const n of toNotify) {
      await sendToAll(n.title, n.body, { orderId: n.order.id, kind: "approche" });
    }

    // Mémorise les alertes déjà envoyées pour ne pas les renvoyer en boucle
    await db.collection("app").doc("notifiedAlerts").set({ value: { ...notified, ...newNotifiedKeys } });
  }
);

// Évalue un évènement (livraison / retrait / retour / préparation) pour une commande : vérifie
// si le réglage est activé, calcule les délais configurés, et ajoute à toNotify les alertes dont
// l'heure est venue (sans jamais répéter une alerte déjà envoyée, via notified/newNotifiedKeys).
function processEventCheck(order, check, settings, now, notified, newNotifiedKeys, toNotify) {
  const { kind, targetDate, targetTime } = check;
  const enabledKey = { livraison: "notifLivraisonEnabled", retrait: "notifRetraitEnabled", retour: "notifRetourEnabled", preparation: "notifPreparationEnabled" }[kind];
  if (!settings || settings[enabledKey] === false) return;
  if (!targetDate) return;

  // Liste des délais (en heures) pour ce type — rétrocompatible avec l'ancien champ unique
  // (notifXHeures) pour les réglages enregistrés avant le passage aux délais multiples.
  const delaisKey = { livraison: "notifLivraisonDelais", retrait: "notifRetraitDelais", retour: "notifRetourDelais", preparation: "notifPreparationDelais" }[kind];
  const legacyKey = { livraison: "notifLivraisonHeures", retrait: "notifRetraitHeures", retour: "notifRetourHeures", preparation: "notifPreparationHeures" }[kind];
  let delais = Array.isArray(settings[delaisKey]) && settings[delaisKey].length ? settings[delaisKey] : null;
  if (!delais) {
    const legacy = Number(settings[legacyKey]);
    delais = [Number.isFinite(legacy) ? legacy : 24];
  }

  const target = new Date(`${targetDate}T${targetTime || "09:00"}:00`);
  const hoursUntil = (target.getTime() - now.getTime()) / 3600000;

  for (const seuilHeures of delais) {
    // Chaque délai a sa propre clé (inclut le délai), pour se déclencher indépendamment
    // des autres délais configurés sur le même évènement (ex: 24h ET 2h avant).
    const alertKey = `${order.id}:${kind}:${seuilHeures}`;
    if (hoursUntil <= seuilHeures && hoursUntil > -1 && !notified[alertKey]) {
      const labels = { livraison: "🚚 Livraison à venir", retrait: "🏪 Retrait à venir", retour: "↩️ Retour à venir", preparation: "📦 Commande à préparer" };
      const title = labels[kind];
      const body = `${order.clientName || "Client"} — ${fmtDateFr(targetDate)}${targetTime ? " à " + targetTime : ""}`;
      toNotify.push({ key: alertKey, title, body, order });
      newNotifiedKeys[alertKey] = true;
    }
  }
}

// ───────────────────────────────────────────────────────────
// 3) Synchronisation temps réel vers Google Sheets (Commandes + Dépenses)
// ───────────────────────────────────────────────────────────

async function getSheetId() {
  const snap = await db.collection("app").doc("settings").get();
  const settings = snap.exists ? snap.data().value : {};
  return settings && settings.googleSheetId ? String(settings.googleSheetId).trim() : null;
}

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

function fmtItemsList(items) {
  return (items || []).map(i => `${i.qty}× ${i.name}`).join(", ");
}

async function writeSheetTab(sheetId, tabName, rows) {
  const sheets = await getSheetsClient();
  try {
    await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: `${tabName}!A:Z` });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId, range: `${tabName}!A1`, valueInputOption: "RAW",
      requestBody: { values: rows },
    });
  } catch (err) {
    logger.error(`Erreur écriture Google Sheet (onglet ${tabName}) :`, err.message);
  }
}

// Garde-fou : empêche de répercuter une suppression massive/accidentelle de Firestore sur le
// Google Sheet (qui doit rester une sécurité de secours, pas un miroir fidèle d'un effacement).
// Si le nombre de lignes chute brutalement (vers 0, ou de plus de moitié), on BLOQUE la synchro
// de cet onglet et on alerte l'équipe, plutôt que d'écraser silencieusement le Sheet.
async function guardAgainstMassDeletion(kind, newCount) {
  const ref = db.collection("app").doc("sheetSyncGuard");
  const snap = await ref.get();
  const state = snap.exists ? (snap.data().value || {}) : {};
  const lastCount = typeof state[kind] === "number" ? state[kind] : null;

  const suspicious = lastCount !== null && lastCount >= 3 && (newCount === 0 || newCount < lastCount * 0.5);
  if (suspicious) {
    logger.error(`⚠️ Synchro Sheet BLOQUÉE pour "${kind}" : passage de ${lastCount} à ${newCount} lignes (suppression massive suspectée).`);
    await sendToAll(
      "⚠️ Synchro Google Sheet suspendue",
      `${kind === "orders" ? "Commandes" : "Dépenses"} : ${lastCount} → ${newCount}. Vérifie qu'il n'y a pas eu de suppression accidentelle.`,
      { kind: "alerte" },
      { excludeRoles: ["livreur"] }
    );
    return true; // bloqué
  }
  await ref.set({ value: { ...state, [kind]: newCount } });
  return false; // ok, pas bloqué
}

async function syncOrdersToSheet() {
  const sheetId = await getSheetId();
  if (!sheetId) return;
  const snap = await db.collection("app").doc("orders").get();
  const orders = snap.exists ? snap.data().value : [];
  if (!Array.isArray(orders)) return;
  if (await guardAgainstMassDeletion("orders", orders.length)) return;

  const rows = [[
    "N° commande", "Statut", "Client", "Téléphone", "Adresse", "Date livraison/retrait",
    "Date retour", "Matériel loué", "Sous-total articles (€)", "Livraison (€)", "Remise (€)",
    "Acompte versé (€)", "Notes",
  ]];
  for (const o of orders) {
    const sousTotal = (o.items || []).reduce((s, i) => s + (parseInt(i.qty) || 0) * (parseFloat(i.price) || 0), 0);
    const livraison = o.deliveryMode === "livraison" ? (parseFloat(o.deliveryPriceManual) || 0) : 0;
    const remise = o.discountType === "percent" ? sousTotal * ((parseFloat(o.discountValue) || 0) / 100) : (parseFloat(o.discountValue) || 0);
    rows.push([
      o.id || "", o.status || "", o.clientName || "", o.clientPhone || "", o.address || "",
      o.deliveryDate || "", o.returnDate || "", fmtItemsList(o.items),
      sousTotal.toFixed(2), livraison.toFixed(2), remise.toFixed(2),
      (parseFloat(o.acompte) || 0).toFixed(2), o.notes || "",
    ]);
  }
  await writeSheetTab(sheetId, "Commandes", rows);
  logger.info(`Google Sheet synchronisé : ${orders.length} commande(s).`);
}

async function syncExpensesToSheet() {
  const sheetId = await getSheetId();
  if (!sheetId) return;
  const snap = await db.collection("app").doc("expenses").get();
  const expenses = snap.exists ? snap.data().value : [];
  if (!Array.isArray(expenses)) return;
  if (await guardAgainstMassDeletion("expenses", expenses.length)) return;

  const rows = [["Date", "Libellé", "Catégorie", "Montant (€)", "Fournisseur", "Moyen de paiement", "Notes"]];
  for (const e of expenses) {
    rows.push([
      e.date || "", e.label || "", e.category || "", (parseFloat(e.amount) || 0).toFixed(2),
      e.supplier || "", e.paymentMethod || "", e.notes || "",
    ]);
  }
  await writeSheetTab(sheetId, "Dépenses", rows);
  logger.info(`Google Sheet synchronisé : ${expenses.length} dépense(s).`);
}

exports.syncOrdersSheet = onDocumentWritten(
  { document: "app/orders", region: REGION, serviceAccount: SHEETS_SERVICE_ACCOUNT },
  async () => { await syncOrdersToSheet(); }
);

exports.syncExpensesSheet = onDocumentWritten(
  { document: "app/expenses", region: REGION, serviceAccount: SHEETS_SERVICE_ACCOUNT },
  async () => { await syncExpensesToSheet(); }
);

// ───────────────────────────────────────────────────────────
// 4) Campagnes email (Brevo) — clé API gardée uniquement côté serveur (secret)
// ───────────────────────────────────────────────────────────

// URL publique de la fonction de désabonnement (callable depuis n'importe quel email envoyé).
const UNSUBSCRIBE_URL = `https://${REGION}-eventdream-app.cloudfunctions.net/unsubscribe`;

exports.sendCampaign = onCall(
  { region: REGION, secrets: [BREVO_API_KEY] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Connexion requise.");
    const email = (request.auth.token.email || "").toLowerCase();
    const rolesSnap = await db.collection("app").doc("userRoles").get();
    const roles = rolesSnap.exists ? (rolesSnap.data().value || {}) : {};
    if (roles[email] === "livreur") {
      throw new HttpsError("permission-denied", "Cette action est réservée aux comptes Admin.");
    }

    const { subject, htmlBody, recipientIds } = request.data || {};
    if (!subject || !htmlBody || !Array.isArray(recipientIds) || !recipientIds.length) {
      throw new HttpsError("invalid-argument", "Objet, contenu et destinataires sont requis.");
    }

    const settingsSnap = await db.collection("app").doc("settings").get();
    const settings = settingsSnap.exists ? settingsSnap.data().value : {};
    const senderEmail = settings.campaignSenderEmail;
    const senderName = settings.campaignSenderName || settings.companyName || "EventDream";
    if (!senderEmail) {
      throw new HttpsError("failed-precondition", "Aucun email expéditeur configuré (Réglages → Campagnes).");
    }

    const clientsSnap = await db.collection("app").doc("clients").get();
    const allClients = clientsSnap.exists ? clientsSnap.data().value : [];
    const targets = (Array.isArray(allClients) ? allClients : []).filter(
      c => recipientIds.includes(c.id) && c.email && !c.unsubscribed
    );

    let sent = 0, failed = 0;
    for (const c of targets) {
      try {
        const personalized = htmlBody
          .replace(/{{nom}}/g, c.name || "")
          .replace(/{{UNSUBSCRIBE_URL}}/g, `${UNSUBSCRIBE_URL}?id=${encodeURIComponent(c.id)}`);
        const res = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": BREVO_API_KEY.value(), "Content-Type": "application/json", "accept": "application/json" },
          body: JSON.stringify({
            sender: { name: senderName, email: senderEmail },
            to: [{ email: c.email, name: c.name || c.email }],
            subject,
            htmlContent: personalized,
          }),
        });
        if (res.ok) sent++; else { failed++; logger.error(`Échec envoi à ${c.email} : ${res.status} ${await res.text()}`); }
      } catch (e) {
        failed++;
        logger.error(`Erreur envoi campagne à ${c.email} :`, e.message);
      }
    }
    logger.info(`Campagne "${subject}" envoyée : ${sent} succès, ${failed} échec(s), ${recipientIds.length - targets.length} ignoré(s) (désabonnés/sans email).`);
    return { sent, failed, skipped: recipientIds.length - targets.length };
  }
);

// Page de désabonnement : un clic sur le lien dans l'email marque le client comme désabonné
// des futures campagnes (n'affecte pas l'envoi de ses devis/factures, qui ne sont pas concernés).
exports.unsubscribe = onRequest({ region: REGION }, async (req, res) => {
  const id = req.query.id;
  if (!id) { res.status(400).send("Lien de désabonnement invalide."); return; }
  try {
    const ref = db.collection("app").doc("clients");
    const snap = await ref.get();
    const clientsList = snap.exists ? snap.data().value : [];
    if (!Array.isArray(clientsList)) { res.status(500).send("Erreur serveur."); return; }
    const updated = clientsList.map(c => c.id === id ? { ...c, unsubscribed: true } : c);
    await ref.set({ value: updated });
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px 20px;">
      <h2>✅ Vous êtes désabonné(e)</h2>
      <p>Vous ne recevrez plus nos emails de campagnes promotionnelles.</p>
    </body></html>`);
  } catch (e) {
    logger.error("Erreur désabonnement :", e.message);
    res.status(500).send("Erreur serveur.");
  }
});

// ───────────────────────────────────────────────────────────
// 5) Suppression automatique des photos (livraison/retour) après la durée de rétention réglée
//    dans Réglages → Divers (settings.photoRetentionDays). Ne touche jamais au commentaire ni
//    à la signature, seulement aux photos (et au fichier réel dans Storage) — économise l'espace
//    sans perdre la preuve écrite/signée.
// ───────────────────────────────────────────────────────────
exports.cleanupOldPhotos = onSchedule(
  { schedule: "every 24 hours", region: SCHEDULER_REGION, timeZone: "Europe/Paris" },
  async () => {
    const [ordersSnap, settingsSnap] = await Promise.all([
      db.collection("app").doc("orders").get(),
      db.collection("app").doc("settings").get(),
    ]);
    const orders = ordersSnap.exists ? ordersSnap.data().value : [];
    const settings = settingsSnap.exists ? settingsSnap.data().value : {};
    const retentionDays = Number(settings.photoRetentionDays);
    if (!Array.isArray(orders) || !orders.length || !retentionDays || retentionDays <= 0) return; // 0 = désactivé

    const now = Date.now();
    const bucket = getStorage().bucket();
    let changed = false;
    let deletedCount = 0;

    const updatedOrders = await Promise.all(orders.map(async (o) => {
      if (o.status !== "Clôturée" || !o.closedAt) return o;
      const ageDays = (now - new Date(o.closedAt).getTime()) / 86400000;
      if (ageDays < retentionDays) return o;
      const hasDeliveryPhotos = Array.isArray(o.deliveryPhotos) && o.deliveryPhotos.length > 0;
      const hasReturnPhotos = Array.isArray(o.returnPhotos) && o.returnPhotos.length > 0;
      if (!hasDeliveryPhotos && !hasReturnPhotos) return o;

      const allUrls = [...(o.deliveryPhotos || []), ...(o.returnPhotos || [])];
      for (const url of allUrls) {
        try {
          const path = decodeURIComponent(new URL(url).pathname.split("/o/")[1].split("?")[0]);
          await bucket.file(path).delete();
          deletedCount++;
        } catch (e) {
          logger.warn(`Photo déjà absente ou erreur suppression (${o.id}) :`, e.message);
        }
      }
      changed = true;
      return { ...o, deliveryPhotos: [], returnPhotos: [] };
    }));

    if (changed) {
      await db.collection("app").doc("orders").set({ value: updatedOrders });
      logger.info(`Nettoyage photos : ${deletedCount} photo(s) supprimée(s) (rétention ${retentionDays} jours).`);
    }
  }
);

// ───────────────────────────────────────────────────────────
// 6) Sauvegarde automatique quotidienne (2h du matin, heure de Paris)
//    Sauvegarde complète : orders, clients, stock, expenses, settings.
//    Conservation des 7 derniers jours (les plus anciennes sont supprimées).
//    En cas d'échec, une notification push est envoyée à l'équipe.
// ───────────────────────────────────────────────────────────
const BACKUP_COLLECTIONS = ["orders", "clients", "stock", "expenses", "settings"];
const BACKUP_RETENTION_DAYS = 7;

exports.dailyBackup = onSchedule(
  { schedule: "0 2 * * *", region: SCHEDULER_REGION, timeZone: "Europe/Paris" },
  async () => {
    try {
      const now = new Date();
      const dateKey = now.toISOString().slice(0, 10); // YYYY-MM-DD
      const backupId = `${dateKey}_${now.toISOString().slice(11, 19).replace(/:/g, "-")}`;

      // Lecture de toutes les collections à sauvegarder
      const backup = { createdAt: now.toISOString(), collections: {} };
      for (const col of BACKUP_COLLECTIONS) {
        const snap = await db.collection("app").doc(col).get();
        backup.collections[col] = snap.exists ? snap.data() : null;
      }
      backup.orderCount = Array.isArray(backup.collections.orders?.value) ? backup.collections.orders.value.length : 0;
      backup.clientCount = Array.isArray(backup.collections.clients?.value) ? backup.collections.clients.value.length : 0;

      // Écriture de la sauvegarde
      await db.collection("backups").doc(backupId).set(backup);
      logger.info(`✅ Sauvegarde ${backupId} : ${backup.orderCount} commandes, ${backup.clientCount} clients.`);

      // Suppression des sauvegardes plus anciennes que BACKUP_RETENTION_DAYS
      const cutoff = new Date(now.getTime() - BACKUP_RETENTION_DAYS * 86400000).toISOString().slice(0, 10);
      const oldSnaps = await db.collection("backups").where("createdAt", "<", cutoff + "T00:00:00.000Z").get();
      const deletions = oldSnaps.docs.map(d => d.ref.delete());
      await Promise.all(deletions);
      if (deletions.length > 0) logger.info(`🗑️ ${deletions.length} ancienne(s) sauvegarde(s) supprimée(s).`);

    } catch (err) {
      logger.error("❌ Échec de la sauvegarde automatique :", err.message);
      await sendToAll("❌ Sauvegarde EventDream échouée", "La sauvegarde automatique a échoué. Vérifiez les logs Firebase.", { kind: "alerte" }, { excludeRoles: ["livreur"] });
    }
  }
);

// Sauvegarde manuelle déclenchée depuis l'app (bouton "Sauvegarder maintenant").
exports.triggerBackup = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Connexion requise.");
  const email = (request.auth.token.email || "").toLowerCase();
  const rolesSnap = await db.collection("app").doc("userRoles").get();
  const roles = rolesSnap.exists ? (rolesSnap.data().value || {}) : {};
  if (roles[email] === "livreur") throw new HttpsError("permission-denied", "Réservé aux admins.");

  const now = new Date();
  const backupId = `${now.toISOString().slice(0, 10)}_${now.toISOString().slice(11, 19).replace(/:/g, "-")}_manual`;
  const backup = { createdAt: now.toISOString(), manual: true, collections: {} };
  for (const col of BACKUP_COLLECTIONS) {
    const snap = await db.collection("app").doc(col).get();
    backup.collections[col] = snap.exists ? snap.data() : null;
  }
  backup.orderCount = Array.isArray(backup.collections.orders?.value) ? backup.collections.orders.value.length : 0;
  backup.clientCount = Array.isArray(backup.collections.clients?.value) ? backup.collections.clients.value.length : 0;
  await db.collection("backups").doc(backupId).set(backup);
  logger.info(`✅ Sauvegarde manuelle ${backupId} : ${backup.orderCount} commandes.`);
  return { backupId, orderCount: backup.orderCount, clientCount: backup.clientCount, createdAt: backup.createdAt };
});

// Restauration d'une sauvegarde (depuis l'app, bouton "Restaurer").
// Écrit d'abord une sauvegarde de sécurité de l'état actuel, puis restaure.
exports.restoreBackup = onCall({ region: REGION, timeoutSeconds: 120 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Connexion requise.");
  const email = (request.auth.token.email || "").toLowerCase();
  const rolesSnap = await db.collection("app").doc("userRoles").get();
  const roles = rolesSnap.exists ? (rolesSnap.data().value || {}) : {};
  if (roles[email] === "livreur") throw new HttpsError("permission-denied", "Réservé aux admins.");

  const { backupId } = request.data || {};
  if (!backupId) throw new HttpsError("invalid-argument", "ID de sauvegarde requis.");

  const backupSnap = await db.collection("backups").doc(backupId).get();
  if (!backupSnap.exists) throw new HttpsError("not-found", "Sauvegarde introuvable.");
  const backup = backupSnap.data();

  // Sauvegarde de sécurité de l'état actuel avant restauration
  const now = new Date();
  const safetyId = `${now.toISOString().slice(0, 10)}_${now.toISOString().slice(11, 19).replace(/:/g, "-")}_pre-restore`;
  const safety = { createdAt: now.toISOString(), preRestore: true, collections: {} };
  for (const col of BACKUP_COLLECTIONS) {
    const snap = await db.collection("app").doc(col).get();
    safety.collections[col] = snap.exists ? snap.data() : null;
  }
  await db.collection("backups").doc(safetyId).set(safety);

  // Restauration de chaque collection
  const cols = backup.collections || {};
  for (const col of BACKUP_COLLECTIONS) {
    if (cols[col]) await db.collection("app").doc(col).set(cols[col]);
  }

  // Réinitialisation du garde-fou Sheet
  const orderCount = Array.isArray(cols.orders?.value) ? cols.orders.value.length : 0;
  await db.collection("app").doc("sheetSyncGuard").set({ value: { orders: orderCount } });

  logger.info(`✅ Restauration ${backupId} effectuée (${orderCount} commandes). Sauvegarde de sécurité : ${safetyId}.`);
  return { success: true, orderCount, safetyBackupId: safetyId };
});

// ───────────────────────────────────────────────────────────
// 8) Déduplication des clients (supprime les doublons par nom)
// ───────────────────────────────────────────────────────────
exports.deduplicateClients = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Connexion requise.");
  const rolesSnap = await db.collection("app").doc("userRoles").get();
  const roles = rolesSnap.exists ? (rolesSnap.data().value || {}) : {};
  const email = (request.auth.token.email || "").toLowerCase();
  if (roles[email] === "livreur") throw new HttpsError("permission-denied", "Réservé aux admins.");

  const snap = await db.collection("app").doc("clients").get();
  const clients = snap.data().value || [];
  
  // Garde le premier client pour chaque nom (en minuscules), fusionne téléphones/adresses
  const seen = new Map();
  let removed = 0;
  
  clients.forEach(c => {
    const key = (c.name || "").toLowerCase().trim();
    if (!key) return;
    if (!seen.has(key)) {
      seen.set(key, { ...c });
    } else {
      // Fusion : on enrichit le client existant avec les infos manquantes
      const existing = seen.get(key);
      const phones = [...new Set([...(existing.phones || [""]), ...(c.phones || [c.phone || ""].filter(Boolean))].filter(Boolean))];
      const addresses = [...new Set([...(existing.addresses || [existing.address || ""].filter(Boolean)), ...(c.addresses || [c.address || ""].filter(Boolean))].filter(Boolean))];
      if (phones.length) existing.phones = phones;
      if (addresses.length) existing.addresses = addresses;
      if (!existing.email && c.email) existing.email = c.email;
      removed++;
    }
  });

  const deduped = Array.from(seen.values());
  await db.collection("app").doc("clients").set({ value: deduped });
  logger.info(`Déduplication clients : ${clients.length} → ${deduped.length} (${removed} supprimés)`);
  return { before: clients.length, after: deduped.length, removed };
});

// ───────────────────────────────────────────────────────────
// 7) Correction ponctuelle des IDs "recovered_xxx" (résidu de la récupération Sheet)
//    Remplace les IDs temporaires par les vrais IDs du stock.
// ───────────────────────────────────────────────────────────
exports.fixRecoveredIds = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Connexion requise.");
  const rolesSnap = await db.collection("app").doc("userRoles").get();
  const roles = rolesSnap.exists ? (rolesSnap.data().value || {}) : {};
  const email = (request.auth.token.email || "").toLowerCase();
  if (roles[email] === "livreur") throw new HttpsError("permission-denied", "Réservé aux admins.");

  const ID_MAP = {
    "recovered_chaise_pliante": "chaise_pliante",
    "recovered_chaise_napoleon": "chaise_napoleon",
    "recovered_table_ronde_180cm": "table_ronde",
    "recovered_table_rectangulaire_240cm": "custom_1781857956581",
    "recovered_nappe": "nappe",
    "recovered_grande_assiette": "grande_assiette",
    "recovered_petite_assiette": "petite_assiette",
    "recovered_fourchette": "fourchette",
    "recovered_couteau": "couteau",
    "recovered_grande_cuillere": "grande_cuillere",
    "recovered_petite_cuillere": "petite_cuillere",
    "recovered_verre_pied": "verre_pied",
    "recovered_verre_eau": "verre_eau",
    "recovered_rechauffe_plat": "rechauffe_plat",
    "recovered_centre_de_table": "centre_de_table",
    "recovered_serviette_de_table": "serviette_de_table",
    "recovered_arche_ronde": "arche_ronde",
    "recovered_backdrop": "backdrop",
  };

  const snap = await db.collection("app").doc("orders").get();
  const orders = snap.data().value || [];
  let fixedOrders = 0, fixedItems = 0;

  const corrected = orders.map(o => {
    if (!o.items || !o.items.some(i => (i.id || "").startsWith("recovered_"))) return o;
    fixedOrders++;
    const newItems = o.items.map(i => {
      const newId = ID_MAP[i.id];
      if (!newId) return i;
      fixedItems++;
      return { ...i, id: newId };
    });
    return { ...o, items: newItems };
  });

  await db.collection("app").doc("orders").set({ value: corrected });
  logger.info(`✅ fixRecoveredIds : ${fixedOrders} commandes, ${fixedItems} articles corrigés.`);
  return { fixedOrders, fixedItems };
});
