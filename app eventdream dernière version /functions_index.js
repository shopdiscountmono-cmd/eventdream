const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
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

      const enabledKey = { livraison: "notifLivraisonEnabled", retrait: "notifRetraitEnabled", retour: "notifRetourEnabled" }[kind];
      if (!settings || settings[enabledKey] === false) continue;
      if (!targetDate) continue;

      // Liste des délais (en heures) pour ce type — rétrocompatible avec l'ancien champ unique
      // (notifXHeures) pour les réglages enregistrés avant le passage aux délais multiples.
      const delaisKey = { livraison: "notifLivraisonDelais", retrait: "notifRetraitDelais", retour: "notifRetourDelais" }[kind];
      const legacyKey = { livraison: "notifLivraisonHeures", retrait: "notifRetraitHeures", retour: "notifRetourHeures" }[kind];
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
          const labels = { livraison: "🚚 Livraison à venir", retrait: "🏪 Retrait à venir", retour: "↩️ Retour à venir" };
          const title = labels[kind];
          const body = `${order.clientName || "Client"} — ${fmtDateFr(targetDate)}${targetTime ? " à " + targetTime : ""}`;
          toNotify.push({ key: alertKey, title, body, order });
          newNotifiedKeys[alertKey] = true;
        }
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
