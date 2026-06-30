import { useState, useMemo, useRef, useEffect } from "react";
import React from "react";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import { db, auth, createUserAsAdmin, registerPushNotifications, sendCampaignEmail, uploadSignature, uploadPhoto, deletePhoto, triggerBackup, restoreBackup, fixRecoveredIds, deduplicateClients, findDuplicateClients } from "./firebase";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from "firebase/auth";

// ─── VERSION DE L'APPLICATION ─────────────────────────────────────────────────
// Ce numéro s'affiche en bas des Réglages. Il permet de vérifier qu'on a bien
// collé la dernière version du code. Incrémenté à chaque mise à jour.
const APP_VERSION = "v3.36.2 — recherche croisée doublons clients (téléphone, email, nom similaire) (01/07/2026)";

// ─── SYNCHRONISATION FIRESTORE ────────────────────────────────────────────────
// Chaque jeu de données (commandes, clients, stock...) est stocké dans un
// document Firestore : collection "app" → document <key> → { value: [...] }.
// Lecture en temps réel via onSnapshot, écriture à chaque modification.
function useFirestoreState(key, initialValue) {
  const [value, setValue] = useState(initialValue);
  const valueRef = useRef(initialValue);
  const seededRef = useRef(false);
  // Mémorise si la base a déjà été vue avec des données non vides (anti-écrasement par du vide).
  const hadDataRef = useRef(false);
  // Indique qu'on a reçu au moins une réponse (cache ou serveur) du document.
  const gotSnapshotRef = useRef(false);
  // Dernière version confirmée par le SERVEUR (pas le cache local) — référence fiable pour
  // détecter une écriture basée sur un état périmé (onglet resté ouvert, autre utilisateur, etc.)
  const lastKnownServerRef = useRef(null);

  useEffect(() => {
    const ref = doc(db, "app", key);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const v = snap.data().value;
        valueRef.current = v;
        setValue(v);
        gotSnapshotRef.current = true;
        const nonEmpty = Array.isArray(v) ? v.length > 0 : (v != null && Object.keys(v).length > 0);
        if (nonEmpty) hadDataRef.current = true;
        // On ne met à jour la référence "serveur fiable" que si la donnée vient réellement
        // du serveur (pas d'un cache local potentiellement périmé après une coupure réseau).
        const fromCache = snap.metadata && snap.metadata.fromCache;
        if (!fromCache) lastKnownServerRef.current = v;
      } else if (!seededRef.current && !(snap.metadata && snap.metadata.fromCache)) {
        // Document absent côté serveur : on l'initialise une seule fois.
        seededRef.current = true;
        gotSnapshotRef.current = true;
        setDoc(ref, JSON.parse(JSON.stringify({ value: initialValue })));
      }
    }, (err) => console.error("Firestore sync error:", key, err));
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = (next, allowEmpty) => {
    const v = typeof next === "function" ? next(valueRef.current) : next;

    // PROTECTION anti-écrasement : refuser d'enregistrer du vide si la base contenait des données,
    // SAUF si la mise à jour est explicitement autorisée à vider (suppression volontaire).
    const isEmpty = Array.isArray(v) ? v.length === 0 : (v == null || Object.keys(v).length === 0);
    if (isEmpty && hadDataRef.current && !allowEmpty) {
      console.warn(`[Sécurité] Écriture vide bloquée sur "${key}" : la base contenait des données.`);
      return;
    }

    // PROTECTION anti-collision multi-onglets/multi-utilisateurs : si on écrit un tableau nettement
    // plus court que ce qu'on avait vu en dernier de Firestore, c'est probablement un onglet resté
    // ouvert avec un état périmé qui écraserait des ajouts faits ailleurs. On bloque, sauf suppression
    // explicite (allowEmpty) où une réduction est normale et volontaire.
    if (Array.isArray(v) && Array.isArray(lastKnownServerRef.current) && !allowEmpty) {
      const before = lastKnownServerRef.current.length;
      const after = v.length;
      if (before > 0 && after < before) {
        console.warn(`[Sécurité] Écriture suspecte bloquée sur "${key}" : ${after} éléments écraseraient ${before} connus côté serveur. Rechargez la page pour resynchroniser, puis réessayez.`);
        alert(`Une autre modification a peut-être eu lieu ailleurs entre temps. Pour éviter d'écraser des données, veuillez recharger la page (⟳) puis réessayer votre action.`);
        return;
      }
    }

    valueRef.current = v;
    setValue(v);
    if (!isEmpty) hadDataRef.current = true;
    // JSON round-trip : retire les valeurs `undefined` (refusées par Firestore)
    setDoc(doc(db, "app", key), JSON.parse(JSON.stringify({ value: v })))
      .catch(err => console.error("Firestore write error:", key, err));
  };
  return [value, update];
}

// ─── CATALOGUE DE BASE ────────────────────────────────────────────────────────
const BASE_CATALOG = [
  { id: "chaise_napoleon", name: "Chaise Napoléon", unit: "unité", price: 2.5, icon: "🪑", category: "Chaises", coutAchat: 8 },
  { id: "chaise_pliante", name: "Chaise Pliante", unit: "unité", price: 1.2, icon: "🪑", category: "Chaises", coutAchat: 4 },
  { id: "table_ronde", name: "Table Ronde 180cm", unit: "unité", price: 8, icon: "⭕", category: "Tables", coutAchat: 45 },
  { id: "table_rectangulaire", name: "Table Rectangulaire 240cm", unit: "unité", price: 9, icon: "▬", category: "Tables", coutAchat: 55 },
  { id: "grande_assiette", name: "Grande Assiette", unit: "unité", price: 0.4, icon: "🍽️", category: "Vaisselle", coutAchat: 1.5 },
  { id: "petite_assiette", name: "Petite Assiette", unit: "unité", price: 0.3, icon: "🍽️", category: "Vaisselle", coutAchat: 1.2 },
  { id: "fourchette", name: "Fourchette", unit: "unité", price: 0.2, icon: "🍴", category: "Vaisselle", coutAchat: 0.8 },
  { id: "couteau", name: "Couteau de Table", unit: "unité", price: 0.2, icon: "🔪", category: "Vaisselle", coutAchat: 0.9 },
  { id: "grande_cuillere", name: "Grande Cuillère", unit: "unité", price: 0.15, icon: "🥄", category: "Vaisselle", coutAchat: 0.7 },
  { id: "petite_cuillere", name: "Petite Cuillère", unit: "unité", price: 0.12, icon: "🥄", category: "Vaisselle", coutAchat: 0.6 },
  { id: "verre_pied", name: "Verre à Pied", unit: "unité", price: 0.5, icon: "🍷", category: "Vaisselle", coutAchat: 2 },
  { id: "verre_eau", name: "Verre à Eau", unit: "unité", price: 0.3, icon: "🥛", category: "Vaisselle", coutAchat: 1.2 },
  { id: "rechauffe_plat", name: "Réchauffe-Plats Électrique", unit: "unité", price: 12, icon: "🔥", category: "Équipements", coutAchat: 80 },
  { id: "nappe", name: "Nappe de Table", unit: "unité", price: 3, icon: "🏳️", category: "Linge", coutAchat: 6 },
  { id: "chemin_table", name: "Chemin de Table", unit: "unité", price: 1.5, icon: "➿", category: "Linge", coutAchat: 3 },
  { id: "tonnelle", name: "Tonnelle 3x3m", unit: "unité", price: 25, icon: "⛺", category: "Équipements", coutAchat: 150 },
];

const KITS = [
  {
    id: "kit_couvert_sale", name: "Kit Couvert Complet — Rendu Sale", icon: "🍽️", category: "Kits",
    description: "Grande assiette + Petite assiette + Fourchette + Couteau + Grande cuillère + Petite cuillère + Verre à pied",
    components: [
      { id: "grande_assiette", qty: 1 }, { id: "petite_assiette", qty: 1 }, { id: "fourchette", qty: 1 }, { id: "couteau", qty: 1 },
      { id: "grande_cuillere", qty: 1 }, { id: "petite_cuillere", qty: 1 }, { id: "verre_pied", qty: 1 },
    ],
    get price() { return this.components.reduce((s, c) => { const p = BASE_CATALOG.find(b => b.id === c.id); return s + (p ? p.price * c.qty : 0); }, 0) * 0.95; },
    get coutAchat() { return this.components.reduce((s, c) => { const p = BASE_CATALOG.find(b => b.id === c.id); return s + (p ? p.coutAchat * c.qty : 0); }, 0); },
    unit: "couvert",
  },
  {
    id: "kit_couvert_propre", name: "Kit Couvert Complet — Rendu Propre", icon: "✨", category: "Kits",
    description: "Grande assiette + Petite assiette + Fourchette + Couteau + Grande cuillère + Petite cuillère + Verre à pied (retour lavé)",
    components: [
      { id: "grande_assiette", qty: 1 }, { id: "petite_assiette", qty: 1 }, { id: "fourchette", qty: 1 }, { id: "couteau", qty: 1 },
      { id: "grande_cuillere", qty: 1 }, { id: "petite_cuillere", qty: 1 }, { id: "verre_pied", qty: 1 },
    ],
    get price() { return this.components.reduce((s, c) => { const p = BASE_CATALOG.find(b => b.id === c.id); return s + (p ? p.price * c.qty : 0); }, 0) * 1.35; },
    get coutAchat() { return this.components.reduce((s, c) => { const p = BASE_CATALOG.find(b => b.id === c.id); return s + (p ? p.coutAchat * c.qty : 0); }, 0); },
    unit: "couvert",
  },
  {
    id: "kit_aperitif", name: "Kit Apéritif", icon: "🥂", category: "Kits",
    description: "Verre à pied + Petite assiette + Petite cuillère",
    components: [{ id: "verre_pied", qty: 1 }, { id: "petite_assiette", qty: 1 }, { id: "petite_cuillere", qty: 1 }],
    get price() { return this.components.reduce((s, c) => { const p = BASE_CATALOG.find(b => b.id === c.id); return s + (p ? p.price * c.qty : 0); }, 0) * 0.95; },
    get coutAchat() { return this.components.reduce((s, c) => { const p = BASE_CATALOG.find(b => b.id === c.id); return s + (p ? p.coutAchat * c.qty : 0); }, 0); },
    unit: "kit",
  },
];

// Articles "Décoration" créés à l'occasion de l'import des commandes historiques (centre de
// table, serviette de table, arche, backdrop) — absents du catalogue de base jusqu'ici.
// Prix de départ estimés : à ajuster dans Stock si besoin, ils n'ont jamais été facturés
// séparément avant (leur coût était inclus dans le prix global de la commande).
const DECO_ARTICLES = [
  { id: "centre_de_table", name: "Centre de table", icon: "🎀", category: "Décoration", price: 2, coutAchat: 0, caution: 0, unit: "unité" },
  { id: "serviette_de_table", name: "Serviette de table", icon: "🧻", category: "Décoration", price: 0.3, coutAchat: 0, caution: 0, unit: "unité" },
  { id: "arche_ronde", name: "Arche ronde", icon: "🌸", category: "Décoration", price: 15, coutAchat: 0, caution: 0, unit: "unité" },
  { id: "backdrop", name: "Backdrop", icon: "🖼️", category: "Décoration", price: 20, coutAchat: 0, caution: 0, unit: "unité" },
];

const CATALOG = [...BASE_CATALOG, ...KITS.map(k => ({ ...k, price: k.price, coutAchat: k.coutAchat }))];

const INITIAL_STOCK = [...BASE_CATALOG.map(p => {
  const total = p.category === "Chaises" ? 200 : p.category === "Tables" ? 30 : p.category === "Vaisselle" ? 500 : p.category === "Linge" ? 80 : 10;
  const qtyCamion = Math.floor(total / 2);
  return {
    ...p,
    total,
    qtyCamion,
    qtyLocal: total - qtyCamion,
    seuil: p.category === "Chaises" ? 20 : p.category === "Tables" ? 5 : p.category === "Vaisselle" ? 50 : p.category === "Linge" ? 10 : 2,
    enMaintenance: 0,
  };
}), ...KITS.map(k => ({ ...k, total: 0, qtyCamion: 0, qtyLocal: 0, seuil: 0, enMaintenance: 0 }))];
// Garantit qu'un article a toujours qtyCamion/qtyLocal cohérents (rétrocompatibilité).
function withLocations(item) {
  if (item.components) return { ...item, total: 0, qtyCamion: 0, qtyLocal: 0 }; // kit : pas de stock propre
  if (item.qtyCamion != null && item.qtyLocal != null) {
    return { ...item, total: (parseInt(item.qtyCamion) || 0) + (parseInt(item.qtyLocal) || 0) };
  }
  // Ancien article : on répartit le total existant 50/50
  const total = parseInt(item.total) || 0;
  const qtyCamion = Math.floor(total / 2);
  return { ...item, qtyCamion, qtyLocal: total - qtyCamion, total };
}

// ─── RÉGLAGES PAR DÉFAUT ──────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  // Entreprise
  companyName: "Location Pro",
  companyLogo: "🎪",
  address: "12 rue des Événements, 75000 Paris",
  phone: "01 23 45 67 89",
  email: "contact@locationpro.fr",
  siret: "",
  tva: "",
  website: "",
  // Tarifs livraison
  pricePerKm: 1.2,
  pricePerMin: 0.3,
  minDeliveryPrice: 15,
  seuilKm: 5,
  seuilMin: 10,
  warehouseAddress: "12 rue des Événements, 75000 Paris",
  // Supplément jours supplémentaires
  standardDays: 2,         // durée standard incluse dans le prix (48h = 2 jours)
  // Divers
  defaultAcomptePercent: 33,
  casseMargePercent: 30,
  tvaRate: 0,
  conditions: "Le matériel est loué en bon état. Toute casse ou perte sera facturée. La caution est restituée au retour du matériel conforme.",
  googleMapsKey: "",
  googleSheetId: "",
  campaignSenderName: "",
  campaignSenderEmail: "",
  campaignLogoUrl: "",
  campaignAccentColor: "#1a1a2e",
  photoRetentionDays: 30, // suppression auto des photos (livraison/retour) X jours après clôture de la commande
  // Barèmes de tarification automatique des options de livraison, par ARTICLE individuel (id du stock).
  // Forme : { [itemId]: [{ min, max, price }, ...] }. Vide par défaut (0 € tant que non configuré).
  // Barèmes des options de livraison, par ARTICLE individuel (id du stock) :
  // - Étage : { [itemId]: { batchSize, price } } → trajets = arrondi(qté/batchSize), prix = trajets × price × étages
  // - Mise en place : { [itemId]: { unitPrice } } → prix = unitPrice × quantité commandée
  deliveryEtageBaremes: {},
  deliveryMiseEnPlaceBaremes: {},
  // Notifications
  notifyOnValidation: true,
  notifPreparationEnabled: true,
  notifPreparationDelais: [24],
  notifLivraisonEnabled: true,
  notifLivraisonDelais: [24],
  notifRetraitEnabled: true,
  notifRetraitDelais: [24],
  notifRetourEnabled: true,
  notifRetourDelais: [24],
};

const STATUS_FLOW = ["Confirmée", "Préparée", "Chez le client", "Clôturée"];
const STATUS_COLORS = { "Brouillon": "#9ca3af", "Devis": "#f59e0b", "Confirmée": "#3b82f6", "Préparée": "#8b5cf6", "Chez le client": "#10b981", "Clôturée": "#6b7280" };
const EXPENSE_CATEGORIES = ["Achat matériel", "Maintenance / Réparation", "Carburant", "Loyer / Entrepôt", "Salaires", "Fournitures", "Assurance", "Autre"];
const CAT_COLORS = { "Achat matériel": "#3b82f6", "Maintenance / Réparation": "#8b5cf6", "Carburant": "#f97316", "Loyer / Entrepôt": "#ef4444", "Salaires": "#10b981", "Fournitures": "#f59e0b", "Assurance": "#06b6d4", "Autre": "#6b7280" };
const ICON_LIBRARY = ["🪑","💺","⭕","▬","🟦","🍽️","🍴","🔪","🥄","🍷","🥛","🍾","🥂","☕","🫖","🍶","🔥","⛺","🎪","🎉","🎈","🎀","🕯️","💡","🔦","🪩","🎤","🔊","🎸","📽️","🖼️","🪞","🏳️","➿","🧺","🧻","🪟","🚪","🛋️","🛏️","🚽","🚿","❄️","🌡️","🔌","🔋","🧯","🪜","🛒","📦","🧊","🍳","🥘","🍲","🧁","🎂","🌸","🌹","🌿","🕺"];

function genDevisId(existingOrders) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const todayPattern = new RegExp(`^dev\\d+-${dd}${mm}${yy}`);
  const todayCount = (existingOrders || []).filter(o => todayPattern.test(o.id)).length;
  // Suffixe court unique (basé sur l'heure) pour garantir l'unicité même si
  // deux devis sont créés rapidement avec le même numéro du jour.
  const uniq = Date.now().toString(36).slice(-4);
  return `dev${todayCount + 1}-${dd}${mm}${yy}-${uniq}`;
}

// ─── EXPORT CSV (ouvrable dans Google Sheets / Excel / Numbers) ───────────────
// Échappe une valeur pour le format CSV (guillemets, point-virgule, retours ligne).
function csvCell(val) {
  const s = (val == null ? "" : String(val));
  if (/[";\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function rowsToCsv(headers, rows) {
  // On utilise le point-virgule comme séparateur (standard FR pour Excel/Sheets).
  const head = headers.map(csvCell).join(";");
  const body = rows.map(r => r.map(csvCell).join(";")).join("\n");
  // BOM UTF-8 pour que les accents s'affichent correctement à l'ouverture.
  return "\uFEFF" + head + "\n" + body;
}
function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type: type || "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
// Construit et télécharge un CSV des commandes (lisible dans Google Sheets).
function exportOrdersCsv(orders, settings) {
  const headers = ["N° Devis", "Client", "Téléphone", "Email", "Adresse", "Mode", "Date livraison", "Heure", "Date retour", "Heure retour", "Statut", "Articles", "Total TTC (€)", "Acompte (€)", "Reste (€)", "Notes"];
  const rows = (orders || []).map(o => {
    const total = orderTotal(o, settings);
    const acompte = parseFloat(o.acompte) || 0;
    const articles = (o.items || []).map(it => `${it.qty}x ${it.name}`).join(" | ");
    return [o.id, o.clientName, o.clientPhone, o.clientEmail, o.address,
      o.deliveryMode === "livraison" ? "Livraison" : "Retrait", o.deliveryDate, o.deliveryTime,
      o.returnDate, o.returnTime, o.status, articles, total.toFixed(2), acompte.toFixed(2),
      (total - acompte).toFixed(2), o.notes];
  });
  const today = new Date().toISOString().slice(0, 10);
  downloadFile(`EventDream-commandes-${today}.csv`, rowsToCsv(headers, rows));
}
// Sauvegarde complète (toutes les données) au format JSON.
function exportFullBackup(data) {
  const today = new Date().toISOString().slice(0, 10);
  downloadFile(`EventDream-sauvegarde-${today}.json`, JSON.stringify(data, null, 2), "application/json");
}

// Calcul du prix de livraison pour UN trajet.
// Logique : forfait minimum couvrant un seuil de km + un seuil de minutes.
// Au-delà des seuils, on ajoute un supplément uniquement sur le dépassement.
function calcTrajet(km, minutes, settings) {
  const s = settings || DEFAULT_SETTINGS;
  if (km <= 0) return 0;
  const forfait = s.minDeliveryPrice || 0;
  const seuilKm = s.seuilKm != null ? s.seuilKm : (s.minKmThreshold || 0);
  const seuilMin = s.seuilMin != null ? s.seuilMin : 0;
  // km et minutes qui dépassent le seuil (jamais négatif)
  const kmSup = Math.max(0, km - seuilKm);
  const minSup = Math.max(0, (minutes || 0) - seuilMin);
  const supplement = kmSup * (s.pricePerKm || 0) + minSup * (s.pricePerMin || 0);
  return forfait + supplement;
}

// Coût total de livraison d'une commande (aller + retour selon options cochées)
function deliveryCostOf(order, settings) {
  if (order.deliveryMode !== "livraison") return 0;
  // Tarif libre : si l'utilisateur a saisi un prix manuel, il prime sur le calcul auto.
  if (order.deliveryPriceManual != null && order.deliveryPriceManual !== "") {
    return parseFloat(order.deliveryPriceManual) || 0;
  }
  const km = parseFloat(order.deliveryKm) || 0;
  const min = parseFloat(order.deliveryMin) || 0;
  const unit = calcTrajet(km, min, settings);
  let total = 0;
  if (order.trajetAller !== false) total += unit;
  if (order.trajetRetour) total += unit;
  return total;
}

// Quantité totale d'un article précis (par id) dans une commande.
function qtyById(order, itemId) {
  return (order.items || []).reduce((s, it) => (it.id === itemId ? s + (parseInt(it.qty) || 0) : s), 0);
}

// Calcul automatique du tarif "Monter à l'étage" : pour chaque article, le nombre de trajets
// nécessaires (arrondi au-dessus de quantité ÷ quantité max transportable par trajet) × le prix
// par trajet — puis le tout multiplié par le nombre d'étages. Toujours 0 si rien n'est configuré.
function calcEtagePriceAuto(order, settings, nbEtages) {
  const baremes = (settings && settings.deliveryEtageBaremes) || {};
  const itemIds = [...new Set((order.items || []).map(it => it.id).filter(Boolean))];
  const parEtage = itemIds.reduce((s, id) => {
    const cfg = baremes[id];
    if (!cfg || !cfg.batchSize) return s;
    const qty = qtyById(order, id);
    if (qty <= 0) return s;
    const trajets = Math.ceil(qty / (parseFloat(cfg.batchSize) || 1));
    return s + trajets * (parseFloat(cfg.price) || 0);
  }, 0);
  return parEtage * (parseInt(nbEtages) || 0);
}

// Calcul automatique du tarif "Mise en place" : pour chaque article, prix unitaire × quantité
// commandée, additionné sur tous les articles. Toujours 0 si rien n'est configuré.
function calcMiseEnPlacePriceAuto(order, settings) {
  const baremes = (settings && settings.deliveryMiseEnPlaceBaremes) || {};
  const itemIds = [...new Set((order.items || []).map(it => it.id).filter(Boolean))];
  return itemIds.reduce((s, id) => {
    const cfg = baremes[id];
    if (!cfg || !cfg.unitPrice) return s;
    return s + (parseFloat(cfg.unitPrice) || 0) * qtyById(order, id);
  }, 0);
}

// Coût total des options de livraison cochées (étage + mise en place), tarif manuel prioritaire.
function deliveryExtrasCost(order) {
  let total = 0;
  if (order.etageActive) total += parseFloat(order.etagePrice) || 0;
  if (order.miseEnPlaceActive) total += parseFloat(order.miseEnPlacePrice) || 0;
  return total;
}

// Total commande = articles - remise + livraison
// Nombre de périodes de location (arrondi au supérieur).
// Ex: 6 jours / 2 jours standard = 3 périodes. 7j / 2j = 4 périodes.
// La 1ère période est incluse dans le prix de base → périodes supplémentaires = total - 1.
function extraDaysCount(order, settings) {
  if (!order.deliveryDate || !order.returnDate) return 0;
  const s = settings || DEFAULT_SETTINGS;
  const standard = s.standardDays != null && s.standardDays > 0 ? s.standardDays : 2;
  const d1 = new Date(order.deliveryDate + "T12:00:00");
  const d2 = new Date(order.returnDate + "T12:00:00");
  const totalDays = Math.round((d2 - d1) / 86400000); // retour - livraison, sans +1 (le jour de retour n'est pas facturé)
  const periodes = Math.ceil(totalDays / standard);        // arrondi au supérieur
  return Math.max(0, periodes - 1);                        // -1 car la 1ère est incluse
}

// Supplément = périodes supplémentaires × sous-total articles.
// (livraison exclue car ponctuelle, indépendante de la durée)
// Si prix manuel saisi → prime sur le calcul auto.
function extraDaysCost(order, settings) {
  if (order.extraDaysPriceManual != null && order.extraDaysPriceManual !== "") {
    return parseFloat(order.extraDaysPriceManual) || 0;
  }
  const extra = extraDaysCount(order, settings);
  if (extra <= 0) return 0;
  const sub = orderSubtotal(order);
  return extra * sub;
}

function orderSubtotal(order) {
  return (order.items || []).reduce((s, i) => {
    const base = (parseInt(i.qty) || 0) * (parseFloat(i.price) || 0);
    const cleaning = i.cleaningSelected ? (parseInt(i.qty) || 0) * (parseFloat(i.cleaningPrice) || 0) : 0;
    return s + base + cleaning;
  }, 0);
}
function orderDiscount(order) {
  const sub = orderSubtotal(order);
  if (order.discountType === "percent") return sub * ((parseFloat(order.discountValue) || 0) / 100);
  return parseFloat(order.discountValue) || 0;
}
// Calcule la caution totale d'une commande à partir du stock (caution €/unité × quantité).
// Les kits n'ont pas de caution propre : on additionne celle de leurs composants.
// Si un montant manuel est saisi, il prime sur le calcul auto.
function cautionCost(order, stock) {
  if (order.cautionManual != null && order.cautionManual !== "") {
    return parseFloat(order.cautionManual) || 0;
  }
  return (order.items || []).reduce((sum, item) => {
    const qty = parseInt(item.qty) || 0;
    if (qty <= 0) return sum;
    const stockItem = (stock || []).find(s => s.id === item.id);
    if (!stockItem) return sum;
    if (stockItem.components && stockItem.components.length > 0) {
      // Kit : on additionne la caution des composants × leur quantité dans le kit
      const kitCaution = stockItem.components.reduce((s, comp) => {
        const compItem = (stock || []).find(si => si.id === comp.id);
        return s + ((compItem && compItem.caution) || 0) * (parseInt(comp.qty) || 0);
      }, 0);
      return sum + kitCaution * qty;
    }
    return sum + ((stockItem.caution || 0) * qty);
  }, 0);
}

function orderTotal(order, settings) {
  const sub = orderSubtotal(order);
  const disc = orderDiscount(order);
  const del = deliveryCostOf(order, settings) + deliveryExtrasCost(order);
  const extra = extraDaysCost(order, settings);
  return Math.max(0, sub - disc) + del + extra;
}

// Période d'immobilisation d'une commande : de la livraison au retour inclus.
// Si pas de date retour, on prend la date de livraison seule.
function orderPeriod(o) {
  const start = o.deliveryDate || o.returnDate || "";
  const end = o.returnDate || o.deliveryDate || "";
  if (!start) return null;
  return { start: start < end ? start : end, end: end > start ? end : start };
}
// Deux périodes se chevauchent-elles ? (bornes incluses)
function periodsOverlap(a, b) {
  if (!a || !b) return false;
  return a.start <= b.end && b.start <= a.end;
}
// Convertit les articles d'une commande en besoins par article de base,
// en "explosant" les kits en leurs composants (1 kit = n composants).
function expandToBaseNeeds(items, stock) {
  const needs = {}; // id article de base -> quantité totale
  for (const item of (items || [])) {
    const qty = parseInt(item.qty) || 0;
    if (qty <= 0) continue;
    const stockItem = (stock || []).find(s => s.id === item.id);
    if (stockItem && stockItem.components && stockItem.components.length > 0) {
      // C'est un kit : on additionne les composants
      for (const comp of stockItem.components) {
        const cq = (parseInt(comp.qty) || 0) * qty;
        needs[comp.id] = (needs[comp.id] || 0) + cq;
      }
    } else {
      needs[item.id] = (needs[item.id] || 0) + qty;
    }
  }
  return needs;
}
// Construit la liste des clients à ajouter à la bibliothèque à partir d'une liste de commandes
// (utilisé à l'import de commandes, et pour rattraper les clients manquants après coup) —
// ignore les doublons déjà présents dans la bibliothèque (comparaison nom + téléphone).
function extractNewClientsFromOrders(orderList, existingClients) {
  const existingKeys = new Set((existingClients || []).map(c => `${(c.name || "").toLowerCase()}|${c.phone || ""}`));
  const seen = new Set();
  const toAdd = [];
  for (const o of (orderList || [])) {
    if (!o.clientName) continue;
    const key = `${(o.clientName || "").toLowerCase()}|${o.clientPhone || ""}`;
    if (existingKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    const phones = (o.clientPhones && o.clientPhones.length ? o.clientPhones : (o.clientPhone ? [o.clientPhone] : [])).filter(Boolean);
    toAdd.push({ id: "cli-" + Date.now() + "-" + toAdd.length, name: o.clientName, phone: o.clientPhone || "", phones, email: o.clientEmail || "", address: o.address || "", notes: "" });
  }
  return toAdd;
}
// Texte de composition d'un kit ("1× Fourchette + 1× Couteau + ..."), calculé dynamiquement
// à partir de ses composants actuels — reste toujours juste même si la composition est modifiée
// après coup, contrairement à un texte figé enregistré une fois pour toutes.
function kitCompositionText(item, stock) {
  if (!item || !item.components || !item.components.length) return "";
  return item.components.map(c => {
    const a = (stock || []).find(s => s.id === c.id);
    if (!a) return "";
    const q = parseInt(c.qty) || 1;
    return q > 1 ? `${q}× ${a.name}` : a.name;
  }).filter(Boolean).join(" + ");
}
// Calcule le plan de prélèvement par emplacement pour une commande.
// Règle : une LIVRAISON privilégie le camion, un RETRAIT privilégie le local.
// Retourne [{ id, name, icon, besoin, fromCamion, fromLocal, manque }].
function prelevementPlan(order, stock) {
  const needs = expandToBaseNeeds(order.items, stock);
  const prioriteCamion = order.deliveryMode === "livraison";
  const plan = [];
  for (const id in needs) {
    const besoin = needs[id];
    const raw = (stock || []).find(s => s.id === id);
    if (!raw) { plan.push({ id, name: id, icon: "📦", besoin, fromCamion: 0, fromLocal: 0, manque: besoin }); continue; }
    const it = withLocations(raw);
    const dispoCamion = parseInt(it.qtyCamion) || 0;
    const dispoLocal = parseInt(it.qtyLocal) || 0;
    let fromCamion = 0, fromLocal = 0, reste = besoin;
    if (prioriteCamion) {
      fromCamion = Math.min(reste, dispoCamion); reste -= fromCamion;
      fromLocal = Math.min(reste, dispoLocal); reste -= fromLocal;
    } else {
      fromLocal = Math.min(reste, dispoLocal); reste -= fromLocal;
      fromCamion = Math.min(reste, dispoCamion); reste -= fromCamion;
    }
    plan.push({ id, name: it.name, icon: it.icon, besoin, fromCamion, fromLocal, manque: reste, prioriteCamion });
  }
  return plan;
}
// Calcule le manque de stock pour une commande donnée sur sa période.
function stockShortage(form, allOrders, stock) {
  const myPeriod = orderPeriod(form);
  if (!myPeriod) return [];
  const occupying = (allOrders || []).filter(o =>
    o.id !== form.id &&
    !["Brouillon", "Devis", "Clôturée"].includes(o.status) &&
    periodsOverlap(orderPeriod(o), myPeriod)
  );
  // Besoins de la commande courante, kits explosés en composants
  const myNeeds = expandToBaseNeeds(form.items, stock);
  // Besoins déjà réservés par les autres commandes, kits explosés aussi
  const reservedNeeds = {};
  for (const o of occupying) {
    const n = expandToBaseNeeds(o.items, stock);
    for (const id in n) reservedNeeds[id] = (reservedNeeds[id] || 0) + n[id];
  }
  const shortages = [];
  for (const id in myNeeds) {
    const besoin = myNeeds[id];
    const stockItem = (stock || []).find(s => s.id === id);
    const owned = stockItem ? (parseInt(stockItem.total) || 0) : 0;
    const reserved = reservedNeeds[id] || 0;
    const dispo = owned - reserved;
    if (besoin > dispo) {
      shortages.push({ id, name: stockItem ? stockItem.name : id, icon: stockItem ? stockItem.icon : "📦", besoin, dispo: Math.max(0, dispo), manque: besoin - dispo });
    }
  }
  return shortages;
}

const TODAY = new Date().toISOString().split("T")[0];
const D = (n) => new Date(Date.now() + 86400000 * n).toISOString().split("T")[0];
// Affiche une date ISO (aaaa-mm-jj) au format français jj/mm/aaaa
const fmtD = (iso) => { if (!iso) return ""; const p = String(iso).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso; };

const DEMO_ORDERS = [
  { id: "dev1" + TODAY.slice(8,10) + TODAY.slice(5,7) + TODAY.slice(2,4), clientName: "Marie Leblanc", clientPhone: "0612345678", clientEmail: "marie@example.com", address: "24 Avenue des Fleurs, 69003 Lyon", deliveryMode: "livraison", deliveryKm: 12, deliveryMin: 18, trajetAller: true, trajetRetour: true, deliveryDate: TODAY, deliveryTime: "09:00", returnDate: D(2), returnTime: "18:00", items: [{ ...CATALOG[0], qty: 50 }, { ...CATALOG[13], qty: 50 }, { ...CATALOG[12], qty: 2 }], acompte: 150, acompteMoyen: "virement", discountType: "fixed", discountValue: 0, status: "Livrée", phase: "retour", notes: "Mariage — décoration dorée" },
  { id: "dev2" + TODAY.slice(8,10) + TODAY.slice(5,7) + TODAY.slice(2,4), clientName: "Pierre Martin", clientPhone: "0698765432", clientEmail: "pierre@example.com", address: "5 Rue du Commerce, 75015 Paris", deliveryMode: "retrait", deliveryKm: 0, deliveryMin: 0, trajetAller: true, trajetRetour: false, deliveryDate: D(3), deliveryTime: "10:00", returnDate: D(5), returnTime: "", items: [{ ...CATALOG[1], qty: 30 }, { ...CATALOG[2], qty: 5 }], acompte: 0, acompteMoyen: "", discountType: "fixed", discountValue: 0, status: "Confirmée", phase: "livraison", notes: "" },
  { id: "dev3" + TODAY.slice(8,10) + TODAY.slice(5,7) + TODAY.slice(2,4), clientName: "Sophie Durand", clientPhone: "0711223344", clientEmail: "sophie@example.com", address: "8 Boulevard Victor Hugo, 06000 Nice", deliveryMode: "livraison", deliveryKm: 8, deliveryMin: 12, trajetAller: true, trajetRetour: true, deliveryDate: D(7), deliveryTime: "14:00", returnDate: D(9), returnTime: "17:00", items: [{ ...CATALOG[0], qty: 100 }, { ...CATALOG[17], qty: 100 }, { ...CATALOG[12], qty: 4 }, { ...CATALOG[13], qty: 10 }], acompte: 300, acompteMoyen: "paypal", discountType: "percent", discountValue: 10, status: "Devis", phase: "livraison", notes: "Anniversaire 50 ans" },
];

const DEMO_EXPENSES = [
  { id: "DEP-1", date: D(-5), label: "Achat 50 chaises Napoléon", category: "Achat matériel", amount: 400, supplier: "Déco Events SARL", paymentMethod: "Virement", notes: "", linkedItemId: "chaise_napoleon", linkedQty: 50 },
  { id: "DEP-2", date: D(-12), label: "Réparation réchauffe-plats", category: "Maintenance / Réparation", amount: 85, supplier: "Électro Service", paymentMethod: "CB", notes: "3 appareils", linkedItemId: "", linkedQty: 0 },
  { id: "DEP-3", date: D(-20), label: "Loyer entrepôt — Juin", category: "Loyer / Entrepôt", amount: 650, supplier: "SCI Dupont", paymentMethod: "Virement", notes: "", linkedItemId: "", linkedQty: 0 },
  { id: "DEP-4", date: D(-2), label: "Carburant livraisons", category: "Carburant", amount: 95, supplier: "Total", paymentMethod: "CB", notes: "", linkedItemId: "", linkedQty: 0 },
];

const DEMO_CLIENTS = [
  { id: "cli-1", name: "Marie Leblanc", phone: "0612345678", email: "marie@example.com", address: "24 Avenue des Fleurs, 69003 Lyon", notes: "Préfère livraison matin" },
  { id: "cli-2", name: "Pierre Martin", phone: "0698765432", email: "pierre@example.com", address: "5 Rue du Commerce, 75015 Paris", notes: "" },
  { id: "cli-3", name: "Sophie Durand", phone: "0711223344", email: "sophie@example.com", address: "8 Boulevard Victor Hugo, 06000 Nice", notes: "Anniversaire récurrent chaque juin" },
];

// ─── CALCUL DISTANCE GOOGLE — ROUTES API ──────────────────────────────────────
// Utilise la nouvelle "Routes API" de Google (computeRouteMatrix), appelable
// directement en HTTP POST (pas de blocage CORS). Remplace l'ancienne
// DistanceMatrix dépréciée. Retourne {km, min} ou null.
async function computeDistance(origin, destination, apiKey) {
  if (!apiKey || !origin || !destination) return null;
  try {
    const resp = await fetch(
      "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,condition",
        },
        body: JSON.stringify({
          origins: [{ waypoint: { address: origin } }],
          destinations: [{ waypoint: { address: destination } }],
          travelMode: "DRIVE",
        }),
      }
    );
    if (!resp.ok) {
      const txt = await resp.text();
      console.error("Routes API error:", resp.status, txt);
      return null;
    }
    const data = await resp.json();
    const el = Array.isArray(data) ? data[0] : data;
    if (el && el.condition === "ROUTE_EXISTS" && el.distanceMeters != null) {
      const seconds = parseInt(String(el.duration).replace("s", "")) || 0;
      return { km: Math.round(el.distanceMeters / 100) / 10, min: Math.round(seconds / 60) };
    }
    console.error("Routes API: pas de route trouvée", el);
  } catch (e) { console.error("Erreur calcul distance:", e); }
  return null;
}

// ─── PDF GÉNÉRATION ───────────────────────────────────────────────────────────
async function loadJsPDF() {
  if (window.jspdf) return window.jspdf.jsPDF;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s.onload = () => resolve(window.jspdf.jsPDF);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function buildPdfBlob(order, settings, mode = "devis", stock = []) {
  return new Promise(async (resolve) => {
    const isFacture = mode === "facture";
    const s = settings || DEFAULT_SETTINGS;
    const JsPDF = await loadJsPDF();
    const doc = new JsPDF({ unit: "mm", format: "a4" });
    const del = deliveryCostOf(order, s);
    const sub = orderSubtotal(order);
    const disc = orderDiscount(order);
    const extraDays = extraDaysCost(order, s);
    const extraDaysNbPdf = extraDaysCount(order, s);
    const caution = cautionCost(order, stock);
    const total = orderTotal(order, s);
    const acompte = parseFloat(order.acompte || 0);
    const reste = total - acompte;
    const W = 210, m = 16;

    doc.setFillColor(26, 26, 46); doc.rect(0, 0, W, 42, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(19); doc.setFont("helvetica", "bold");
    doc.text(s.companyName || "Location Pro", m, 15);
    doc.setFontSize(8); doc.setFont("helvetica", "normal");
    let hy = 21;
    if (s.address) { doc.text(s.address, m, hy); hy += 4.5; }
    if (s.phone) { doc.text(`Tél : ${s.phone}`, m, hy); hy += 4.5; }
    if (s.email) { doc.text(s.email, m, hy); hy += 4.5; }

    doc.setFontSize(15); doc.setFont("helvetica", "bold");
    doc.text(isFacture ? "FACTURE" : "DEVIS", W - m, 14, { align: "right" });
    doc.setFontSize(11); doc.text(isFacture ? order.id.replace(/^dev/, "facture") : order.id, W - m, 21, { align: "right" });
    doc.setFontSize(8); doc.setFont("helvetica", "normal");
    doc.text(`Date : ${new Date().toLocaleDateString("fr-FR")}`, W - m, 27, { align: "right" });
    if (isFacture && order.deliveryDate) doc.text(`Prestation : ${fmtD(order.deliveryDate)}`, W - m, 31.5, { align: "right" });

    doc.setTextColor(50, 50, 50);
    doc.setFontSize(11); doc.setFont("helvetica", "bold");
    doc.text("Client", m, 54);
    doc.setFontSize(10); doc.setFont("helvetica", "normal");
    let cy = 61;
    doc.text(order.clientName || "", m, cy); cy += 6;
    if (order.clientPhone) { doc.text(`Tél : ${order.clientPhone}`, m, cy); cy += 6; }
    if (order.clientEmail) { doc.text(`Email : ${order.clientEmail}`, m, cy); cy += 6; }
    if (order.address) { const lines = doc.splitTextToSize(order.address, 85); doc.text(lines, m, cy); }

    doc.setFontSize(11); doc.setFont("helvetica", "bold");
    doc.text("Prestation", 115, 54);
    doc.setFontSize(10); doc.setFont("helvetica", "normal");
    let py = 61;
    doc.text(order.deliveryMode === "livraison" ? "Livraison" : "Retrait entrepôt", 115, py); py += 6;
    // Pour un retrait, afficher l'adresse de l'entrepôt
    if (order.deliveryMode !== "livraison" && s.warehouseAddress) {
      const addrLines = doc.splitTextToSize(s.warehouseAddress, 80);
      doc.text(addrLines, 115, py); py += addrLines.length * 5;
    }
    if (order.deliveryDate) { doc.text(`Le ${fmtD(order.deliveryDate)}${order.deliveryTime ? " à " + order.deliveryTime : ""}`, 115, py); py += 6; }
    if (order.returnDate) { doc.text(`Retour ${fmtD(order.returnDate)}${order.returnTime ? " à " + order.returnTime : ""}`, 115, py); py += 6; }

    let y = 100;
    doc.setFillColor(240, 244, 255); doc.rect(m, y - 6, W - 2 * m, 8, "F");
    doc.setTextColor(100, 100, 120); doc.setFontSize(8); doc.setFont("helvetica", "bold");
    doc.text("ARTICLE", m + 2, y - 0.5);
    doc.text("QTÉ", 130, y - 0.5, { align: "center" });
    doc.text("P.U.", 158, y - 0.5, { align: "center" });
    doc.text("TOTAL", W - m - 2, y - 0.5, { align: "right" });
    y += 5;
    doc.setTextColor(30, 30, 30); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    (order.items || []).forEach((item, idx) => {
      const compText = kitCompositionText(item, stock);
      const cleaningNote = item.cleaningSelected ? "+ option nettoyage" : "";
      const noteLines = compText && cleaningNote ? doc.splitTextToSize(`${compText} · ${cleaningNote}`, 100) : compText ? doc.splitTextToSize(compText, 100) : cleaningNote ? doc.splitTextToSize(cleaningNote, 100) : [];
      const compLines = noteLines;
      const rowH = compLines.length ? 7.5 + compLines.length * 3.5 : 7.5;
      if (y > 250) { doc.addPage(); y = 25; }
      if (idx % 2 === 0) { doc.setFillColor(250, 250, 252); doc.rect(m, y - 5, W - 2 * m, rowH - 0.5, "F"); }
      const ip = (parseFloat(item.price) || 0) + (item.cleaningSelected ? (parseFloat(item.cleaningPrice) || 0) : 0), iq = parseInt(item.qty) || 0;
      doc.setTextColor(30, 30, 30); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      doc.text(item.name || "", m + 2, y);
      doc.text(String(iq), 130, y, { align: "center" });
      doc.text(ip.toFixed(2) + " €", 158, y, { align: "center" });
      doc.text((iq * ip).toFixed(2) + " €", W - m - 2, y, { align: "right" });
      if (compLines.length) {
        doc.setTextColor(150, 150, 150); doc.setFontSize(7);
        doc.text(compLines, m + 2, y + 4);
        doc.setTextColor(30, 30, 30); doc.setFontSize(9);
      }
      y += rowH;
    });

    y += 4; doc.setDrawColor(220, 220, 220); doc.line(W - m - 70, y, W - m, y); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text("Sous-total", W - m - 60, y); doc.text(`${sub.toFixed(2)} €`, W - m, y, { align: "right" }); y += 6;
    if (disc > 0) { doc.setTextColor(16,185,129); doc.text(`Remise${order.discountType === "percent" ? ` (${order.discountValue}%)` : ""}`, W - m - 60, y); doc.text(`- ${disc.toFixed(2)} €`, W - m, y, { align: "right" }); doc.setTextColor(30,30,30); y += 6; }
    if (del > 0) {
      const trajets = [order.trajetAller !== false && "aller", order.trajetRetour && "retour"].filter(Boolean).join(" + ");
      doc.text(`Livraison (${trajets})`, W - m - 60, y); doc.text(`${del.toFixed(2)} €`, W - m, y, { align: "right" }); y += 6;
    }
    if (order.etageActive) {
      const nbEt = order.etageNbEtages || 1;
      doc.text(`Monter à l'étage (${nbEt} étage${nbEt > 1 ? "s" : ""})`, W - m - 60, y); doc.text(`${(parseFloat(order.etagePrice) || 0).toFixed(2)} €`, W - m, y, { align: "right" }); y += 6;
    }
    if (order.miseEnPlaceActive) {
      doc.text("Mise en place", W - m - 60, y); doc.text(`${(parseFloat(order.miseEnPlacePrice) || 0).toFixed(2)} €`, W - m, y, { align: "right" }); y += 6;
    }
    if (extraDays > 0) {
      doc.setTextColor(194, 65, 12);
      doc.text(`Suppl. périodes (×${extraDaysNbPdf + 1})`, W - m - 60, y); doc.text(`${extraDays.toFixed(2)} €`, W - m, y, { align: "right" });
      doc.setTextColor(30, 30, 30); y += 6;
    }
    if (acompte > 0) { doc.setTextColor(59,130,246); doc.text("Acompte versé", W - m - 60, y); doc.text(`- ${acompte.toFixed(2)} €`, W - m, y, { align: "right" }); doc.setTextColor(30,30,30); y += 6; }
    // Décomposition TVA (prix TTC) — affichée si un taux est défini
    const vatRate = parseFloat(s.tvaRate || 0);
    if (vatRate > 0) {
      const ht = total / (1 + vatRate / 100);
      const tva = total - ht;
      doc.setDrawColor(220, 220, 220); doc.line(W - m - 70, y - 1, W - m, y - 1); y += 4;
      doc.setTextColor(90,90,90); doc.setFontSize(9.5);
      doc.text("Total HT", W - m - 60, y); doc.text(`${ht.toFixed(2)} €`, W - m, y, { align: "right" }); y += 5;
      doc.text(`TVA (${vatRate}%)`, W - m - 60, y); doc.text(`${tva.toFixed(2)} €`, W - m, y, { align: "right" }); y += 5;
      doc.setTextColor(30,30,30); doc.setFont("helvetica","bold");
      doc.text("Total TTC", W - m - 60, y); doc.text(`${total.toFixed(2)} €`, W - m, y, { align: "right" });
      doc.setFont("helvetica","normal"); y += 7;
    }
    doc.setFillColor(26, 26, 46); doc.rect(W - m - 80, y - 4, 80, 10, "F");
    doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(11);
    doc.text(isFacture ? "NET À PAYER" : "SOLDE À PAYER", W - m - 76, y + 2.5);
    doc.text(`${reste.toFixed(2)} €`, W - m - 2, y + 2.5, { align: "right" });
    y += 18;

    // Caution — mention informative, séparée du total à payer (jamais incluse dans le calcul).
    if (caution > 0) {
      const moyenLabel = { cheque: "par chèque", especes: "en espèces", virement: "par virement", paypal: "par PayPal", cb: "par CB" }[order.cautionMoyen] || "";
      doc.setFillColor(245, 243, 255); doc.rect(m, y - 5, W - 2 * m, 9, "F");
      doc.setTextColor(109, 40, 217); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
      doc.text(`CAUTION à prévoir ${moyenLabel} : ${caution.toFixed(2)} € (restituée à la fin de la location)`, m + 2, y + 1);
      doc.setFont("helvetica", "normal"); y += 12;
    }

    if (order.notes) { doc.setTextColor(100,100,100); doc.setFont("helvetica","italic"); doc.setFontSize(9); const nl = doc.splitTextToSize(`Notes : ${order.notes}`, W - 2*m); doc.text(nl, m, y); y += nl.length * 5 + 4; }

    // Mention livraison/retour au pied du camion — uniquement si l'option "Monter à l'étage"
    // n'est pas cochée (sinon la mention contredirait l'option facturée juste au-dessus).
    if (order.deliveryMode === "livraison") {
      doc.setTextColor(60,60,60); doc.setFont("helvetica","bold"); doc.setFontSize(8.5);
      const mention = order.etageActive
        ? `La livraison et le retour s'effectuent jusqu'à l'étage (${order.etageNbEtages || 1} étage${(order.etageNbEtages || 1) > 1 ? "s" : ""}).`
        : "La livraison et le retour s'effectuent au pied du camion.";
      doc.text(mention, m, y);
      doc.setFont("helvetica","normal"); y += 7;
    }

    // Mentions légales obligatoires (facture française)
    if (isFacture) {
      if (reste <= 0) { doc.setTextColor(16,185,129); doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.text("✓ Facture acquittée", m, y); y += 7; }
      const tvaNote = (parseFloat(s.tvaRate || 0) === 0) ? "TVA non applicable, art. 293 B du CGI." : "";
      const mentions = [
        "Conditions de paiement : paiement à réception de facture.",
        "En cas de retard de paiement, pénalités au taux de 3 fois le taux d'intérêt légal,",
        "et indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 et D441-5 du Code de commerce).",
        "Pas d'escompte pour paiement anticipé.",
        tvaNote,
      ].filter(Boolean);
      doc.setTextColor(110,110,110); doc.setFont("helvetica","normal"); doc.setFontSize(7.5);
      const ml = doc.splitTextToSize(mentions.join(" "), W - 2*m);
      doc.text(ml, m, Math.max(y, 250));
    } else if (s.conditions) {
      doc.setTextColor(140,140,140); doc.setFont("helvetica","normal"); doc.setFontSize(7.5); const cl = doc.splitTextToSize(s.conditions, W - 2*m); doc.text(cl, m, Math.max(y, 255));
    }

    doc.setDrawColor(220,220,220); doc.line(m, 282, W - m, 282);
    doc.setTextColor(160,160,160); doc.setFontSize(7.5);
    const footer = [s.siret && `SIRET ${s.siret}`, s.tva && `TVA ${s.tva}`, s.website].filter(Boolean).join("  ·  ");
    doc.text(footer || (s.companyName || "Location Pro"), W / 2, 288, { align: "center" });
    resolve(doc.output("blob"));
  });
}

const GDRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
async function uploadToDrive(blob, filename, accessToken) {
  const meta = JSON.stringify({ name: filename, mimeType: "application/pdf" });
  const form = new FormData();
  form.append("metadata", new Blob([meta], { type: "application/json" }));
  form.append("file", blob);
  const resp = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: form,
  });
  if (!resp.ok) throw new Error(`Drive upload failed: ${resp.status}`);
  return resp.json();
}

// ─── ICÔNES ───────────────────────────────────────────────────────────────────
const I = {
  plus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M12 5v14M5 12h14"/></svg>,
  trash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>,
  edit: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  eye: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="20 6 9 17 4 12"/></svg>,
  x: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  copy: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>,
  location: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  phone: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8 19.79 19.79 0 01.02 1.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z"/></svg>,
  back: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>,
  next: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M5 12h14M12 5l7 7-7 7"/></svg>,
  share: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>,
};

// ─── UI BASE ──────────────────────────────────────────────────────────────────
function Badge({ status }) {
  return <span style={{ background: STATUS_COLORS[status] + "22", color: STATUS_COLORS[status], border: `1px solid ${STATUS_COLORS[status]}55`, padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{status}</span>;
}
function Card({ children, style, onClick }) {
  return <div onClick={onClick} style={{ background: "#fff", borderRadius: 16, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", padding: 20, border: "1px solid #f0f0f0", cursor: onClick ? "pointer" : undefined, ...style }}>{children}</div>;
}
function Btn({ children, onClick, variant = "primary", size = "md", style, disabled }) {
  const sz = { sm: { padding: "6px 14px", fontSize: 13 }, md: { padding: "10px 20px", fontSize: 14 }, lg: { padding: "14px 28px", fontSize: 16 } }[size];
  const vr = { primary: { background: "#1a1a2e", color: "#fff" }, secondary: { background: "#f4f4f8", color: "#333" }, danger: { background: "#fee2e2", color: "#dc2626" }, success: { background: "#d1fae5", color: "#065f46" }, ghost: { background: "transparent", color: "#666" }, warning: { background: "#fef9c3", color: "#92400e" } }[variant];
  return <button type="button" disabled={disabled} onClick={onClick} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, border: "none", borderRadius: 10, cursor: disabled ? "not-allowed" : "pointer", fontWeight: 700, fontFamily: "inherit", transition: "all 0.15s", opacity: disabled ? 0.5 : 1, ...sz, ...vr, ...style }}>{children}</button>;
}
function Inp({ label, value, onChange, type = "text", placeholder, required, min, step, suffix, disabled }) {
  // Pour les nombres : on garde un tampon texte local pendant la saisie pour
  // éviter le "0" collé devant (ex: taper 2 quand la valeur est 0 → "20").
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const isNum = type === "number";

  const cleanNumDisplay = (v) => (v === 0 || v === "0" || v === "" || v == null ? "" : String(Number(v)));
  const displayValue = isNum ? (focused ? draft : cleanNumDisplay(value)) : value;

  const handleNumChange = (raw) => {
    // Autorise vide, chiffres, un point/virgule décimal et un signe -
    let s = raw.replace(",", ".");
    if (s !== "" && !/^-?\d*\.?\d*$/.test(s)) return;
    // Retire les zéros inutiles en tête ("020" → "20", garde "0." et "0")
    if (/^-?0\d/.test(s)) s = s.replace(/^(-?)0+(\d)/, "$1$2");
    setDraft(s);
    onChange(s === "" || s === "-" || s === "." ? "" : (parseFloat(s)));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && <label style={{ fontSize: 12, fontWeight: 700, color: "#666", letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}{required && <span style={{ color: "#ef4444" }}> *</span>}</label>}
      <div style={{ position: "relative", minWidth: 0 }}>
        <input
          type={isNum ? "text" : type}
          inputMode={isNum ? "decimal" : undefined}
          value={displayValue}
          onChange={e => isNum ? handleNumChange(e.target.value) : onChange(e.target.value)}
          placeholder={placeholder ?? (isNum ? "0" : undefined)}
          min={min} step={step}
          disabled={disabled}
          style={{ width: "100%", minWidth: 0, maxWidth: "100%", padding: "10px 10px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 16, fontFamily: "inherit", background: disabled ? "#f0f0f0" : "#fafafa", color: disabled ? "#bbb" : "#1a1a2e", WebkitTextFillColor: disabled ? "#bbb" : "#1a1a2e", boxSizing: "border-box", paddingRight: suffix ? 38 : 10, outline: "none", WebkitAppearance: "none", cursor: disabled ? "not-allowed" : "text" }}
          onFocus={e => { e.target.style.borderColor = "#1a1a2e"; if (isNum) { setDraft(cleanNumDisplay(value)); setFocused(true); } }}
          onBlur={e => { e.target.style.borderColor = "#e5e7eb"; setFocused(false); }} />
        {suffix && <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "#999", fontSize: 13 }}>{suffix}</span>}
      </div>
    </div>
  );
}
function Sel({ label, value, onChange, options }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && <label style={{ fontSize: 12, fontWeight: 700, color: "#666", letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</label>}
      <select value={value} onChange={e => onChange(e.target.value)} style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 14, fontFamily: "inherit", background: "#fafafa", outline: "none", cursor: "pointer" }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
// Éditeur d'une grille de tranches { min, max, price } pour une catégorie + un type d'option.
// tiers : tableau de tranches. onChange(newTiers) : appelé à chaque modification.
// Réglage "Monter à l'étage" pour un article : quantité max transportable par trajet + prix du trajet.
function EtageBaremeFields({ cfg, onChange }) {
  const c = cfg || { batchSize: "", price: "" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: "#999" }}>Quantité max par trajet</span>
      <input type="number" min="1" value={c.batchSize ?? ""} onChange={e => onChange({ ...c, batchSize: e.target.value })} style={{ width: 60, padding: "6px 8px", borderRadius: 6, border: "1.5px solid #e5e7eb", fontSize: 13, fontFamily: "inherit" }} />
      <span style={{ fontSize: 12, color: "#999" }}>→ Prix par trajet</span>
      <input type="number" min="0" step="0.1" value={c.price ?? ""} onChange={e => onChange({ ...c, price: e.target.value })} style={{ width: 64, padding: "6px 8px", borderRadius: 6, border: "1.5px solid #e5e7eb", fontSize: 13, fontFamily: "inherit" }} />
      <span style={{ fontSize: 12, color: "#999" }}>€</span>
    </div>
  );
}
// Réglage "Mise en place" pour un article : simple prix unitaire (× quantité commandée).
function MiseEnPlaceBaremeFields({ cfg, onChange }) {
  const c = cfg || { unitPrice: "" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: "#999" }}>Prix par unité</span>
      <input type="number" min="0" step="0.01" value={c.unitPrice ?? ""} onChange={e => onChange({ ...c, unitPrice: e.target.value })} style={{ width: 64, padding: "6px 8px", borderRadius: 6, border: "1.5px solid #e5e7eb", fontSize: 13, fontFamily: "inherit" }} />
      <span style={{ fontSize: 12, color: "#999" }}>€</span>
    </div>
  );
}
function TimeInput({ label, value, onChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase" }}>{label}</label>
      <input type="time" value={value || ""} onChange={e => onChange(e.target.value)} style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 14, fontFamily: "inherit", background: "#fafafa", outline: "none" }} />
    </div>
  );
}
function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: 18, width: "100%", maxWidth: wide ? 820 : 520, maxHeight: "92vh", overflowY: "auto", overflowX: "hidden", boxShadow: "0 24px 64px rgba(0,0,0,0.22)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</h2>
          <Btn variant="ghost" onClick={onClose} style={{ width: 32, height: 32, padding: 0, borderRadius: 8, flexShrink: 0 }}><span style={{ width: 18, height: 18, display: "block" }}>{I.x}</span></Btn>
        </div>
        {children}
      </div>
    </div>
  );
}
// Remplace window.confirm() : peu fiable (parfois invisible, laissant l'app comme figée)
// dans les PWA installées sur l'écran d'accueil iPhone. Utilisation :
//   const [askConfirm, ConfirmUI] = useConfirm();
//   onClick={async () => { if (await askConfirm("Supprimer ?")) ...; }}
//   return <>...{ConfirmUI}</>;
function useConfirm() {
  const [state, setState] = useState(null); // { message, resolve }
  const ask = (message) => new Promise(resolve => setState({ message, resolve }));
  const handle = (result) => { setState(s => { if (s) s.resolve(result); return null; }); };
  const ConfirmUI = (
    <Modal open={!!state} onClose={() => handle(false)} title="Confirmation">
      {state && <>
        <div style={{ fontSize: 15, color: "#1a1a2e", marginBottom: 22, lineHeight: 1.5 }}>{state.message}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Btn variant="secondary" onClick={() => handle(false)}>Annuler</Btn>
          <Btn variant="danger" onClick={() => handle(true)}>Confirmer</Btn>
        </div>
      </>}
    </Modal>
  );
  return [ask, ConfirmUI];
}
function SignaturePad({ onSave, onClose, title }) {
  const canvasRef = useRef(null), drawing = useRef(false), lastPos = useRef({ x: 0, y: 0 });
  const getPos = (e, c) => { const r = c.getBoundingClientRect(); const sx = c.width / r.width, sy = c.height / r.height; const src = e.touches ? e.touches[0] : e; return { x: (src.clientX - r.left) * sx, y: (src.clientY - r.top) * sy }; };
  const start = (e) => { e.preventDefault(); drawing.current = true; lastPos.current = getPos(e, canvasRef.current); };
  const move = (e) => { e.preventDefault(); if (!drawing.current) return; const c = canvasRef.current, ctx = c.getContext("2d"), p = getPos(e, c); ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(p.x, p.y); ctx.strokeStyle = "#1a1a2e"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.stroke(); lastPos.current = p; };
  const stop = (e) => { e.preventDefault(); drawing.current = false; };
  const clear = () => { const c = canvasRef.current; c.getContext("2d").clearRect(0, 0, c.width, c.height); };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 480 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>✍️ {title}</h3>
          <Btn variant="ghost" onClick={onClose} style={{ padding: 6 }}><span style={{ width: 20, height: 20 }}>{I.x}</span></Btn>
        </div>
        <div style={{ fontSize: 12, color: "#999", marginBottom: 10, textAlign: "center" }}>Signez avec votre doigt ou stylet</div>
        <div style={{ border: "2px solid #1a1a2e", borderRadius: 12, overflow: "hidden", background: "#fafafa", marginBottom: 14, touchAction: "none" }}>
          <canvas ref={canvasRef} width={800} height={280} style={{ width: "100%", height: 180, display: "block", touchAction: "none" }}
            onMouseDown={start} onMouseMove={move} onMouseUp={stop} onMouseLeave={stop} onTouchStart={start} onTouchMove={move} onTouchEnd={stop} />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn variant="secondary" onClick={clear} style={{ flex: 1 }}>🗑️ Effacer</Btn>
          <Btn variant="primary" onClick={() => { onSave(canvasRef.current.toDataURL("image/png")); onClose(); }} style={{ flex: 1 }}><span style={{ width: 16, height: 16 }}>{I.check}</span> Valider</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── BON DE LIVRAISON/RETOUR : commentaire + photos + signature client ───────
// Réutilisé à la fois pour la confirmation de livraison ET de retour (mêmes champs).
// Les photos/signature sont uploadées vers Firebase Storage AVANT d'appeler onConfirm,
// pour ne jamais stocker d'images en base64 dans le document Firestore "orders" partagé.
function BonCapture({ orderId, kind, confirmLabel, onConfirm }) {
  const [comment, setComment] = useState("");
  const [photos, setPhotos] = useState([]); // [{file, preview}]
  const [signataire, setSignataire] = useState("");
  const [signatureData, setSignatureData] = useState(null);
  const [showSig, setShowSig] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const addPhotos = (files) => {
    const room = 6 - photos.length;
    if (room <= 0) return;
    const list = Array.from(files).slice(0, room);
    const withPreview = list.map(file => ({ file, preview: URL.createObjectURL(file) }));
    setPhotos(prev => [...prev, ...withPreview]);
  };
  const removePhoto = (idx) => setPhotos(prev => prev.filter((_, i) => i !== idx));

  const canConfirm = !!signataire.trim() && !!signatureData;

  const handleConfirm = async () => {
    if (!canConfirm) { setError("Le nom du signataire et la signature sont obligatoires."); return; }
    setError(null);
    setUploading(true);
    try {
      const photoUrls = [];
      for (let i = 0; i < photos.length; i++) {
        photoUrls.push(await uploadPhoto(orderId, kind, photos[i].file, i));
      }
      const signatureUrl = await uploadSignature(orderId, kind, signatureData);
      await onConfirm({ comment, photos: photoUrls, signature: signatureUrl, signedBy: signataire.trim(), signedAt: new Date().toISOString() });
    } catch (e) {
      console.error(e);
      setError("Erreur lors de l'envoi (photos/signature). Vérifie ta connexion et réessaie.");
    }
    setUploading(false);
  };

  return (
    <form autoComplete="off" onSubmit={e => e.preventDefault()} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Commentaire sur l'état du matériel</label>
        <textarea name="bon-comment-libre" value={comment} onChange={e => setComment(e.target.value)} rows={3} placeholder="Ex : tout conforme, RAS / 2 chaises légèrement abîmées..." autoComplete="off" autoCorrect="on" autoCapitalize="sentences" spellCheck="true" style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 14, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase", display: "block", marginBottom: 6 }}>📷 Photos ({photos.length}/6)</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {photos.map((p, i) => (
            <div key={i} style={{ position: "relative", width: 70, height: 70 }}>
              <img src={p.preview} style={{ width: 70, height: 70, borderRadius: 10, objectFit: "cover", display: "block" }} />
              <button type="button" onClick={() => removePhoto(i)} style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: "50%", background: "#ef4444", color: "#fff", border: "2px solid #fff", fontWeight: 900, fontSize: 12, cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>
          ))}
          {photos.length < 6 && (
            <button type="button" onClick={() => fileInputRef.current && fileInputRef.current.click()} style={{ width: 70, height: 70, borderRadius: 10, border: "1.5px dashed #9ca3af", background: "#f9fafb", cursor: "pointer", fontSize: 26, color: "#9ca3af", fontFamily: "inherit" }}>+</button>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" multiple style={{ display: "none" }} onChange={e => { if (e.target.files) addPhotos(e.target.files); e.target.value = ""; }} />
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase", display: "block", marginBottom: 6 }}>✍️ Signature client (obligatoire)</label>
        <input name="bon-signataire-libre" value={signataire} onChange={e => setSignataire(e.target.value)} placeholder="Nom du signataire" autoComplete="off" autoCorrect="on" autoCapitalize="words" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 13, fontFamily: "inherit", marginBottom: 8, boxSizing: "border-box" }} />
        <div onClick={() => setShowSig(true)} style={{ border: "1.5px dashed #10b981", borderRadius: 10, height: 90, background: "#f0fdf4", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          {signatureData ? <img src={signatureData} style={{ maxHeight: 86, maxWidth: "100%" }} /> : <span style={{ color: "#10b981", fontWeight: 700, fontSize: 13 }}>Appuyer pour signer</span>}
        </div>
      </div>
      {error && <div style={{ background: "#fef2f2", color: "#b91c1c", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700 }}>{error}</div>}
      <Btn variant="primary" disabled={!canConfirm || uploading} onClick={handleConfirm} style={{ width: "100%" }}>
        {uploading ? "⏳ Envoi en cours..." : confirmLabel}
      </Btn>
      {showSig && <SignaturePad title="Signature client" onSave={d => setSignatureData(d)} onClose={() => setShowSig(false)} />}
    </form>
  );
}

// ─── BIBLIOTHÈQUE CLIENTS ─────────────────────────────────────────────────────
function ClientLibrary({ clients, setClients, onSelect, onClose, embedded, settings, orders }) {
  const [askConfirm, ConfirmUI] = useConfirm();
  const [search, setSearch] = useState("");
  const [addMode, setAddMode] = useState(false);
  const [editId, setEditId] = useState(null); // id du client en cours de modification (null = création)
  const [selectedId, setSelectedId] = useState(null); // id du client dont la carte est "ouverte" (affiche les actions)
  const [navAddr, setNavAddr] = useState(null); // adresse pour la popup de navigation
  const [form, setForm] = useState({ name: "", phones: [""], email: "", addresses: [""], notes: "" });
  // Sélection multiple pour l'envoi de campagnes email (uniquement dans la vue Clients principale)
  const [campaignSelection, setCampaignSelection] = useState(new Set());
  const [showCampaignComposer, setShowCampaignComposer] = useState(false);
  const toggleCampaignSel = (id) => setCampaignSelection(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setPhone = (i, v) => setForm(f => ({ ...f, phones: f.phones.map((p, idx) => idx === i ? v : p) }));
  const addPhone = () => setForm(f => ({ ...f, phones: [...f.phones, ""] }));
  const removePhone = (i) => setForm(f => ({ ...f, phones: f.phones.filter((_, idx) => idx !== i) }));
  const setAddress = (i, v) => setForm(f => ({ ...f, addresses: f.addresses.map((a, idx) => idx === i ? v : a) }));
  const addAddress = () => setForm(f => ({ ...f, addresses: [...f.addresses, ""] }));
  const removeAddress = (i) => setForm(f => ({ ...f, addresses: f.addresses.filter((_, idx) => idx !== i) }));
  // Affiche tous les numéros d'un client (rétrocompatible : ancien champ "phone" ou nouveau tableau "phones")
  const clientPhones = (c) => c.phones && c.phones.length ? c.phones.filter(Boolean) : (c.phone ? [c.phone] : []);
  // Affiche toutes les adresses d'un client (rétrocompatible : ancien champ "address" ou nouveau tableau "addresses")
  const clientAddresses = (c) => c.addresses && c.addresses.length ? c.addresses.filter(Boolean) : (c.address ? [c.address] : []);
  const filtered = clients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || clientPhones(c).some(p => p.includes(search)) || (c.email || "").toLowerCase().includes(search.toLowerCase()));
  const resetForm = () => { setForm({ name: "", phones: [""], email: "", addresses: [""], notes: "" }); setEditId(null); setAddMode(false); };
  const startEdit = (client) => {
    setForm({
      name: client.name || "",
      phones: clientPhones(client).length ? clientPhones(client) : [""],
      email: client.email || "",
      addresses: clientAddresses(client).length ? clientAddresses(client) : [""],
      notes: client.notes || "",
    });
    setEditId(client.id);
    setAddMode(true);
  };
  const save = () => {
    if (!form.name.trim()) { alert("Nom requis"); return; }
    const phones = form.phones.map(p => p.trim()).filter(Boolean);
    const addresses = form.addresses.map(a => a.trim()).filter(Boolean);
    if (editId) {
      // Modification d'un client existant
      setClients(prev => prev.map(c => c.id === editId ? { ...c, ...form, phones, phone: phones[0] || "", addresses, address: addresses[0] || "" } : c));
    } else {
      // Création
      setClients(prev => [...prev, { ...form, phones, phone: phones[0] || "", addresses, address: addresses[0] || "", id: "cli-" + Date.now() }]);
    }
    resetForm();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {!addMode ? (
        <>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><Inp placeholder="🔍 Rechercher un client..." value={search} onChange={setSearch} /></div>
            <Btn variant="secondary" size="sm" onClick={() => { setEditId(null); setForm({ name: "", phones: [""], email: "", addresses: [""], notes: "" }); setAddMode(true); }}><span style={{ width: 14, height: 14 }}>{I.plus}</span> Nouveau</Btn>
          </div>
          {embedded && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, background: "#f8f9ff", borderRadius: 10, padding: "10px 14px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                <input type="checkbox" checked={filtered.length > 0 && filtered.every(c => campaignSelection.has(c.id))} onChange={e => {
                  setCampaignSelection(prev => {
                    const next = new Set(prev);
                    if (e.target.checked) filtered.forEach(c => next.add(c.id)); else filtered.forEach(c => next.delete(c.id));
                    return next;
                  });
                }} style={{ width: 16, height: 16 }} />
                Tout sélectionner {campaignSelection.size > 0 && `(${campaignSelection.size} sélectionné${campaignSelection.size > 1 ? "s" : ""})`}
              </label>
              <Btn variant="primary" size="sm" disabled={campaignSelection.size === 0} onClick={() => setShowCampaignComposer(true)}>📧 Envoyer une campagne</Btn>
            </div>
          )}
          <div style={{ maxHeight: embedded ? "none" : 420, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.length === 0 ? <div style={{ textAlign: "center", padding: 30, color: "#999" }}><div style={{ fontSize: 32, marginBottom: 8 }}>👤</div>Aucun client</div>
            : filtered.map(client => {
              const isSelected = selectedId === client.id;
              const clientOrders = (orders || []).filter(o => o.clientName === client.name).sort((a, b) => (b.closedAt || b.returnDate || b.deliveryDate || "").localeCompare(a.closedAt || a.returnDate || a.deliveryDate || ""));
              return (
              <div key={client.id}>
              <div onClick={() => setSelectedId(isSelected ? null : client.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: isSelected ? "#eef2ff" : "#f8f9fa", borderRadius: isSelected ? "12px 12px 0 0" : 12, border: `1.5px solid ${isSelected ? "#c7d2fe" : "#f0f0f0"}`, borderBottom: isSelected ? "none" : undefined, cursor: "pointer" }}>
                {embedded && (
                  <input type="checkbox" checked={campaignSelection.has(client.id)} onClick={e => e.stopPropagation()} onChange={() => toggleCampaignSel(client.id)} style={{ width: 18, height: 18, flexShrink: 0 }} />
                )}
                <div style={{ width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg, #1a1a2e, #3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: 16, flexShrink: 0 }}>{client.name.charAt(0).toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 14 }}>{client.name}</div>
                  <div style={{ fontSize: 12, color: "#666" }}>{clientPhones(client).join(" · ")}{client.email ? ` · ${client.email}` : ""}</div>
                  {clientAddresses(client).map((addr, ai) => (
                    <button key={ai} onClick={(e) => { e.stopPropagation(); setNavAddr(addr); }} style={{ display: "block", background: "none", border: "none", padding: 0, fontSize: 11, color: "#3b82f6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>📍 {addr}{ai === 0 && clientAddresses(client).length > 1 ? " (principale)" : ""}</button>
                  ))}
                  {client.notes && <div style={{ fontSize: 11, color: "#f59e0b" }}>💡 {client.notes}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  {onSelect && <Btn variant="primary" size="sm" onClick={() => { onSelect(client); onClose && onClose(); }}>Choisir</Btn>}
                  {isSelected && <>
                    <Btn variant="secondary" size="sm" onClick={() => startEdit(client)}>✏️</Btn>
                    <Btn variant="danger" size="sm" onClick={async () => { if (await askConfirm(`Supprimer ${client.name} ?`)) setClients(prev => prev.filter(c => c.id !== client.id), true); }}><span style={{ width: 13, height: 13 }}>{I.trash}</span></Btn>
                  </>}
                </div>
              </div>
              {isSelected && orders && (
                <div style={{ background: "#fff", border: "1.5px solid #c7d2fe", borderTop: "1px solid #e5e7eb", borderRadius: "0 0 12px 12px", padding: "10px 14px" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#666", textTransform: "uppercase", marginBottom: 8 }}>📋 Historique ({clientOrders.length} commande{clientOrders.length > 1 ? "s" : ""})</div>
                  {clientOrders.length === 0 ? (
                    <div style={{ fontSize: 13, color: "#999" }}>Aucune commande pour ce client.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                      {clientOrders.map(o => (
                        <div key={o.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", background: "#f8f9fa", borderRadius: 8, fontSize: 13 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700 }}>{o.id}</div>
                            <div style={{ color: "#999", fontSize: 11 }}>{fmtD(o.deliveryDate)} · {o.status}</div>
                          </div>
                          <div style={{ fontWeight: 800, color: "#10b981", flexShrink: 0 }}>{orderTotal(o, settings).toFixed(2)} €</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              </div>
              );
            })}
          </div>
          <NavChoiceModal open={!!navAddr} address={navAddr} onClose={() => setNavAddr(null)} />
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{editId ? "✏️ Modifier le client" : "➕ Nouveau client"}</h3>
          <Inp label="Nom complet *" value={form.name} onChange={v => setF("name", v)} required />
          {/* Numéros de téléphone (plusieurs possibles) */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#444", marginBottom: 6 }}>Téléphone(s)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {form.phones.map((p, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ flex: 1 }}><Inp placeholder={i === 0 ? "Numéro principal" : "Numéro supplémentaire"} value={p} onChange={v => setPhone(i, v)} /></div>
                  {form.phones.length > 1 && <Btn variant="danger" size="sm" onClick={() => removePhone(i)}><span style={{ width: 13, height: 13 }}>{I.trash}</span></Btn>}
                </div>
              ))}
            </div>
            <button onClick={addPhone} style={{ marginTop: 8, background: "none", border: "1.5px dashed #3b82f6", color: "#3b82f6", borderRadius: 8, padding: "6px 12px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>+ Ajouter un numéro</button>
          </div>
          <Inp label="Email" value={form.email} onChange={v => setF("email", v)} />
          {/* Adresses multiples (ex : adresse client + adresse de livraison différente) */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#444", marginBottom: 6 }}>Adresse(s)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {form.addresses.map((a, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ flex: 1 }}><Inp placeholder={i === 0 ? "Adresse principale" : "Adresse de livraison supplémentaire"} value={a} onChange={v => setAddress(i, v)} /></div>
                  {form.addresses.length > 1 && <Btn variant="danger" size="sm" onClick={() => removeAddress(i)}><span style={{ width: 13, height: 13 }}>{I.trash}</span></Btn>}
                </div>
              ))}
            </div>
            <button onClick={addAddress} style={{ marginTop: 8, background: "none", border: "1.5px dashed #3b82f6", color: "#3b82f6", borderRadius: 8, padding: "6px 12px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>+ Ajouter une adresse</button>
          </div>
          <Inp label="Notes" value={form.notes} onChange={v => setF("notes", v)} />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="secondary" onClick={resetForm}>Annuler</Btn>
            <Btn variant="primary" onClick={save}><span style={{ width: 14, height: 14 }}>{I.check}</span> {editId ? "Mettre à jour" : "Enregistrer"}</Btn>
          </div>
        </div>
      )}

      {embedded && (
        <CampaignComposer
          open={showCampaignComposer}
          onClose={() => setShowCampaignComposer(false)}
          selectedClients={clients.filter(c => campaignSelection.has(c.id))}
          settings={settings}
          onSent={() => { setCampaignSelection(new Set()); setShowCampaignComposer(false); }}
        />
      )}
      {ConfirmUI}
    </div>
  );
}

function CampaignComposer({ open, onClose, selectedClients, settings, onSent }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); // {type, text}

  const withEmail = selectedClients.filter(c => c.email && !c.unsubscribed);
  const withoutEmail = selectedClients.length - withEmail.length;
  const accent = (settings && settings.campaignAccentColor) || "#1a1a2e";
  const logo = bannerUrl || (settings && settings.campaignLogoUrl) || "";

  const lighten = (hex, amt) => {
    try {
      const h = hex.replace("#", "");
      const num = parseInt(h, 16);
      let r = (num >> 16) + amt, g = ((num >> 8) & 0x00FF) + amt, b = (num & 0x0000FF) + amt;
      r = Math.min(255, Math.max(0, r)); g = Math.min(255, Math.max(0, g)); b = Math.min(255, Math.max(0, b));
      return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, "0")}`;
    } catch { return hex; }
  };
  const buildHtml = () => `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;">
      ${logo ? `<img src="${logo}" alt="" style="width:100%;display:block;" />` : `
      <div style="background:linear-gradient(135deg, ${accent}, ${lighten(accent, 60)});padding:44px 24px;text-align:center;color:#fff;">
        <div style="font-size:36px;margin-bottom:10px;">🎉</div>
        <div style="font-size:28px;font-weight:900;letter-spacing:0.3px;">${(settings && settings.campaignSenderName) || "EventDream"}</div>
        <div style="font-size:12px;opacity:0.85;margin-top:8px;letter-spacing:1.5px;text-transform:uppercase;">Location de matériel événementiel</div>
      </div>`}
      <div style="padding:28px 24px;color:#1a1a2e;font-size:15px;line-height:1.6;">
        ${message.split("\n").map(p => `<p>${p}</p>`).join("")}
      </div>
      <div style="background:#f8f8f8;padding:16px 24px;text-align:center;font-size:11px;color:#999;">
        Vous recevez cet email car vous êtes client(e) de ${(settings && settings.campaignSenderName) || "EventDream"}.<br/>
        <a href="{{UNSUBSCRIBE_URL}}" style="color:#999;">Se désabonner de ces emails</a>
      </div>
    </div>`;

  const send = async () => {
    if (!subject.trim() || !message.trim()) { setResult({ type: "err", text: "Objet et message requis." }); return; }
    if (!withEmail.length) { setResult({ type: "err", text: "Aucun destinataire avec email valide dans la sélection." }); return; }
    setSending(true); setResult(null);
    try {
      const res = await sendCampaignEmail({ subject, htmlBody: buildHtml(), recipientIds: selectedClients.map(c => c.id) });
      setResult({ type: "ok", text: `✅ ${res.sent} email(s) envoyé(s)${res.failed ? `, ${res.failed} échec(s)` : ""}${res.skipped ? `, ${res.skipped} ignoré(s) (désabonné/sans email)` : ""}.` });
      setTimeout(() => { onSent && onSent(); setSubject(""); setMessage(""); setBannerUrl(""); setResult(null); }, 2500);
    } catch (e) {
      setResult({ type: "err", text: "Erreur : " + (e.message || "envoi impossible.") });
    }
    setSending(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="📧 Composer une campagne" wide>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 13, color: "#666" }}>
          Destinataires : <strong>{withEmail.length}</strong> avec email valide{withoutEmail > 0 && <span style={{ color: "#f59e0b" }}> ({withoutEmail} ignoré(s), sans email ou désabonné(s))</span>}
        </div>
        <Inp label="Objet de l'email" value={subject} onChange={setSubject} placeholder="Profitez de -20% sur votre prochain événement !" />
        <Inp label="Image de bannière (optionnel, sinon le logo des réglages est utilisé)" value={bannerUrl} onChange={setBannerUrl} placeholder="https://..." />
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: "#666", display: "block", marginBottom: 4 }}>Message</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={6} placeholder="Bonjour, nous avons une offre spéciale pour vous..." style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", resize: "vertical" }} />
          <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>💡 Utilise <code>{"{{nom}}"}</code> n'importe où dans ton message pour personnaliser avec le prénom du client.</div>
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: "#666", display: "block", marginBottom: 6 }}>Aperçu</label>
          <div style={{ border: "1.5px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }} dangerouslySetInnerHTML={{ __html: buildHtml().replace(/{{nom}}/g, "Jean").replace(/{{UNSUBSCRIBE_URL}}/g, "#") }} />
        </div>
        {result && <div style={{ background: result.type === "ok" ? "#d1fae5" : "#fee2e2", color: result.type === "ok" ? "#065f46" : "#b91c1c", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700 }}>{result.text}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Btn variant="secondary" onClick={onClose}>Annuler</Btn>
          <Btn variant="primary" onClick={send} disabled={sending}>{sending ? "⏳ Envoi en cours..." : `📧 Envoyer à ${withEmail.length} client(s)`}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── FORMULAIRE DEVIS (assistant par étapes) ─────────────────────────────────
function OrderForm({ initial, onSave, onClose, onAutosave, allOrders, clients, settings, stock }) {
  const empty = {
    id: genDevisId(allOrders || []), clientName: "", clientPhone: "", clientPhones: [], clientEmail: "", address: "",
    deliveryMode: "retrait", deliveryKm: 0, deliveryMin: 0, trajetAller: true, trajetRetour: true, deliveryPriceManual: "", extraDaysPriceManual: "",
    deliveryDate: "", deliveryTime: "", returnDate: "", returnTime: "",
    items: [], discountType: "fixed", discountValue: 0,
    acompte: 0, acompteMoyen: "", status: "Devis", phase: "livraison", notes: "",
  };
  const [form, setForm] = useState(initial || empty);
  const [step, setStep] = useState(1);
  // Remonte en haut de la fenêtre à chaque changement d'étape (sinon le défilement reste
  // à la même position qu'avant, ce qui fait démarrer la nouvelle étape "en bas").
  const stepTopRef = useRef(null);
  useEffect(() => { stepTopRef.current?.scrollIntoView({ block: "start" }); }, [step]);
  const [search, setSearch] = useState("");
  const [catTab, setCatTab] = useState("articles");
  const [selectedCat, setSelectedCat] = useState("Toutes");
  const [showClientLib, setShowClientLib] = useState(false);
  const [showAddressField, setShowAddressField] = useState(!!(initial && initial.address));
  const [cautionForced, setCautionForced] = useState(!!(initial && (initial.cautionMoyen || initial.cautionManual)));
  const [computingDist, setComputingDist] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // ─── BROUILLON AUTOMATIQUE ──────────────────────────────────────────────
  // Si le nom du client est rempli (option A), on enregistre automatiquement un
  // brouillon 2 secondes après la dernière modification, sans fermer le formulaire.
  // Le brouillon devient un vrai devis à la validation finale.
  const finalisedRef = useRef(false); // true une fois le devis validé/fermé (stoppe l'autosave)
  useEffect(() => {
    if (!onAutosave) return;
    // On n'enregistre un brouillon que pour une NOUVELLE commande (pas l'édition d'un devis existant)
    if (initial && initial.status && initial.status !== "Brouillon") return;
    if (finalisedRef.current) return;
    if (!form.clientName || !form.clientName.trim()) return; // Option A : nom requis
    const t = setTimeout(() => {
      if (finalisedRef.current) return;
      onAutosave({ ...form, status: "Brouillon" });
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2000);
    }, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);


  const sub = orderSubtotal(form);
  const disc = orderDiscount(form);
  const delCost = deliveryCostOf(form, settings);
  const delExtras = deliveryExtrasCost(form);
  const extraDaysNb = extraDaysCount(form, settings);
  const extraDaysCostAuto = extraDaysNb > 0 ? extraDaysNb * sub : 0;
  const extraDaysCostFinal = extraDaysCost(form, settings);
  const cautionAmount = cautionCost(form, stock);
  const total = orderTotal(form, settings);
  const reste = total - (parseFloat(form.acompte) || 0);
  const unitTrajet = calcTrajet(parseFloat(form.deliveryKm) || 0, parseFloat(form.deliveryMin) || 0, settings);

  const applyClient = (c) => {
    const allPhones = (c.phones && c.phones.length ? c.phones : (c.phone ? [c.phone] : [])).filter(Boolean);
    const allAddresses = (c.addresses && c.addresses.length ? c.addresses : (c.address ? [c.address] : [])).filter(Boolean);
    if (allAddresses.length > 0) setShowAddressField(true);
    setForm(f => ({ ...f, clientName: c.name, clientPhone: allPhones[0] || "", clientPhones: allPhones, clientEmail: c.email, address: allAddresses[0] || "", clientAddresses: allAddresses }));
  };

  // Auto-complétion client : cherche dans la bibliothèque au fur et à mesure de la saisie
  // (nom, téléphone ou email), sans avoir besoin d'ouvrir la bibliothèque séparément.
  const [activeSuggestField, setActiveSuggestField] = useState(null); // "name" | "email" | "phone" | null
  const clientMatches = (query) => {
    if (!query || query.trim().length < 2) return [];
    const q = query.trim().toLowerCase();
    return (clients || []).filter(c => {
      const phones = (c.phones && c.phones.length ? c.phones : (c.phone ? [c.phone] : []));
      return (c.name || "").toLowerCase().includes(q) || phones.some(p => p.includes(q)) || (c.email || "").toLowerCase().includes(q);
    }).slice(0, 6);
  };
  const blurSuggest = (field) => setTimeout(() => setActiveSuggestField(f => f === field ? null : f), 150);
  const SuggestDropdown = ({ field, query }) => {
    const matches = activeSuggestField === field ? clientMatches(query) : [];
    if (!matches.length) return null;
    return (
      <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 10, marginTop: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", zIndex: 50, maxHeight: 220, overflowY: "auto" }}>
        {matches.map(c => (
          <div key={c.id} onClick={() => { applyClient(c); setActiveSuggestField(null); }} style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #f5f5f5" }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</div>
            <div style={{ fontSize: 12, color: "#999" }}>{c.phone || ""}{c.email ? " · " + c.email : ""}</div>
          </div>
        ))}
      </div>
    );
  };

  const addItem = (p) => { const ex = form.items.find(i => i.id === p.id); if (ex) set("items", form.items.map(i => i.id === p.id ? { ...i, qty: i.qty + 1 } : i)); else set("items", [...form.items, { ...p, price: p.price, qty: 1 }]); };
  const updQty = (id, raw) => {
    if (raw === "") { set("items", form.items.map(i => i.id === id ? { ...i, qty: "" } : i)); return; }
    const v = parseInt(raw);
    if (!isNaN(v) && v >= 1) set("items", form.items.map(i => i.id === id ? { ...i, qty: v } : i));
    else if (!isNaN(v) && v <= 0) set("items", form.items.filter(i => i.id !== id));
  };
  const updPrice = (id, v) => set("items", form.items.map(i => i.id === id ? { ...i, price: parseFloat(v) || 0 } : i));

  const autoDistance = async () => {
    if (!settings.googleMapsKey) { alert("Configurez une clé Google Maps dans les Réglages pour le calcul automatique."); return; }
    if (!form.address) { alert("Saisissez l'adresse du client d'abord."); return; }
    setComputingDist(true);
    const res = await computeDistance(settings.warehouseAddress, form.address, settings.googleMapsKey);
    setComputingDist(false);
    if (res) { set("deliveryKm", res.km); set("deliveryMin", res.min); }
    else alert("Calcul impossible. Vérifiez l'adresse et la clé API.");
  };

  // ─── CALCUL AUTOMATIQUE DE LA DISTANCE ───────────────────────────────────
  // Dès que l'adresse est renseignée (mode livraison) et qu'une clé Google Maps
  // existe, on calcule automatiquement km/min/prix sans cliquer sur "Auto".
  const lastGeocodedRef = useRef("");
  useEffect(() => {
    if (form.deliveryMode !== "livraison") return;
    if (!settings.googleMapsKey || !settings.warehouseAddress) return;
    const addr = (form.address || "").trim();
    if (addr.length < 8) return; // adresse trop courte
    if (addr === lastGeocodedRef.current) return; // déjà calculé pour cette adresse
    const t = setTimeout(async () => {
      lastGeocodedRef.current = addr;
      setComputingDist(true);
      const res = await computeDistance(settings.warehouseAddress, addr, settings.googleMapsKey);
      setComputingDist(false);
      if (res) setForm(f => ({ ...f, deliveryKm: res.km, deliveryMin: res.min }));
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.address, form.deliveryMode]);

  // Le catalogue du devis est construit à partir du STOCK réel (articles ajoutés
  // inclus) + les kits. Ainsi un nouvel article appara\u00eet ici avec sa catégorie.
  const stockArticles = useMemo(() => (stock || []).map(s => ({ id: s.id, name: s.name, price: parseFloat(s.price) || 0, icon: s.icon || "📦", category: s.category || "Autre", unit: s.unit || "unité", components: s.components || null, cleaningOption: !!s.cleaningOption, cleaningPrice: parseFloat(s.cleaningPrice) || 0 })), [stock]);
  const allCatalog = useMemo(() => stockArticles.length > 0 ? [...stockArticles.filter(a => !a.components), ...stockArticles.filter(a => a.components)] : CATALOG, [stockArticles]);
  const filtered = allCatalog.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) && (catTab === "kits" ? (c.category === "Kits" || c.components) : (c.category !== "Kits" && !c.components)) && (selectedCat === "Toutes" || c.category === selectedCat));
  const cats = [...new Set(filtered.map(c => c.category))];
  const allCatsForTab = [...new Set(allCatalog.filter(c => catTab === "kits" ? (c.category === "Kits" || c.components) : (c.category !== "Kits" && !c.components)).map(c => c.category))];

  // Disponibilité par article sur la PÉRIODE de ce devis (livraison → retour), en tenant compte
  // des autres commandes actives qui se chevauchent sur les mêmes dates — affichée en direct à
  // l'étape Matériel pour ne pas découvrir un manque de stock seulement à l'enregistrement.
  const dispoParArticle = useMemo(() => {
    const myPeriod = orderPeriod(form);
    const dispo = {};
    if (!myPeriod) {
      // Pas encore de date choisie : on affiche le stock total possédé, sans tenir compte des réservations.
      for (const s of (stock || [])) dispo[s.id] = parseInt(s.total) || 0;
      return dispo;
    }
    const occupying = (allOrders || []).filter(o =>
      o.id !== form.id &&
      !["Brouillon", "Devis", "Clôturée"].includes(o.status) &&
      periodsOverlap(orderPeriod(o), myPeriod)
    );
    const reserved = {};
    for (const o of occupying) {
      const n = expandToBaseNeeds(o.items, stock);
      for (const id in n) reserved[id] = (reserved[id] || 0) + n[id];
    }
    for (const s of (stock || [])) {
      dispo[s.id] = (parseInt(s.total) || 0) - (reserved[s.id] || 0);
    }
    return dispo;
  }, [stock, allOrders, form.id, form.deliveryDate, form.returnDate]);

  // Disponibilité affichée pour un article du catalogue (gère les kits : limité par le composant
  // le plus rare), en EXCLUANT la quantité déjà mise dans le panier de CE devis (sinon elle se
  // soustrairait elle-même puisqu'elle n'est pas encore "réservée" ailleurs).
  const getDispoPourPicker = (p) => {
    if (p.components && p.components.length > 0) {
      return Math.min(...p.components.map(c => {
        const d = dispoParArticle[c.id];
        if (d === undefined) return 0;
        return Math.floor(d / (parseInt(c.qty) || 1));
      }));
    }
    return dispoParArticle[p.id] !== undefined ? dispoParArticle[p.id] : null;
  };

  const MOYEN_OPTS = [{ value: "", label: "-- Choisir --" }, { value: "paypal", label: "💙 PayPal" }, { value: "virement", label: "🏦 Virement" }, { value: "especes", label: "💵 Espèces" }, { value: "cheque", label: "📄 Chèque" }, { value: "cb", label: "💳 CB" }];

  const steps = [
    { n: 1, label: "Client", icon: "👤" },
    { n: 2, label: "Matériel", icon: "📦" },
    { n: 3, label: "Livraison", icon: "🚚" },
    { n: 4, label: "Paiement", icon: "💶" },
  ];

  const canNext = () => {
    if (step === 1) return !!form.clientName.trim();
    if (step === 2) return form.items.length > 0;
    if (step === 3) { if (form.deliveryMode === "livraison" && !form.address.trim()) return false; return !!form.deliveryDate; }
    return true;
  };

  const [stockAlert, setStockAlert] = useState(null);

  // Un devis avec un acompte versé est considéré comme confirmé (le client s'est engagé) —
  // sauf si le statut est déjà plus avancé (Préparée, Livrée...), qu'on ne rétrograde jamais.
  const computeFinalStatus = (currentStatus) => {
    const a = parseFloat(form.acompte) || 0;
    if (a > 0 && (!currentStatus || currentStatus === "Brouillon" || currentStatus === "Devis")) return "Confirmée";
    return currentStatus === "Brouillon" ? "Devis" : currentStatus;
  };
  // Un acompte versé sans moyen de paiement précisé n'est pas autorisé (pour la compta).
  const acompteMoyenManquant = () => (parseFloat(form.acompte) || 0) > 0 && !form.acompteMoyen;
  const [saveError, setSaveError] = useState(null);

  const handleSave = () => {
    if (acompteMoyenManquant()) { setSaveError("⚠️ Merci de sélectionner le moyen de paiement de l'acompte avant d'enregistrer."); return; }
    setSaveError(null);
    const shortages = stockShortage(form, allOrders, stock);
    if (shortages.length > 0) { setStockAlert(shortages); return; }
    finalisedRef.current = true;
    onSave({ ...form, status: computeFinalStatus(form.status) }); onClose();
  };
  // Réduit les quantités au stock disponible puis enregistre.
  // Gère aussi les kits : si le manque vient d'un composant à l'intérieur d'un kit, c'est la
  // quantité du KIT qui est réduite (limitée par son composant le plus contraint), et cette
  // consommation est répercutée sur les autres lignes qui partageraient le même composant.
  const saveReduced = () => {
    const shortages = stockAlert || [];
    const remaining = {};
    shortages.forEach(s => { remaining[s.id] = s.dispo; });
    const reduced = form.items.map(it => {
      if (it.components && it.components.length > 0) {
        let maxQty = parseInt(it.qty) || 0;
        for (const comp of it.components) {
          if (remaining[comp.id] !== undefined) {
            const perKit = parseInt(comp.qty) || 1;
            const maxForThisComp = Math.floor(remaining[comp.id] / perKit);
            maxQty = Math.min(maxQty, Math.max(0, maxForThisComp));
          }
        }
        const newQty = Math.min(parseInt(it.qty) || 0, maxQty);
        for (const comp of it.components) {
          if (remaining[comp.id] !== undefined) remaining[comp.id] -= newQty * (parseInt(comp.qty) || 1);
        }
        return { ...it, qty: newQty };
      } else {
        if (remaining[it.id] !== undefined) {
          const newQty = Math.min(parseInt(it.qty) || 0, Math.max(0, remaining[it.id]));
          remaining[it.id] -= newQty;
          return { ...it, qty: newQty };
        }
        return it;
      }
    }).filter(it => (parseInt(it.qty) || 0) > 0);
    const newForm = { ...form, items: reduced, status: computeFinalStatus(form.status) };
    setStockAlert(null);
    finalisedRef.current = true;
    onSave(newForm); onClose();
  };
  const saveAnyway = () => { setStockAlert(null); finalisedRef.current = true; onSave({ ...form, status: computeFinalStatus(form.status) }); onClose(); };

  // Enregistre le devis en cours comme BROUILLON (même incomplet), pour le finir plus tard.
  const saveDraft = () => {
    const draft = { ...form, status: "Brouillon" };
    onSave(draft); onClose();
  };

  return (
    <div ref={stepTopRef} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Indicateur brouillon auto */}
      {onAutosave && (
        <div style={{ fontSize: 12, fontWeight: 700, color: draftSaved ? "#10b981" : "#bbb", textAlign: "center", transition: "color 0.3s", minHeight: 16 }}>
          {draftSaved ? "💾 Brouillon enregistré automatiquement" : (form.clientName && form.clientName.trim() ? "✍️ Brouillon auto activé" : "✍️ Saisissez le nom du client pour activer la sauvegarde auto")}
        </div>
      )}
      {/* Stepper */}
      <div style={{ display: "flex", gap: 6 }}>
        {steps.map(s => (
          <button key={s.n} onClick={() => (s.n < step || canNext()) && setStep(s.n)} style={{
            flex: 1, padding: "10px 4px", borderRadius: 12, border: "2px solid",
            borderColor: step === s.n ? "#1a1a2e" : step > s.n ? "#10b981" : "#e5e7eb",
            background: step === s.n ? "#1a1a2e" : step > s.n ? "#f0fdf4" : "#fff",
            color: step === s.n ? "#fff" : step > s.n ? "#065f46" : "#999",
            cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
          }}>
            <span style={{ fontSize: 16 }}>{step > s.n ? "✓" : s.icon}</span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      {/* ÉTAPE 1 — CLIENT */}
      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>👤 Informations client</h3>
            <Btn variant="secondary" size="sm" onClick={() => setShowClientLib(true)}>📋 Bibliothèque</Btn>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ position: "relative" }} onFocus={() => setActiveSuggestField("name")} onBlur={() => blurSuggest("name")}>
              <Inp label="Nom complet" value={form.clientName} onChange={v => set("clientName", v)} placeholder="Jean Dupont" required />
              <SuggestDropdown field="name" query={form.clientName} />
            </div>
            <div style={{ position: "relative" }} onFocus={() => setActiveSuggestField("email")} onBlur={() => blurSuggest("email")}>
              <Inp label="Email" value={form.clientEmail} onChange={v => set("clientEmail", v)} placeholder="jean@email.com" />
              <SuggestDropdown field="email" query={form.clientEmail} />
            </div>
          </div>
          {!showAddressField ? (
            <button onClick={() => setShowAddressField(true)} style={{ alignSelf: "flex-start", background: "none", border: "1.5px dashed #3b82f6", color: "#3b82f6", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
              + Ajouter une adresse de livraison
            </button>
          ) : (
            <div>
              <Inp label="📍 Adresse de livraison (peut être différente de celle du client)" value={form.address} onChange={v => set("address", v)} placeholder="12 rue de la Paix, Paris (lieu de l'événement par exemple)" />
              {form.clientAddresses && form.clientAddresses.length > 1 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  <span style={{ fontSize: 11, color: "#6b7280", alignSelf: "center" }}>Adresses du client :</span>
                  {form.clientAddresses.map((a, i) => (
                    <button key={i} onClick={() => set("address", a)} style={{ fontSize: 11, padding: "5px 10px", borderRadius: 8, border: form.address === a ? "1.5px solid #1a1a2e" : "1px solid #e5e7eb", background: form.address === a ? "#1a1a2e" : "#fff", color: form.address === a ? "#fff" : "#374151", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      📍 {a}{i === 0 ? " (principale)" : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Numéros de téléphone multiples */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#444", marginBottom: 6 }}>Téléphone(s)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(form.clientPhones && form.clientPhones.length ? form.clientPhones : [form.clientPhone || ""]).map((p, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ flex: 1, position: "relative" }} onFocus={i === 0 ? () => setActiveSuggestField("phone") : undefined} onBlur={i === 0 ? () => blurSuggest("phone") : undefined}>
                    <Inp placeholder={i === 0 ? "Numéro principal" : "Numéro secondaire"} value={p} onChange={v => {
                      const phones = (form.clientPhones && form.clientPhones.length ? [...form.clientPhones] : [form.clientPhone || ""]);
                      phones[i] = v;
                      setForm(f => ({ ...f, clientPhone: phones[0] || "", clientPhones: phones }));
                    }} />
                    {i === 0 && <SuggestDropdown field="phone" query={p} />}
                  </div>
                  {(form.clientPhones && form.clientPhones.length > 1) && (
                    <Btn variant="danger" size="sm" onClick={() => {
                      const phones = (form.clientPhones || []).filter((_, idx) => idx !== i);
                      setForm(f => ({ ...f, clientPhone: phones[0] || "", clientPhones: phones }));
                    }}>✕</Btn>
                  )}
                </div>
              ))}
            </div>
            <button onClick={() => {
              const phones = form.clientPhones && form.clientPhones.length ? [...form.clientPhones, ""] : [form.clientPhone || "", ""];
              setForm(f => ({ ...f, clientPhones: phones }));
            }} style={{ marginTop: 8, background: "none", border: "1.5px dashed #d1d5db", borderRadius: 8, padding: "6px 14px", color: "#6b7280", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, width: "100%" }}>
              + Ajouter un numéro
            </button>
          </div>
          <div style={{ background: "#f0f4ff", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#6b7280" }}>Référence devis</span>
            <span style={{ fontFamily: "monospace", fontWeight: 800, color: "#1a1a2e" }}>{form.id}</span>
          </div>
        </div>
      )}

      {/* ÉTAPE 2 — MATÉRIEL */}
      {step === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>📅 Dates de la réservation</h3>
          <div style={{ background: "#eef2ff", borderRadius: 10, padding: 12, marginBottom: 4 }}>
            <Inp label="📅 Jour de l'événement (pré-remplit livraison J-1 et retour J+1)" type="date" value={form.eventDate || ""} onChange={v => {
              const shift = (d, n) => { if (!d) return ""; const dt = new Date(d + "T12:00:00"); dt.setDate(dt.getDate() + n); return dt.toISOString().split("T")[0]; };
              setForm(f => ({ ...f, eventDate: v, deliveryDate: shift(v, -1), returnDate: shift(v, 1) }));
            }} />
            <div style={{ fontSize: 12, color: "#6366f1", marginTop: 4 }}>Vous pouvez ensuite ajuster librement les dates ci-dessous.</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
            <Inp label={form.deliveryMode === "livraison" ? "Date livr." : "Date retrait"} type="date" value={form.deliveryDate} onChange={v => {
              // Enchaînement auto : en choisissant la date de livraison/retrait, on pré-remplit
              // l'heure (si vide, 16h par défaut) et la date de retour (J+1 si vide), pour éviter de tout saisir.
              setForm(f => {
                const next = { ...f, deliveryDate: v };
                if (!f.deliveryTime) next.deliveryTime = "16:00";
                if (!f.returnDate && v) { const dt = new Date(v + "T12:00:00"); dt.setDate(dt.getDate() + 1); next.returnDate = dt.toISOString().split("T")[0]; }
                if (!f.returnTime) next.returnTime = "16:00";
                return next;
              });
            }} required />
            <Inp label="Date retour" type="date" value={form.returnDate} onChange={v => {
              setForm(f => { const next = { ...f, returnDate: v }; if (!f.returnTime) next.returnTime = "16:00"; return next; });
            }} />
          </div>
          <div style={{ fontSize: 11, color: "#6366f1", marginTop: -6 }}>💡 Les horaires précis se règlent à l'étape suivante (heure par défaut : 16h, modifiable).</div>
          <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>📦 Sélection du matériel</h3>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[{ id: "articles", label: "🪑 Articles" }, { id: "kits", label: "🎁 Kits" }].map(t => (
              <button key={t.id} onClick={() => { setCatTab(t.id); setSelectedCat("Toutes"); }} style={{ padding: "7px 16px", borderRadius: 10, border: "2px solid", borderColor: catTab === t.id ? "#1a1a2e" : "#e5e7eb", background: catTab === t.id ? "#1a1a2e" : "#fff", color: catTab === t.id ? "#fff" : "#666", fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>{t.label}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["Toutes", ...allCatsForTab].map(c => (
              <button key={c} onClick={() => setSelectedCat(c)} style={{ padding: "6px 12px", borderRadius: 20, border: "1.5px solid", borderColor: selectedCat === c ? "#6366f1" : "#e5e7eb", background: selectedCat === c ? "#eef2ff" : "#fff", color: selectedCat === c ? "#6366f1" : "#666", fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>{c}</button>
            ))}
          </div>
          <Inp placeholder="🔍 Rechercher..." value={search} onChange={setSearch} />
          <div style={{ maxHeight: 230, overflowY: "auto", border: "1.5px solid #f0f0f0", borderRadius: 12 }}>
            {cats.map(cat => (
              <div key={cat}>
                <div style={{ padding: "7px 14px", background: "#f8f8f8", fontSize: 11, fontWeight: 800, color: "#999", textTransform: "uppercase" }}>{cat}</div>
                {filtered.filter(c => c.category === cat).map(p => {
                  const inCart = form.items.find(i => i.id === p.id);
                  const dispo = getDispoPourPicker(p);
                  const enManque = dispo !== null && inCart && (parseInt(inCart.qty) || 0) > dispo;
                  return (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid #f4f4f4", gap: 10 }}>
                      <span style={{ fontSize: 20 }}>{p.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                        {p.components && p.components.length > 0 && <div style={{ fontSize: 11, color: "#888" }}>{kitCompositionText(p, stock)}</div>}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 12, color: "#10b981", fontWeight: 700 }}>{p.price.toFixed(2)} € / {p.unit}</span>
                          {dispo !== null && (
                            <span style={{ fontSize: 11, fontWeight: 800, color: dispo <= 0 ? "#ef4444" : dispo <= 5 ? "#f59e0b" : "#10b981" }}>
                              {dispo <= 0 ? "⚠️ Aucun disponible" : `${dispo} disponible${dispo > 1 ? "s" : ""}`}
                            </span>
                          )}
                        </div>
                        {enManque && <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, marginTop: 2 }}>⚠️ Quantité demandée supérieure au stock disponible sur ces dates</div>}
                      </div>
                      {inCart ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <button onClick={() => updQty(p.id, String(inCart.qty - 1))} style={{ width: 28, height: 28, borderRadius: 8, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 16 }}>−</button>
                          <input type="number" min="1" value={inCart.qty} onChange={e => updQty(p.id, e.target.value)} onBlur={() => { if (!inCart.qty) set("items", form.items.filter(i => i.id !== p.id)); }} onFocus={e => e.target.select()} style={{ width: 54, height: 30, borderRadius: 8, border: enManque ? "1.5px solid #ef4444" : "1.5px solid #1a1a2e", textAlign: "center", fontWeight: 800, fontSize: 14, fontFamily: "inherit", background: enManque ? "#fef2f2" : "#f0f4ff", outline: "none" }} />
                          <button onClick={() => updQty(p.id, String((parseInt(inCart.qty)||0) + 1))} style={{ width: 28, height: 28, borderRadius: 8, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 16 }}>+</button>
                        </div>
                      ) : <Btn variant="secondary" size="sm" onClick={() => addItem(p)}><span style={{ width: 14, height: 14 }}>{I.plus}</span></Btn>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {form.items.length > 0 && (
            <div style={{ background: "#f8f9fa", borderRadius: 12, padding: 14 }}>
              <h4 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 800 }}>📋 Panier ({form.items.length})</h4>
              {form.items.map(item => {
                const lineTotal = (parseInt(item.qty) || 0) * (parseFloat(item.price) || 0) + (item.cleaningSelected ? (parseInt(item.qty) || 0) * (parseFloat(item.cleaningPrice) || 0) : 0);
                return (
                <div key={item.id} style={{ marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ flex: 1, fontSize: 13 }}>{item.icon} {item.name} × {item.qty}</span>
                    <span style={{ fontSize: 11, color: "#999" }}>PU</span>
                    <input type="number" value={item.price} step="0.01" onChange={e => updPrice(item.id, e.target.value)} style={{ width: 64, padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e5e7eb", fontSize: 12, fontFamily: "inherit", textAlign: "right" }} />
                    <span style={{ fontWeight: 700, fontSize: 13, minWidth: 60, textAlign: "right" }}>{lineTotal.toFixed(2)} €</span>
                    <button onClick={() => set("items", form.items.filter(i => i.id !== item.id))} style={{ width: 24, height: 24, borderRadius: 6, border: "none", background: "#fee2e2", color: "#dc2626", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ width: 12, height: 12 }}>{I.trash}</span></button>
                  </div>
                  {item.cleaningOption && (
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, marginLeft: 4, cursor: "pointer" }}>
                      <input type="checkbox" checked={!!item.cleaningSelected} onChange={e => set("items", form.items.map(i => i.id === item.id ? { ...i, cleaningSelected: e.target.checked } : i))} style={{ width: 15, height: 15 }} />
                      <span style={{ fontSize: 11, color: "#666" }}>🧼 Option nettoyage (+{(parseFloat(item.cleaningPrice) || 0).toFixed(2)} €/unité, soit +{((parseFloat(item.cleaningPrice) || 0) * (parseInt(item.qty) || 0)).toFixed(2)} €)</span>
                    </label>
                  )}
                </div>
              );})}
              <div style={{ borderTop: "1.5px solid #e5e7eb", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", fontWeight: 800 }}><span>Sous-total</span><span>{sub.toFixed(2)} €</span></div>
            </div>
          )}
        </div>
      )}

      {/* ÉTAPE 3 — LIVRAISON */}
      {step === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>🚚 Mode & horaires</h3>
          <div style={{ display: "flex", gap: 10 }}>
            {["retrait", "livraison"].map(mode => (
              <button key={mode} onClick={() => set("deliveryMode", mode)} style={{ flex: 1, padding: "12px", borderRadius: 10, border: "2px solid", borderColor: form.deliveryMode === mode ? "#1a1a2e" : "#e5e7eb", background: form.deliveryMode === mode ? "#1a1a2e" : "#fafafa", color: form.deliveryMode === mode ? "#fff" : "#666", fontWeight: 700, cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>{mode === "retrait" ? "🏪 Retrait entrepôt" : "🚚 Livraison"}</button>
            ))}
          </div>

          {form.deliveryMode === "livraison" && (
            <div style={{ background: "#f8f9fa", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Inp label="Distance (km)" type="number" value={form.deliveryKm} onChange={v => set("deliveryKm", v)} min="0" step="0.1" suffix="km" />
                <Inp label="Temps (min)" type="number" value={form.deliveryMin} onChange={v => set("deliveryMin", v)} min="0" suffix="min" />
              </div>
              <Btn variant="secondary" size="md" onClick={autoDistance} disabled={computingDist} style={{ width: "100%" }}>{computingDist ? "⏳ Calcul..." : "📍 Recalculer"}</Btn>
              <div style={{ fontSize: 12, color: "#666" }}>Prix calculé par trajet : <strong style={{ color: "#1a1a2e" }}>{unitTrajet.toFixed(2)} €</strong> {(parseFloat(form.deliveryKm) || 0) <= (settings.seuilKm != null ? settings.seuilKm : 5) && (parseFloat(form.deliveryMin) || 0) <= (settings.seuilMin != null ? settings.seuilMin : 0) && <span style={{ color: "#f59e0b" }}>(forfait minimum)</span>}</div>
              {settings.googleMapsKey && <div style={{ fontSize: 11, color: "#3b82f6" }}>📍 La distance se calcule automatiquement dès que l'adresse est saisie.</div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, border: "2px solid", borderColor: form.trajetAller !== false ? "#10b981" : "#e5e7eb", background: form.trajetAller !== false ? "#f0fdf4" : "#fff", cursor: "pointer" }} onClick={() => set("trajetAller", form.trajetAller === false)}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, border: "2px solid", borderColor: form.trajetAller !== false ? "#10b981" : "#d1d5db", background: form.trajetAller !== false ? "#10b981" : "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>{form.trajetAller !== false && <span style={{ width: 12, height: 12, color: "#fff" }}>{I.check}</span>}</div>
                  <div><div style={{ fontWeight: 700, fontSize: 13 }}>Livraison aller</div><div style={{ fontSize: 11, color: "#999" }}>{unitTrajet.toFixed(2)} €</div></div>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, border: "2px solid", borderColor: form.trajetRetour ? "#10b981" : "#e5e7eb", background: form.trajetRetour ? "#f0fdf4" : "#fff", cursor: "pointer" }} onClick={() => set("trajetRetour", !form.trajetRetour)}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, border: "2px solid", borderColor: form.trajetRetour ? "#10b981" : "#d1d5db", background: form.trajetRetour ? "#10b981" : "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>{form.trajetRetour && <span style={{ width: 12, height: 12, color: "#fff" }}>{I.check}</span>}</div>
                  <div><div style={{ fontWeight: 700, fontSize: 13 }}>Récupération retour</div><div style={{ fontSize: 11, color: "#999" }}>{unitTrajet.toFixed(2)} €</div></div>
                </label>
              </div>
              <div style={{ textAlign: "right", fontWeight: 800, fontSize: 15 }}>Total livraison calculé : <span style={{ color: "#10b981" }}>{(deliveryCostOf({ ...form, deliveryPriceManual: "" }, settings)).toFixed(2)} €</span></div>
              <div style={{ borderTop: "1px dashed #d1d5db", paddingTop: 12 }}>
                <Inp label="✏️ Tarif livraison personnalisé (laisser vide = calcul auto)" type="number" value={form.deliveryPriceManual ?? ""} onChange={v => set("deliveryPriceManual", v)} min="0" step="0.5" suffix="€" placeholder="Ex : 25" />
                {form.deliveryPriceManual != null && form.deliveryPriceManual !== "" && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                    <span style={{ fontSize: 12, color: "#c2410c", fontWeight: 700 }}>Tarif personnalisé appliqué : {(parseFloat(form.deliveryPriceManual) || 0).toFixed(2)} €</span>
                    <button onClick={() => set("deliveryPriceManual", "")} style={{ background: "none", border: "none", color: "#3b82f6", fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>↺ Revenir au calcul auto</button>
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right", fontWeight: 900, fontSize: 16, borderTop: "1px solid #e5e7eb", paddingTop: 10 }}>Total livraison : <span style={{ color: "#10b981" }}>{delCost.toFixed(2)} €</span></div>

              {/* Options supplémentaires : cumulables avec la livraison de base ci-dessus */}
              <div style={{ borderTop: "1.5px dashed #d1d5db", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ border: "1.5px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={!!form.etageActive} onChange={e => {
                      const checked = e.target.checked;
                      set("etageActive", checked);
                      if (checked && (form.etagePrice == null || form.etagePrice === "")) {
                        set("etagePrice", calcEtagePriceAuto(form, settings, form.etageNbEtages || 1).toFixed(2));
                        if (!form.etageNbEtages) set("etageNbEtages", 1);
                      }
                    }} style={{ width: 18, height: 18 }} />
                    <span style={{ fontWeight: 700, fontSize: 14 }}>🪜 Monter à l'étage</span>
                  </label>
                  {form.etageActive && (
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                      <Inp label="Nombre d'étages" type="number" value={form.etageNbEtages || ""} onChange={v => { set("etageNbEtages", v); set("etagePrice", calcEtagePriceAuto(form, settings, v).toFixed(2)); }} min="1" />
                      <Inp label="✏️ Tarif (€) — calculé auto, modifiable" type="number" value={form.etagePrice ?? ""} onChange={v => set("etagePrice", v)} min="0" step="0.5" />
                      <div style={{ fontSize: 11, color: "#999" }}>💡 Suggestion automatique : {calcEtagePriceAuto(form, settings, form.etageNbEtages || 0).toFixed(2)} € (selon le barème réglé pour ce matériel)</div>
                    </div>
                  )}
                </div>
                <div style={{ border: "1.5px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={!!form.miseEnPlaceActive} onChange={e => {
                      const checked = e.target.checked;
                      set("miseEnPlaceActive", checked);
                      if (checked && (form.miseEnPlacePrice == null || form.miseEnPlacePrice === "")) {
                        set("miseEnPlacePrice", calcMiseEnPlacePriceAuto(form, settings).toFixed(2));
                      }
                    }} style={{ width: 18, height: 18 }} />
                    <span style={{ fontWeight: 700, fontSize: 14 }}>🛠️ Mise en place</span>
                  </label>
                  {form.miseEnPlaceActive && (
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                      <Inp label="✏️ Tarif (€) — calculé auto, modifiable" type="number" value={form.miseEnPlacePrice ?? ""} onChange={v => set("miseEnPlacePrice", v)} min="0" step="0.5" />
                      <div style={{ fontSize: 11, color: "#999" }}>💡 Suggestion automatique : {calcMiseEnPlacePriceAuto(form, settings).toFixed(2)} € (selon le barème réglé pour ce matériel)</div>
                    </div>
                  )}
                </div>
                {(form.etageActive || form.miseEnPlaceActive) && (
                  <div style={{ textAlign: "right", fontWeight: 800, fontSize: 14, color: "#7c3aed" }}>Total options : {deliveryExtrasCost(form).toFixed(2)} €</div>
                )}
              </div>
            </div>
          )}

          <div style={{ background: "#eef2ff", borderRadius: 10, padding: 12, marginBottom: 4 }}>
            <div style={{ fontSize: 12, color: "#6366f1" }}>📅 Dates : du {fmtD(form.deliveryDate) || "—"} au {fmtD(form.returnDate) || "—"} <span style={{ color: "#999" }}>(modifiable à l'étape 2)</span></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
            <TimeInput label={form.deliveryMode === "livraison" ? "Heure livraison" : "Heure retrait"} value={form.deliveryTime} onChange={v => set("deliveryTime", v)} />
            <TimeInput label="Heure retour" value={form.returnTime} onChange={v => set("returnTime", v)} />
          </div>
          <div style={{ fontSize: 11, color: "#6366f1", marginTop: 2 }}>💡 Heure par défaut : 16h00, librement modifiable.</div>

          {/* Bloc jours supplémentaires — visible dès que livraison + retour sont renseignés */}
          {form.deliveryDate && form.returnDate && (
            <div style={{ background: extraDaysNb > 0 ? "#fff7ed" : "#f0fdf4", borderRadius: 12, padding: 14, border: `1.5px solid ${extraDaysNb > 0 ? "#fed7aa" : "#bbf7d0"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: extraDaysNb > 0 ? "#c2410c" : "#15803d" }}>
                  📅 Durée de location
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#666" }}>
                  Standard : {(settings && settings.standardDays) || 2} jours / période
                </span>
              </div>
              {(() => {
                const std = (settings && settings.standardDays) || 2;
                const d1 = new Date(form.deliveryDate + "T12:00:00");
                const d2 = new Date(form.returnDate + "T12:00:00");
                const totalDays = Math.max(1, Math.round((d2 - d1) / 86400000)); // sans +1
                const periodes = Math.ceil(totalDays / std);
                return (
                  <div style={{ display: "flex", gap: 16, fontSize: 13, marginBottom: 10, flexWrap: "wrap" }}>
                    <span>Durée totale : <strong>{totalDays} jour(s)</strong></span>
                    <span style={{ fontWeight: 700, color: "#666" }}>{periodes} période(s) de {std}j</span>
                    <span style={{ color: extraDaysNb > 0 ? "#c2410c" : "#15803d", fontWeight: 700 }}>
                      {extraDaysNb > 0 ? `+${extraDaysNb} période(s) suppl.` : "✓ 1 seule période"}
                    </span>
                  </div>
                );
              })()}
              {extraDaysNb > 0 && (
                <>
                  <div style={{ fontSize: 12, color: "#92400e", marginBottom: 10 }}>
                    Calcul auto : {extraDaysNb} période(s) × {sub.toFixed(2)} € (sous-total articles) = <strong>{extraDaysCostAuto.toFixed(2)} €</strong>
                  </div>
                  <Inp label="✏️ Supplément personnalisé (laisser vide = calcul auto)" type="number" value={form.extraDaysPriceManual ?? ""} onChange={v => set("extraDaysPriceManual", v)} min="0" step="1" suffix="€" placeholder={`Ex : ${extraDaysCostAuto.toFixed(0)}`} />
                  {form.extraDaysPriceManual != null && form.extraDaysPriceManual !== "" && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                      <span style={{ fontSize: 12, color: "#c2410c", fontWeight: 700 }}>Montant personnalisé : {(parseFloat(form.extraDaysPriceManual) || 0).toFixed(2)} €</span>
                      <button onClick={() => set("extraDaysPriceManual", "")} style={{ background: "none", border: "none", color: "#3b82f6", fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>↺ Revenir au calcul auto</button>
                    </div>
                  )}
                  <div style={{ textAlign: "right", fontWeight: 900, fontSize: 15, borderTop: "1px solid #fed7aa", paddingTop: 8, marginTop: 8, color: "#c2410c" }}>
                    Supplément périodes : {extraDaysCostFinal.toFixed(2)} €
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ÉTAPE 4 — PAIEMENT */}
      {step === 4 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>💶 Remise, acompte & paiement</h3>
          {/* Remise */}
          <div style={{ background: "#f8f9fa", borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>🎁 Remise client</div>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {[{ v: "fixed", l: "€" }, { v: "percent", l: "%" }].map(t => (
                  <button key={t.v} onClick={() => set("discountType", t.v)} style={{ width: 44, height: 40, borderRadius: 10, border: "2px solid", borderColor: form.discountType === t.v ? "#1a1a2e" : "#e5e7eb", background: form.discountType === t.v ? "#1a1a2e" : "#fff", color: form.discountType === t.v ? "#fff" : "#666", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: 15 }}>{t.l}</button>
                ))}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}><Inp label="Montant remise" type="number" value={form.discountValue} onChange={v => set("discountValue", v)} min="0" suffix={form.discountType === "percent" ? "%" : "€"} /></div>
            </div>
            {disc > 0 && <div style={{ marginTop: 10, padding: "8px 14px", background: "#f0fdf4", borderRadius: 10, color: "#065f46", fontWeight: 800, textAlign: "right" }}>Remise appliquée : - {disc.toFixed(2)} €</div>}
          </div>
          {/* Acompte */}
          <div style={{ background: "#f8f9fa", borderRadius: 12, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 800 }}>💰 Acompte</div>
              <button onClick={() => set("acompte", (total * settings.defaultAcomptePercent / 100).toFixed(2))} style={{ background: "#f59e0b", color: "#fff", border: "none", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Appliquer {settings.defaultAcomptePercent}% ({(total * settings.defaultAcomptePercent / 100).toFixed(2)} €)</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Inp label="Acompte versé (€)" type="number" value={form.acompte} onChange={v => { set("acompte", v); setSaveError(null); }} min="0" step="0.01" />
              <div>
                <Sel label="Moyen de paiement" value={form.acompteMoyen} onChange={v => { set("acompteMoyen", v); setSaveError(null); }} options={MOYEN_OPTS} />
                {acompteMoyenManquant() && saveError && <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, marginTop: 4 }}>⚠️ Requis si un acompte est versé</div>}
              </div>
            </div>
          </div>
          {/* Caution */}
          {(cautionAmount > 0 || form.cautionMoyen || cautionForced) ? (
            <div style={{ background: "#f5f3ff", borderRadius: 12, padding: 14, border: "1.5px solid #ddd6fe" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#6d28d9" }}>🔒 Caution</div>
                <span style={{ fontSize: 12, color: "#7c3aed", fontWeight: 700 }}>Calculée auto : {(() => { const auto = cautionCost({ ...form, cautionManual: "" }, stock); return auto.toFixed(2); })()} €</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <Inp label="Montant caution (€)" type="number" value={form.cautionManual != null && form.cautionManual !== "" ? form.cautionManual : cautionAmount} onChange={v => set("cautionManual", v)} min="0" step="0.01" />
                <Sel label="Moyen prévu" value={form.cautionMoyen || ""} onChange={v => set("cautionMoyen", v)} options={MOYEN_OPTS} />
              </div>
              {["cheque", "especes"].includes(form.cautionMoyen) && (
                <div style={{ fontSize: 12, color: "#7c3aed", background: "#ede9fe", borderRadius: 8, padding: "8px 12px" }}>
                  💡 Caution {form.cautionMoyen === "cheque" ? "par chèque" : "en espèces"} : à conserver physiquement, à rendre au client lors de la restitution du matériel (hors casse). Cette caution n'entre pas dans le total à payer.
                </div>
              )}
              {["virement", "paypal"].includes(form.cautionMoyen) && (
                <div style={{ fontSize: 12, color: "#7c3aed", background: "#ede9fe", borderRadius: 8, padding: "8px 12px" }}>
                  💡 Caution {form.cautionMoyen === "virement" ? "par virement" : "PayPal"} : réellement encaissée. Au retour, l'app calculera le montant net à rembourser (caution − casse éventuelle). Cette caution n'entre pas dans le total à payer.
                </div>
              )}
              {!form.cautionMoyen && (
                <div style={{ fontSize: 12, color: "#999" }}>Choisissez le moyen prévu pour la caution ci-dessus.</div>
              )}
            </div>
          ) : (
            <button onClick={() => setCautionForced(true)} style={{ alignSelf: "flex-start", background: "none", border: "1.5px dashed #7c3aed", color: "#7c3aed", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
              + Ajouter une caution
            </button>
          )}
          {/* Récap final */}
          <div style={{ background: "linear-gradient(135deg, #1a1a2e, #16213e)", color: "#fff", borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6, opacity: 0.8 }}><span>Sous-total</span><span>{sub.toFixed(2)} €</span></div>
            {disc > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6, color: "#86efac" }}><span>Remise</span><span>- {disc.toFixed(2)} €</span></div>}
            {delCost > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6, opacity: 0.8 }}><span>Livraison</span><span>{delCost.toFixed(2)} €</span></div>}
            {form.etageActive && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6, opacity: 0.8 }}><span>🪜 Monter à l'étage</span><span>{(parseFloat(form.etagePrice) || 0).toFixed(2)} €</span></div>}
            {form.miseEnPlaceActive && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6, opacity: 0.8 }}><span>🛠️ Mise en place</span><span>{(parseFloat(form.miseEnPlacePrice) || 0).toFixed(2)} €</span></div>}
            {extraDaysCostFinal > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6, color: "#fbbf24" }}><span>Suppl. périodes (+{extraDaysNb}×)</span><span>{extraDaysCostFinal.toFixed(2)} €</span></div>}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: 18, borderTop: "1px solid rgba(255,255,255,0.2)", paddingTop: 8, marginTop: 4 }}><span>TOTAL</span><span>{total.toFixed(2)} €</span></div>
            {parseFloat(form.acompte) > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 6, color: "#86efac" }}><span>Acompte versé</span><span>- {parseFloat(form.acompte).toFixed(2)} €</span></div>}
            {parseFloat(form.acompte) > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 6, color: "#fbbf24" }}><span>Reste à payer</span><span>{reste.toFixed(2)} €</span></div>}
          </div>
        </div>
      )}

      {/* Notes internes : visibles et modifiables à toutes les étapes du devis, pas seulement au paiement */}
      <Inp label="📝 Notes internes (visibles à toutes les étapes)" value={form.notes} onChange={v => set("notes", v)} placeholder="Informations complémentaires..." />

      {saveError && <div style={{ background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 10, padding: "10px 14px", color: "#b91c1c", fontWeight: 700, fontSize: 13 }}>{saveError}</div>}

      {/* Navigation par étapes */}
      <div style={{ display: "flex", gap: 12, justifyContent: "space-between", borderTop: "1px solid #f0f0f0", paddingTop: 16, flexWrap: "wrap" }}>
        <Btn variant="secondary" onClick={step === 1 ? onClose : () => setStep(step - 1)}>
          {step === 1 ? "Annuler" : <><span style={{ width: 16, height: 16 }}>{I.back}</span> Précédent</>}
        </Btn>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {form.clientName.trim() && (!initial || initial.status === "Brouillon" || initial.status === "Devis") && (
            <Btn variant="ghost" onClick={saveDraft}>💾 Brouillon</Btn>
          )}
          {step < 4 ? (
            <Btn variant="primary" disabled={!canNext()} onClick={() => setStep(step + 1)}>Suivant <span style={{ width: 16, height: 16 }}>{I.next}</span></Btn>
          ) : (
            <Btn variant="primary" onClick={handleSave}><span style={{ width: 16, height: 16 }}>{I.check}</span> Enregistrer le devis</Btn>
          )}
        </div>
      </div>

      <Modal open={showClientLib} onClose={() => setShowClientLib(false)} title="📋 Bibliothèque clients" wide>
        <ClientLibrary clients={clients || []} setClients={() => {}} onSelect={applyClient} onClose={() => setShowClientLib(false)} />
      </Modal>

      <Modal open={!!stockAlert} onClose={() => setStockAlert(null)} title="⚠️ Stock insuffisant">
        {stockAlert && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: "#dc2626", color: "#fff", borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 28 }}>⚠️</span>
              <div>
                <div style={{ fontWeight: 900, fontSize: 17, lineHeight: 1.2 }}>ATTENTION — ARTICLES MANQUANTS</div>
                <div style={{ fontSize: 13, opacity: 0.9 }}>Le stock ne couvre pas cette commande sur la période choisie.</div>
              </div>
            </div>
            <div style={{ fontSize: 14, color: "#666" }}>
              Période du <strong>{fmtD(orderPeriod(form)?.start)}</strong> au <strong>{fmtD(orderPeriod(form)?.end)}</strong> :
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {stockAlert.map(s => (
                <div key={s.id} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ fontWeight: 800, marginBottom: 2 }}>{s.icon} {s.name}</div>
                  <div style={{ fontSize: 13, color: "#b91c1c" }}>
                    Demandé : {s.besoin} · Disponible : {s.dispo} · <strong>Il manque {s.manque}</strong>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
              <Btn variant="primary" onClick={saveAnyway}>✅ Confirmer quand même</Btn>
              <Btn variant="secondary" onClick={saveReduced}>✂️ Réduire au stock disponible</Btn>
              <Btn variant="secondary" onClick={() => setStockAlert(null)}>↩️ Modifier la commande</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ─── FICHE LIVRAISON + PARTAGE + SIGNATURE ───────────────────────────────────
// Petit panneau repliable montrant les AUTRES commandes du même client (hors celle en cours),
// utilisé dans la fiche commande pour avoir un historique sans changer d'écran.
function ClientHistoryPanel({ orders, settings }) {
  const [open, setOpen] = useState(false);
  const sorted = [...orders].sort((a, b) => (b.closedAt || b.returnDate || b.deliveryDate || "").localeCompare(a.closedAt || a.returnDate || a.deliveryDate || ""));
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, marginBottom: 14, overflow: "hidden" }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#f8f9fa", cursor: "pointer" }}>
        <span style={{ fontSize: 16 }}>📋</span>
        <span style={{ flex: 1, fontWeight: 800, fontSize: 13 }}>Historique du client ({sorted.length} autre{sorted.length > 1 ? "s" : ""} commande{sorted.length > 1 ? "s" : ""})</span>
        <span style={{ fontSize: 12, color: "#999", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▼</span>
      </div>
      {open && (
        <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
          {sorted.map(o => (
            <div key={o.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", background: "#f8f9fa", borderRadius: 8, fontSize: 13 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{o.id}</div>
                <div style={{ color: "#999", fontSize: 11 }}>{fmtD(o.deliveryDate)} · {o.status}</div>
              </div>
              <div style={{ fontWeight: 800, color: "#10b981", flexShrink: 0 }}>{orderTotal(o, settings).toFixed(2)} €</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function DeliverySheet({ order, settings, onShare, stock, onEncaisser, onDeletePhoto, allOrders }) {
  const [phoneModal, setPhoneModal] = useState(false);
  const [addressModal, setAddressModal] = useState(false);
  const [tab, setTab] = useState("fiche");
  const [matChecks, setMatChecks] = useState(() => Object.fromEntries((order.items || []).map(i => [i.id, false])));
  const CAUTION_MOYEN_LABELS_LONG = { cheque: "Par chèque", especes: "En espèces", virement: "Par virement", paypal: "Par PayPal", cb: "Par CB" };

  const del = deliveryCostOf(order, settings);
  const total = orderTotal(order, settings);
  const reste = total - (parseFloat(order.acompte) || 0);
  const caution = cautionCost(order, stock || []);
  const phone = (order.clientPhone || "").replace(/\s/g, "");
  const addr = encodeURIComponent(order.address || "");
  const checked = Object.values(matChecks).filter(Boolean).length;
  const matDone = (order.items || []).length > 0 && checked === (order.items || []).length;

  const tabs = [{ id: "fiche", label: "📋 Fiche" }, { id: "checklist", label: `✅ Matériel (${checked}/${(order.items||[]).length})` }, { id: "bon", label: "📦 Bon de livraison" }];

  return (
    <div>
      <div style={{ background: "linear-gradient(135deg, #1a1a2e, #16213e)", color: "#fff", borderRadius: 16, padding: 20, marginBottom: 14 }}>
        <div style={{ fontSize: 11, opacity: 0.6 }}>FICHE {order.deliveryMode === "livraison" ? "LIVRAISON" : "RETRAIT"}</div>
        <div style={{ fontSize: 19, fontWeight: 900 }}>{order.id} — {order.clientName}</div>
        <div style={{ opacity: 0.75, marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
          {order.deliveryDate && <span>📅 {fmtD(order.deliveryDate)}{order.deliveryTime ? ` à ${order.deliveryTime}` : ""}</span>}
          {order.returnDate && <span>↩️ {fmtD(order.returnDate)}{order.returnTime ? ` à ${order.returnTime}` : ""}</span>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, background: "#f0f0f0", borderRadius: 12, padding: 4, marginBottom: 16, overflowX: "auto" }}>
        {tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "7px 14px", borderRadius: 10, border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12, background: tab === t.id ? "#fff" : "transparent", color: tab === t.id ? "#1a1a2e" : "#999", whiteSpace: "nowrap" }}>{t.label}</button>)}
      </div>

      {tab === "fiche" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div style={{ background: "#f8f9fa", borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 11, color: "#999", fontWeight: 700, marginBottom: 6 }}>👤 CLIENT</div>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8 }}>{order.clientName}</div>
              {phone && <button onClick={() => setPhoneModal(true)} style={{ display: "flex", alignItems: "center", gap: 6, background: "#dbeafe", color: "#1e40af", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontWeight: 700, fontSize: 13, fontFamily: "inherit", width: "100%" }}><span style={{ width: 15, height: 15 }}>{I.phone}</span> {order.clientPhone}</button>}
            </div>
            <div style={{ background: "#f8f9fa", borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 11, color: "#999", fontWeight: 700, marginBottom: 6 }}>📍 ADRESSE</div>
              {order.address ? <button onClick={() => setAddressModal(true)} style={{ display: "flex", alignItems: "flex-start", gap: 6, background: "#d1fae5", color: "#065f46", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontWeight: 600, fontSize: 12, fontFamily: "inherit", width: "100%", textAlign: "left" }}><span style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2 }}>{I.location}</span> {order.address}</button> : <div style={{ fontSize: 13, color: "#666" }}>Retrait entrepôt</div>}
            </div>
          </div>
          {allOrders && allOrders.filter(o => o.clientName === order.clientName && o.id !== order.id).length > 0 && (
            <ClientHistoryPanel orders={allOrders.filter(o => o.clientName === order.clientName && o.id !== order.id)} settings={settings} />
          )}
          <div style={{ background: "#f8f9fa", borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "#999", fontWeight: 700, marginBottom: 10 }}>📦 MATÉRIEL</div>
            {(order.items||[]).map(item => (
              <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #eee" }}>
                <div><span style={{ fontSize: 14 }}>{item.icon} {item.name}</span>{item.components && item.components.length > 0 && <div style={{ fontSize: 11, color: "#888" }}>↳ {kitCompositionText(item, stock)}</div>}</div>
                <span style={{ background: "#1a1a2e", color: "#fff", borderRadius: 8, padding: "2px 10px", fontWeight: 800, fontSize: 14 }}>× {item.qty}</span>
              </div>
            ))}
          </div>
          {(deliveryCostOf(order, settings) > 0 || order.etageActive || order.miseEnPlaceActive) && (
            <div style={{ background: "#eff6ff", borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#1e40af" }}>🚚 Frais de livraison</div>
              {deliveryCostOf(order, settings) > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#1e40af" }}><span>Livraison (pied du camion)</span><span style={{ fontWeight: 700 }}>{deliveryCostOf(order, settings).toFixed(2)} €</span></div>}
              {order.etageActive && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#1e40af" }}><span>🪜 Monter à l'étage ({order.etageNbEtages || 1} étage{(order.etageNbEtages || 1) > 1 ? "s" : ""})</span><span style={{ fontWeight: 700 }}>{(parseFloat(order.etagePrice) || 0).toFixed(2)} €</span></div>}
              {order.miseEnPlaceActive && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#1e40af" }}><span>🛠️ Mise en place</span><span style={{ fontWeight: 700 }}>{(parseFloat(order.miseEnPlacePrice) || 0).toFixed(2)} €</span></div>}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 900, color: "#1e40af", borderTop: "1px solid #bfdbfe", paddingTop: 6 }}><span>Total</span><span>{(deliveryCostOf(order, settings) + deliveryExtrasCost(order)).toFixed(2)} €</span></div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div style={{ background: "#fffbeb", borderRadius: 12, padding: 14, textAlign: "center" }}><div style={{ fontSize: 11, color: "#92400e", fontWeight: 700 }}>TOTAL</div><div style={{ fontSize: 18, fontWeight: 900, color: "#92400e" }}>{total.toFixed(2)} €</div></div>
            <div style={{ background: "#f0fdf4", borderRadius: 12, padding: 14, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#065f46", fontWeight: 700 }}>ACOMPTE</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: "#065f46" }}>{parseFloat(order.acompte||0).toFixed(2)} €</div>
              {order.acompteMoyen && <div style={{ fontSize: 10, color: "#065f46", marginTop: 2, opacity: 0.8 }}>{{ paypal: "💙 PayPal", virement: "🏦 Virement", especes: "💵 Espèces", cheque: "📄 Chèque", cb: "💳 CB" }[order.acompteMoyen]}</div>}
            </div>
            <div style={{ background: reste > 0 ? "#fff7ed" : "#f0fdf4", borderRadius: 12, padding: 14, textAlign: "center" }}><div style={{ fontSize: 11, color: reste > 0 ? "#c2410c" : "#065f46", fontWeight: 700 }}>À ENCAISSER</div><div style={{ fontSize: 18, fontWeight: 900, color: reste > 0 ? "#c2410c" : "#065f46" }}>{reste.toFixed(2)} €</div></div>
          </div>
          {caution > 0 && (
            <div style={{ background: "#f5f3ff", border: "1.5px solid #ddd6fe", borderRadius: 12, padding: 14, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 11, color: "#6d28d9", fontWeight: 700 }}>🔒 CAUTION À PRÉVOIR</div>
                <div style={{ fontSize: 12, color: "#7c3aed", marginTop: 2 }}>{order.cautionMoyen ? (CAUTION_MOYEN_LABELS_LONG[order.cautionMoyen] || "") : "Moyen non précisé"} — restituée à la fin de la location</div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#6d28d9" }}>{caution.toFixed(2)} €</div>
            </div>
          )}
          {onEncaisser && reste > 0 && order.status !== "Devis" && (
            <Btn variant="success" onClick={() => onEncaisser(order)} style={{ width: "100%", marginBottom: 14 }}>💰 Encaisser le solde ({reste.toFixed(2)} €)</Btn>
          )}
          {onShare && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn variant="primary" onClick={() => onShare(order)} style={{ flex: 1, minWidth: 180 }}><span style={{ width: 16, height: 16 }}>{I.share}</span> Partager le devis PDF</Btn>
            <Btn variant="secondary" onClick={() => onShare(order, "facture")} style={{ flex: 1, minWidth: 140 }}>🧾 Générer la facture</Btn>
          </div>}
        </div>
      )}

      {tab === "checklist" && (
        <div>
          <div style={{ height: 8, background: "#f0f0f0", borderRadius: 8, marginBottom: 16, overflow: "hidden" }}><div style={{ height: "100%", background: matDone ? "#10b981" : "#f59e0b", width: `${(order.items||[]).length ? checked/(order.items||[]).length*100 : 0}%` }} /></div>
          {(() => {
            const plan = prelevementPlan(order, stock || []);
            const prioCamion = order.deliveryMode === "livraison";
            const hasManque = plan.some(p => p.manque > 0);
            return (
              <div style={{ background: "#f8f9ff", border: "1px solid #e0e4ff", borderRadius: 12, padding: 14, marginBottom: 16 }}>
                <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>📍 Où prendre le matériel</div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>{prioCamion ? "🚚 Livraison → on prend d'abord dans le camion" : "🏠 Retrait → on prend d'abord dans le local"}</div>
                {plan.map(p => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "6px 0", borderTop: "1px solid #eef" }}>
                    <span>{p.icon}</span>
                    <span style={{ flex: 1, fontWeight: 600 }}>{p.name}</span>
                    {p.fromCamion > 0 && <span style={{ background: "#fff7ed", color: "#c2410c", borderRadius: 6, padding: "2px 8px", fontWeight: 700 }}>🚚 {p.fromCamion}</span>}
                    {p.fromLocal > 0 && <span style={{ background: "#eff6ff", color: "#1d4ed8", borderRadius: 6, padding: "2px 8px", fontWeight: 700 }}>🏠 {p.fromLocal}</span>}
                    {p.manque > 0 && <span style={{ background: "#fee2e2", color: "#b91c1c", borderRadius: 6, padding: "2px 8px", fontWeight: 800 }}>⚠️ manque {p.manque}</span>}
                  </div>
                ))}
                {hasManque && <div style={{ marginTop: 10, background: "#fee2e2", color: "#b91c1c", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 700 }}>⚠️ Le stock total (camion + local) ne suffit pas pour certains articles.</div>}
              </div>
            );
          })()}
          {(order.items||[]).map(item => (
            <div key={item.id} onClick={() => setMatChecks(c => ({ ...c, [item.id]: !c[item.id] }))} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", borderRadius: 12, border: "2px solid", borderColor: matChecks[item.id] ? "#10b981" : "#e5e7eb", background: matChecks[item.id] ? "#f0fdf4" : "#fff", cursor: "pointer", marginBottom: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: 7, border: "2px solid", borderColor: matChecks[item.id] ? "#10b981" : "#d1d5db", background: matChecks[item.id] ? "#10b981" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{matChecks[item.id] && <span style={{ width: 13, height: 13, color: "#fff" }}>{I.check}</span>}</div>
              <span style={{ fontSize: 20 }}>{item.icon}</span>
              <div style={{ flex: 1, fontWeight: 700, fontSize: 14, textDecoration: matChecks[item.id] ? "line-through" : "none", color: matChecks[item.id] ? "#6b7280" : "#111" }}>{item.name}</div>
              <span style={{ background: "#1a1a2e", color: "#fff", borderRadius: 8, padding: "2px 10px", fontWeight: 800, fontSize: 14 }}>× {item.qty}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "bon" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 13, color: "#666" }}>Bon de livraison — {settings.companyName}. La signature se fait au moment de marquer la commande "livrée"/"retirée" (menu Livreur) et au moment du retour (menu Retours) — récapitulatif ci-dessous.</div>

          {/* Récap LIVRAISON/RETRAIT */}
          <div style={{ background: order.deliverySignature ? "#f0fdf4" : "#f8f9fa", border: order.deliverySignature ? "1.5px solid #bbf7d0" : "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10 }}>{order.deliveryMode === "livraison" ? "🚚 Livraison" : "🏠 Retrait"}</div>
            {order.deliverySignature ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 13, color: "#065f46", fontWeight: 700 }}>✅ Signé par {order.deliverySignedBy} {order.deliverySignedAt && `· ${new Date(order.deliverySignedAt).toLocaleString("fr-FR")}`}</div>
                {order.deliveryComment && <div style={{ fontSize: 13, color: "#444", background: "#fff", borderRadius: 8, padding: "8px 12px" }}>💬 {order.deliveryComment}</div>}
                {order.deliveryPhotos && order.deliveryPhotos.length > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {order.deliveryPhotos.map((url, i) => (
                      <div key={i} style={{ position: "relative", width: 64, height: 64 }}>
                        <a href={url} target="_blank" rel="noreferrer"><img src={url} style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover", display: "block" }} /></a>
                        {onDeletePhoto && <button onClick={() => onDeletePhoto(order.id, "delivery", i, url)} style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: "50%", background: "#ef4444", color: "#fff", border: "2px solid #fff", fontWeight: 900, fontSize: 12, cursor: "pointer", lineHeight: 1 }}>✕</button>}
                      </div>
                    ))}
                  </div>
                )}
                <img src={order.deliverySignature} style={{ maxHeight: 70, maxWidth: 200, background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb" }} />
              </div>
            ) : <div style={{ fontSize: 13, color: "#999" }}>⏳ Pas encore signé.</div>}
          </div>

          {/* Récap RETOUR */}
          <div style={{ background: order.returnSignature ? "#f0fdf4" : "#f8f9fa", border: order.returnSignature ? "1.5px solid #bbf7d0" : "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10 }}>↩️ Retour</div>
            {order.returnSignature ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 13, color: "#065f46", fontWeight: 700 }}>✅ Signé par {order.returnSignedBy} {order.returnSignedAt && `· ${new Date(order.returnSignedAt).toLocaleString("fr-FR")}`}</div>
                {order.returnComment && <div style={{ fontSize: 13, color: "#444", background: "#fff", borderRadius: 8, padding: "8px 12px" }}>💬 {order.returnComment}</div>}
                {order.returnPhotos && order.returnPhotos.length > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {order.returnPhotos.map((url, i) => (
                      <div key={i} style={{ position: "relative", width: 64, height: 64 }}>
                        <a href={url} target="_blank" rel="noreferrer"><img src={url} style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover", display: "block" }} /></a>
                        {onDeletePhoto && <button onClick={() => onDeletePhoto(order.id, "return", i, url)} style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: "50%", background: "#ef4444", color: "#fff", border: "2px solid #fff", fontWeight: 900, fontSize: 12, cursor: "pointer", lineHeight: 1 }}>✕</button>}
                      </div>
                    ))}
                  </div>
                )}
                <img src={order.returnSignature} style={{ maxHeight: 70, maxWidth: 200, background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb" }} />
              </div>
            ) : <div style={{ fontSize: 13, color: "#999" }}>⏳ Pas encore signé.</div>}
          </div>
          <div style={{ fontSize: 10, color: "#999", lineHeight: 1.5 }}>{settings.conditions}</div>
        </div>
      )}

      <PhoneChoiceModal open={phoneModal} phones={order.clientPhones} phone={order.clientPhone} onClose={() => setPhoneModal(false)} />
      <Modal open={addressModal} onClose={() => setAddressModal(false)} title="Ouvrir dans…">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <a href={`waze://?q=${addr}&navigate=yes`} style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "#eff6ff", borderRadius: 12, textDecoration: "none", color: "#1e40af", fontWeight: 700 }}><span style={{ fontSize: 24 }}>🔵</span> Waze</a>
          <a href={`https://www.google.com/maps/dir/?api=1&destination=${addr}`} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "#fff7ed", borderRadius: 12, textDecoration: "none", color: "#c2410c", fontWeight: 700 }}><span style={{ fontSize: 24 }}>🗺️</span> Google Maps</a>
          <a href={`maps://maps.apple.com/?daddr=${addr}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "#f0fdf4", borderRadius: 12, textDecoration: "none", color: "#065f46", fontWeight: 700 }}><span style={{ fontSize: 24 }}>🍎</span> Plans Apple</a>
        </div>
      </Modal>
    </div>
  );
}
function CalendarView({ orders, onOpenOrder, settings }) {
  const [month, setMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(null);
  const year = month.getFullYear();
  const mon = month.getMonth();
  const firstDay = new Date(year, mon, 1).getDay();
  const daysInMonth = new Date(year, mon + 1, 0).getDate();
  const todayDate = new Date();

  const events = {};
  orders.forEach(o => {
    [{ d: o.deliveryDate, type: "delivery" }, { d: o.returnDate, type: "return" }].forEach(({ d, type }) => {
      if (d) { if (!events[d]) events[d] = []; events[d].push({ ...o, type }); }
    });
  });

  const cells = [];
  const startPad = firstDay === 0 ? 6 : firstDay - 1;
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const selectedDateStr = selectedDay ? `${year}-${String(mon + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}` : null;
  const selectedEvents = selectedDateStr ? (events[selectedDateStr] || []) : [];

  return (
    <div>
      {/* Navigation */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <Btn variant="secondary" size="sm" onClick={() => { setMonth(new Date(year, mon - 1, 1)); setSelectedDay(null); }}>←</Btn>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, textTransform: "capitalize" }}>
          {month.toLocaleString("fr-FR", { month: "long", year: "numeric" })}
        </h2>
        <Btn variant="secondary" size="sm" onClick={() => { setMonth(new Date(year, mon + 1, 1)); setSelectedDay(null); }}>→</Btn>
      </div>

      {/* Jours */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, marginBottom: 6 }}>
        {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 11, fontWeight: 800, color: "#999", padding: "6px 0" }}>{d}</div>
        ))}
      </div>

      {/* Grille */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const dateStr = `${year}-${String(mon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayEvs = events[dateStr] || [];
          const isToday = todayDate.getFullYear() === year && todayDate.getMonth() === mon && todayDate.getDate() === day;
          const isSelected = selectedDay === day;
          const hasDelivery = dayEvs.some(e => e.type === "delivery");
          const hasReturn = dayEvs.some(e => e.type === "return");

          return (
            <div key={i} onClick={() => setSelectedDay(selectedDay === day ? null : day)} style={{
              minHeight: 52, padding: "6px 4px", borderRadius: 10, border: "2px solid",
              borderColor: isSelected ? "#1a1a2e" : isToday ? "#3b82f6" : "#f0f0f0",
              background: isSelected ? "#1a1a2e" : isToday ? "#eff6ff" : "#fff",
              cursor: dayEvs.length > 0 ? "pointer" : "default",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            }}>
              <div style={{ fontSize: 13, fontWeight: isToday || isSelected ? 900 : 500, color: isSelected ? "#fff" : isToday ? "#1d4ed8" : "#333" }}>{day}</div>
              <div style={{ display: "flex", gap: 2, justifyContent: "center", flexWrap: "wrap" }}>
                {hasDelivery && <div style={{ width: 7, height: 7, borderRadius: "50%", background: isSelected ? "#93c5fd" : "#3b82f6" }} />}
                {hasReturn && <div style={{ width: 7, height: 7, borderRadius: "50%", background: isSelected ? "#fda4af" : "#f43f5e" }} />}
              </div>
              {dayEvs.length > 1 && <div style={{ fontSize: 9, fontWeight: 800, color: isSelected ? "#e0e7ff" : "#999" }}>{dayEvs.length}</div>}
            </div>
          );
        })}
      </div>

      {/* Légende */}
      <div style={{ display: "flex", gap: 16, marginTop: 16, justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}><div style={{ width: 10, height: 10, borderRadius: "50%", background: "#3b82f6" }} />Livraison / Retrait</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}><div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f43f5e" }} />Retour</div>
      </div>

      {/* Détail du jour sélectionné */}
      {selectedDay && (
        <div style={{ marginTop: 20, background: "#f8f9fa", borderRadius: 14, padding: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 12, color: "#1a1a2e" }}>
            📅 {new Date(year, mon, selectedDay).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
          </div>
          {selectedEvents.length === 0 ? (
            <div style={{ color: "#999", fontSize: 13 }}>Aucun événement ce jour.</div>
          ) : selectedEvents.map((ev, ei) => {
            const t = orderTotal(ev, settings);
            return (
              <div key={ei} onClick={() => onOpenOrder && onOpenOrder(ev)} style={{ background: "#fff", borderRadius: 10, padding: 12, marginBottom: 8, border: `2px solid ${ev.type === "delivery" ? "#dbeafe" : "#fce7f3"}`, cursor: onOpenOrder ? "pointer" : "default", transition: "box-shadow 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.1)"}
                onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>{ev.clientName}</div>
                    <div style={{ fontSize: 12, color: "#666" }}>{ev.type === "delivery" ? (ev.deliveryMode === "livraison" ? `🚚 Livraison${ev.deliveryTime ? " à " + ev.deliveryTime : ""}` : `🏪 Retrait${ev.deliveryTime ? " à " + ev.deliveryTime : ""}`) : `↩️ Retour${ev.returnTime ? " à " + ev.returnTime : ""}`}</div>
                    {ev.address && ev.deliveryMode === "livraison" && <div style={{ fontSize: 11, color: "#999" }}>📍 {ev.address}</div>}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <Badge status={ev.status} />
                    <div style={{ fontSize: 13, fontWeight: 800, marginTop: 4 }}>{t.toFixed(2)} €</div>
                    {onOpenOrder && <div style={{ fontSize: 11, color: "#3b82f6", marginTop: 4 }}>Voir le devis →</div>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── TABLEAU DE BORD ──────────────────────────────────────────────────────────
function Dashboard({ orders, expenses, settings, setView, setQuickFilter }) {
  // Les brouillons ne comptent pas dans les statistiques.
  const realOrders = orders.filter(o => o.status !== "Brouillon");
  const ca = useMemo(() => realOrders.reduce((s, o) => s + orderTotal(o, settings), 0), [orders]);
  const dep = useMemo(() => expenses.reduce((s, e) => s + parseFloat(e.amount || 0), 0), [expenses]);
  const acomptes = useMemo(() => realOrders.reduce((s, o) => s + parseFloat(o.acompte || 0), 0), [orders]);
  // "À préparer" : commandes dont la LIVRAISON/le départ approche (≤ 4 jours)
  // et qui ne sont pas encore traitées (ni livrées, ni en cours, ni retour, ni clôturées).
  const prepLimit = (() => { const d = new Date(); d.setDate(d.getDate() + 4); return d.toISOString().split("T")[0]; })();
  const inPrepWindow = (date) => date && date >= TODAY && date <= prepLimit;
  const actives = orders.filter(o =>
    !["Brouillon", "Devis", "Chez le client", "Clôturée"].includes(o.status) &&
    inPrepWindow(o.deliveryDate)
  ).length;
  // Liste combinée des prochains événements : livraisons ET retours à venir.
  const upcoming = useMemo(() => {
    const events = [];
    orders.forEach(o => {
      if (["Brouillon", "Devis", "Clôturée"].includes(o.status)) return;
      // Une fois la livraison/retrait effectué (phase passée en "retour"), on n'affiche plus
      // que l'étape retour. Avant ça, on n'affiche que l'étape départ — jamais les deux ensemble.
      const dejaLivre = o.phase === "retour" || o.status === "Chez le client";
      if (!dejaLivre && o.deliveryDate && o.deliveryDate >= TODAY) {
        events.push({
          order: o, type: "depart", date: o.deliveryDate, time: o.deliveryTime,
          label: o.deliveryMode === "livraison" ? "Livraison" : "Retrait (client vient)",
          icon: o.deliveryMode === "livraison" ? "🚚" : "🏪",
          lieu: o.deliveryMode === "livraison" ? o.address : "Au pied du camion",
        });
      }
      if (dejaLivre && o.returnDate && o.returnDate >= TODAY) {
        events.push({
          order: o, type: "retour", date: o.returnDate, time: o.returnTime,
          label: o.deliveryMode === "livraison" ? "Récupération" : "Restitution (client rapporte)",
          icon: "🔙",
          lieu: o.deliveryMode === "livraison" ? o.address : "Au pied du camion",
        });
      }
    });
    return events.sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || ""))).slice(0, 8);
  }, [orders]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
        {[
          { label: "Commandes", value: realOrders.length, icon: "📋", color: "#3b82f6" },
          { label: "CA Total", value: ca.toFixed(0) + " €", icon: "💶", color: "#10b981" },
          { label: "Bénéfice net", value: (ca - dep).toFixed(0) + " €", icon: (ca - dep) >= 0 ? "📈" : "📉", color: (ca - dep) >= 0 ? "#10b981" : "#ef4444" },
          { label: "À préparer", value: actives, icon: "🔄", color: "#8b5cf6", onClick: () => { setQuickFilter && setQuickFilter("aPreparer"); setView && setView("orders"); } },
        ].map(s => (
          <Card key={s.label} onClick={s.onClick} style={s.onClick ? { cursor: "pointer" } : undefined}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>{s.icon}</div>
            <div style={{ fontSize: "clamp(18px, 5vw, 26px)", fontWeight: 900, color: s.color, whiteSpace: "nowrap" }}>{s.value}</div>
            <div style={{ fontSize: 10, color: "#999", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em" }}>{s.label}</div>{s.onClick && <div style={{ fontSize: 9, color: "#8b5cf6", fontWeight: 700, marginTop: 2 }}>Voir les commandes →</div>}
          </Card>
        ))}
      </div>
      <Card>
        <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800 }}>📅 Prochaines livraisons / retours</h3>
        {upcoming.length === 0 ? <div style={{ color: "#999", textAlign: "center", padding: 20 }}>Aucune à venir</div> : upcoming.map((ev, i) => (
          <div key={ev.order.id + ev.type + i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #f4f4f4" }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: ev.type === "retour" ? "#fff7ed" : "#f0f4ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{ev.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{ev.order.clientName}</div>
              <div style={{ fontSize: 12, color: ev.type === "retour" ? "#c2410c" : "#3b82f6", fontWeight: 700 }}>{ev.label}</div>
              <div style={{ fontSize: 12, color: "#666" }}>{fmtD(ev.date)}{ev.time ? ` à ${ev.time}` : ""} — {ev.lieu}</div>
            </div>
            <Badge status={ev.order.status} />
          </div>
        ))}
      </Card>
    </div>
  );
}

// ─── GESTION DE STOCK ─────────────────────────────────────────────────────────
function InventoryModal({ stock, setStock, onClose }) {
  const articles = (stock || []).filter(s => !s.components).map(withLocations);
  const [counts, setCounts] = useState(() => Object.fromEntries(articles.map(a => [a.id, { camion: String(a.qtyCamion), local: String(a.qtyLocal) }])));
  const [step, setStep] = useState("saisie");
  const setC = (id, loc, val) => { if (/^\d*$/.test(val)) setCounts(c => ({ ...c, [id]: { ...c[id], [loc]: val } })); };
  const ecarts = articles.map(a => {
    const reel = counts[a.id] || { camion: a.qtyCamion, local: a.qtyLocal };
    const rc = parseInt(reel.camion) || 0, rl = parseInt(reel.local) || 0;
    return { id: a.id, name: a.name, icon: a.icon, thCamion: a.qtyCamion, thLocal: a.qtyLocal, reCamion: rc, reLocal: rl, ecartCamion: rc - a.qtyCamion, ecartLocal: rl - a.qtyLocal };
  }).filter(e => e.ecartCamion !== 0 || e.ecartLocal !== 0);

  const valider = () => {
    setStock(prev => prev.map(s => {
      const c = counts[s.id];
      if (!c || s.components) return s;
      const qc = parseInt(c.camion) || 0, ql = parseInt(c.local) || 0;
      return { ...s, qtyCamion: qc, qtyLocal: ql, total: qc + ql };
    }));
    onClose();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {step === "saisie" && (
        <>
          <div style={{ fontSize: 13, color: "#666" }}>Comptez le matériel et saisissez les quantités réelles. Le théorique est rappelé en gris.</div>
          <div style={{ maxHeight: "55vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            {articles.map(a => {
              const reel = counts[a.id] || { camion: "0", local: "0" };
              const rc = parseInt(reel.camion) || 0, rl = parseInt(reel.local) || 0;
              const ecC = rc - a.qtyCamion, ecL = rl - a.qtyLocal;
              return (
                <div key={a.id} style={{ border: "1px solid #eee", borderRadius: 10, padding: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontWeight: 700, fontSize: 14 }}><span>{a.icon}</span>{a.name}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#c2410c", fontWeight: 700, marginBottom: 2 }}>🚚 Camion <span style={{ color: "#bbb", fontWeight: 400 }}>(théo. {a.qtyCamion})</span></div>
                      <input inputMode="numeric" value={reel.camion} onChange={e => setC(a.id, "camion", e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid " + (ecC !== 0 ? "#f59e0b" : "#e5e7eb"), boxSizing: "border-box" }} />
                      {ecC !== 0 && <div style={{ fontSize: 11, color: ecC > 0 ? "#10b981" : "#ef4444", fontWeight: 700, marginTop: 2 }}>{ecC > 0 ? "+" : ""}{ecC}</div>}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "#1d4ed8", fontWeight: 700, marginBottom: 2 }}>🏠 Local <span style={{ color: "#bbb", fontWeight: 400 }}>(théo. {a.qtyLocal})</span></div>
                      <input inputMode="numeric" value={reel.local} onChange={e => setC(a.id, "local", e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid " + (ecL !== 0 ? "#f59e0b" : "#e5e7eb"), boxSizing: "border-box" }} />
                      {ecL !== 0 && <div style={{ fontSize: 11, color: ecL > 0 ? "#10b981" : "#ef4444", fontWeight: 700, marginTop: 2 }}>{ecL > 0 ? "+" : ""}{ecL}</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="secondary" onClick={onClose}>Annuler</Btn>
            <Btn variant="primary" onClick={() => setStep("recap")}>Voir le récapitulatif →</Btn>
          </div>
        </>
      )}
      {step === "recap" && (
        <>
          <div style={{ fontWeight: 800, fontSize: 15 }}>📊 Récapitulatif des écarts</div>
          {ecarts.length === 0 ? (
            <div style={{ background: "#f0fdf4", color: "#15803d", borderRadius: 10, padding: 14, fontWeight: 700 }}>✅ Aucun écart : le stock compté correspond au stock théorique.</div>
          ) : (
            <div style={{ maxHeight: "50vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {ecarts.map(e => (
                <div key={e.id} style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 10, padding: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{e.icon} {e.name}</div>
                  <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
                    {e.ecartCamion !== 0 && <span>🚚 Camion : {e.thCamion} → <strong>{e.reCamion}</strong> <span style={{ color: e.ecartCamion > 0 ? "#10b981" : "#ef4444", fontWeight: 800 }}>({e.ecartCamion > 0 ? "+" : ""}{e.ecartCamion})</span></span>}
                    {e.ecartLocal !== 0 && <span>🏠 Local : {e.thLocal} → <strong>{e.reLocal}</strong> <span style={{ color: e.ecartLocal > 0 ? "#10b981" : "#ef4444", fontWeight: 800 }}>({e.ecartLocal > 0 ? "+" : ""}{e.ecartLocal})</span></span>}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="secondary" onClick={() => setStep("saisie")}>← Retour</Btn>
            <Btn variant="primary" onClick={valider}>✅ Enregistrer l'inventaire</Btn>
          </div>
        </>
      )}
    </div>
  );
}
function StockView({ orders, stock, setStock }) {
  const [askConfirm, ConfirmUI] = useConfirm();
  const [editItem, setEditItem] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [filterCat, setFilterCat] = useState("Toutes");
  const [showAdd, setShowAdd] = useState(false);
  const [newItem, setNewItem] = useState({ name: "", icon: "📦", category: "Équipements", unit: "unité", price: 0, coutAchat: 0, caution: 0, cleaningOption: false, cleaningPrice: 0, qtyCamion: 0, qtyLocal: 0, total: 0, seuil: 0, enMaintenance: 0, isKit: false, components: null });
  const [showInventory, setShowInventory] = useState(false);

  const activeStatuses = ["Confirmée", "Préparée", "Chez le client"];
  const stockSorti = useMemo(() => {
    const out = {};
    orders.filter(o => activeStatuses.includes(o.status)).forEach(o => {
      const needs = expandToBaseNeeds(o.items, stock);
      for (const id in needs) out[id] = (out[id] || 0) + needs[id];
    });
    return out;
  }, [orders, stock]);

  const cats = ["Toutes", ...new Set(stock.map(s => s.category))];
  const filtered = stock.filter(s => filterCat === "Toutes" || s.category === filterCat);
  // Dispo d'un article normal = total - maintenance - sorti.
  // Dispo d'un kit = nombre de kits réalisables avec le stock dispo de ses composants.
  const getDispo = (item) => {
    if (item.components && item.components.length > 0) {
      return Math.min(...item.components.map(comp => {
        const art = stock.find(s => s.id === comp.id);
        if (!art) return 0;
        const dispoArt = (art.total || 0) - (art.enMaintenance || 0) - (stockSorti[art.id] || 0);
        const per = parseInt(comp.qty) || 1;
        return Math.floor(dispoArt / per);
      }));
    }
    return (item.total || 0) - (item.enMaintenance || 0) - (stockSorti[item.id] || 0);
  };

  const alertes = stock.filter(s => getDispo(s) <= s.seuil).length;
  const totalSorti = Object.values(stockSorti).reduce((a, b) => a + b, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
        {[
          { label: "Total articles", value: stock.reduce((s, i) => s + i.total, 0), icon: "📦", color: "#3b82f6" },
          { label: "En location", value: totalSorti, icon: "🚚", color: "#f97316" },
          { label: "En maintenance", value: stock.reduce((s, i) => s + i.enMaintenance, 0), icon: "🔧", color: "#8b5cf6" },
          { label: "Alertes stock", value: alertes, icon: "⚠️", color: alertes > 0 ? "#ef4444" : "#10b981" },
        ].map(s => <Card key={s.label}><div style={{ fontSize: 22, marginBottom: 6 }}>{s.icon}</div><div style={{ fontSize: "clamp(18px, 5vw, 26px)", fontWeight: 900, color: s.color, whiteSpace: "nowrap" }}>{s.value}</div><div style={{ fontSize: 10, color: "#999", fontWeight: 700, textTransform: "uppercase" }}>{s.label}</div></Card>)}
      </div>
      <Card>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {cats.map(c => <button key={c} onClick={() => setFilterCat(c)} style={{ padding: "6px 14px", borderRadius: 20, border: "1.5px solid", borderColor: filterCat === c ? "#1a1a2e" : "#e5e7eb", background: filterCat === c ? "#1a1a2e" : "#fff", color: filterCat === c ? "#fff" : "#666", fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>{c}</button>)}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="secondary" size="sm" onClick={() => setShowInventory(true)}>📋 Inventaire</Btn>
            <Btn variant="primary" size="sm" onClick={() => setShowAdd(true)}><span style={{ width: 14, height: 14 }}>{I.plus}</span> Ajouter</Btn>
          </div>
        </div>
      </Card>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#f8f9fa" }}>{["Article", "Prix loc.", "Coût achat", "Caution", "Total", "🚚 Camion", "🏠 Local", "En location", "Maintenance", "Disponible", "Seuil", ""].map(h => <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 800, color: "#999", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((rawItem, idx) => {
                const item = withLocations(rawItem);
                const sorti = stockSorti[item.id] || 0;
                const dispo = getDispo(item);
                const alerte = dispo <= item.seuil;
                const isEd = editItem === item.id;
                return (
                  <React.Fragment key={item.id}>
                  <tr style={{ borderTop: "1px solid #f0f0f0", background: alerte ? "#fff7ed" : idx % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ padding: "12px 16px" }}>
                      {isEd ? <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ display: "flex", gap: 6 }}><input value={editForm.icon} onChange={e => setEditForm(f => ({ ...f, icon: e.target.value }))} style={{ width: 36, padding: "4px", borderRadius: 6, border: "1.5px solid #e5e7eb", textAlign: "center" }} /><input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} style={{ flex: 1, padding: "4px 8px", borderRadius: 6, border: "1.5px solid #e5e7eb", fontSize: 13 }} /></div>
                          <select value={editForm.category || ""} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} style={{ padding: "4px 8px", borderRadius: 6, border: "1.5px solid #e5e7eb", fontSize: 12, fontFamily: "inherit", background: "#fff" }}>
                            {[...new Set([...stock.map(s => s.category), "Chaises", "Tables", "Vaisselle", "Linge", "Équipements", "Kits"])].filter(Boolean).map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        : <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 18 }}>{item.icon}</span><div><div style={{ fontWeight: 700 }}>{item.name} {item.components ? <span style={{ fontSize: 10, background: "#eef2ff", color: "#6366f1", borderRadius: 6, padding: "1px 6px", fontWeight: 800 }}>KIT</span> : null}</div><div style={{ fontSize: 11, color: "#999" }}>{item.category} · {item.components ? kitCompositionText(item, stock) : "/" + item.unit}</div></div></div>}
                    </td>
                    <td style={{ padding: "12px 16px" }}>{isEd ? <input type="number" value={editForm.price} onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))} style={{ width: 70, padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e5e7eb" }} /> : <span style={{ fontWeight: 700 }}>{(parseFloat(item.price) || 0).toFixed(2)} €</span>}</td>
                    <td style={{ padding: "12px 16px" }}>{isEd ? <input type="number" value={editForm.coutAchat} onChange={e => setEditForm(f => ({ ...f, coutAchat: e.target.value }))} style={{ width: 70, padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e5e7eb" }} /> : <span style={{ color: "#666" }}>{(item.coutAchat || 0).toFixed(2)} €</span>}</td>
                    <td style={{ padding: "12px 16px" }}>{isEd ? <input type="number" value={editForm.caution} onChange={e => setEditForm(f => ({ ...f, caution: e.target.value }))} style={{ width: 70, padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e5e7eb" }} /> : <span style={{ color: (item.caution || 0) > 0 ? "#7c3aed" : "#bbb" }}>{(item.caution || 0).toFixed(2)} €</span>}</td>
                    <td style={{ padding: "12px 16px" }}><span style={{ fontWeight: 800 }}>{item.components ? "—" : ((parseInt(isEd ? editForm.qtyCamion : item.qtyCamion) || 0) + (parseInt(isEd ? editForm.qtyLocal : item.qtyLocal) || 0))}</span></td>
                    <td style={{ padding: "12px 16px" }}>{item.components ? "—" : (isEd ? <input type="number" value={editForm.qtyCamion} onChange={e => setEditForm(f => ({ ...f, qtyCamion: e.target.value }))} style={{ width: 55, padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e5e7eb" }} /> : <span style={{ fontWeight: 700, color: "#f97316" }}>{item.qtyCamion}</span>)}</td>
                    <td style={{ padding: "12px 16px" }}>{item.components ? "—" : (isEd ? <input type="number" value={editForm.qtyLocal} onChange={e => setEditForm(f => ({ ...f, qtyLocal: e.target.value }))} style={{ width: 55, padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e5e7eb" }} /> : <span style={{ fontWeight: 700, color: "#3b82f6" }}>{item.qtyLocal}</span>)}</td>
                    <td style={{ padding: "12px 16px" }}><span style={{ color: sorti > 0 ? "#f97316" : "#999", fontWeight: sorti > 0 ? 800 : 400 }}>{sorti}</span></td>
                    <td style={{ padding: "12px 16px" }}>{isEd ? <input type="number" value={editForm.enMaintenance} onChange={e => setEditForm(f => ({ ...f, enMaintenance: e.target.value }))} style={{ width: 70, padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e5e7eb" }} /> : <span style={{ color: item.enMaintenance > 0 ? "#8b5cf6" : "#999" }}>{item.enMaintenance}</span>}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ fontWeight: 900, fontSize: 15, color: dispo <= 0 ? "#ef4444" : alerte ? "#f59e0b" : "#10b981" }}>{dispo}</span>
                        <div style={{ height: 4, background: "#f0f0f0", borderRadius: 4, width: 60 }}><div style={{ height: "100%", borderRadius: 4, background: dispo <= 0 ? "#ef4444" : alerte ? "#f59e0b" : "#10b981", width: `${item.total > 0 ? Math.min(100, Math.max(0, (dispo / item.total) * 100)) : 0}%` }} /></div>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px" }}>{isEd ? <input type="number" value={editForm.seuil} onChange={e => setEditForm(f => ({ ...f, seuil: e.target.value }))} style={{ width: 70, padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e5e7eb" }} /> : <div style={{ display: "flex", alignItems: "center", gap: 4 }}>{alerte && "⚠️"}<span>{item.seuil}</span></div>}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        {isEd ? <>
                          <Btn variant="success" size="sm" disabled={item.components && (!editForm.components || editForm.components.length === 0)} onClick={() => { setStock(prev => prev.map(s => s.id === editItem ? { ...editForm, qtyCamion: +editForm.qtyCamion || 0, qtyLocal: +editForm.qtyLocal || 0, total: (+editForm.qtyCamion || 0) + (+editForm.qtyLocal || 0), seuil: +editForm.seuil, enMaintenance: +editForm.enMaintenance, price: +editForm.price, coutAchat: +editForm.coutAchat, caution: +editForm.caution || 0, cleaningPrice: +editForm.cleaningPrice || 0 } : s)); setEditItem(null); }}><span style={{ width: 13, height: 13 }}>{I.check}</span></Btn>
                          <Btn variant="secondary" size="sm" onClick={() => setEditItem(null)}><span style={{ width: 13, height: 13 }}>{I.x}</span></Btn>
                        </> : <>
                          <Btn variant="secondary" size="sm" onClick={() => { setEditItem(item.id); setEditForm({ ...item }); }}><span style={{ width: 13, height: 13 }}>{I.edit}</span></Btn>
                          <Btn variant="danger" size="sm" onClick={async () => { if (await askConfirm("Supprimer ?")) setStock(prev => prev.filter(s => s.id !== item.id), true); }}><span style={{ width: 13, height: 13 }}>{I.trash}</span></Btn>
                        </>}
                      </div>
                    </td>
                  </tr>
                  {isEd && (
                    <tr key={item.id + "_clean"} style={{ borderTop: "1px dashed #fde68a", background: "#fffbeb" }}>
                      <td colSpan={12} style={{ padding: "12px 16px" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                          <input type="checkbox" checked={!!editForm.cleaningOption} onChange={e => setEditForm(f => ({ ...f, cleaningOption: e.target.checked }))} style={{ width: 18, height: 18 }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>🧼 Option nettoyage disponible sur cet article (proposée à la commande)</span>
                        </label>
                        {editForm.cleaningOption && (
                          <div style={{ marginTop: 10, maxWidth: 220 }}>
                            <Inp label="Supplément nettoyage €/unité" type="number" value={editForm.cleaningPrice} onChange={v => setEditForm(f => ({ ...f, cleaningPrice: v }))} />
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  {isEd && item.components && (
                    <tr key={item.id + "_comps"} style={{ borderTop: "1px dashed #c7d2fe", background: "#f5f5ff" }}>
                      <td colSpan={12} style={{ padding: "14px 16px" }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#6366f1", marginBottom: 10, textTransform: "uppercase" }}>🧩 Composition du kit</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {(editForm.components || []).map((comp, idx) => {
                            const a = stock.find(s => s.id === comp.id);
                            return (
                              <div key={comp.id + idx} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{a ? `${a.icon} ${a.name}` : comp.id}</span>
                                <input type="number" min="1" value={comp.qty} onChange={e => { const q = parseInt(e.target.value) || 1; setEditForm(f => ({ ...f, components: f.components.map((c, i) => i === idx ? { ...c, qty: q } : c) })); }} style={{ width: 60, padding: "6px 8px", borderRadius: 8, border: "1.5px solid #e5e7eb", textAlign: "center" }} />
                                <Btn variant="danger" size="sm" onClick={() => setEditForm(f => ({ ...f, components: f.components.filter((_, i) => i !== idx) }))}><span style={{ width: 13, height: 13 }}>{I.trash}</span></Btn>
                              </div>
                            );
                          })}
                        </div>
                        <select value="" onChange={e => { if (!e.target.value) return; const id = e.target.value; setEditForm(f => ({ ...f, components: [...(f.components || []), { id, qty: 1 }] })); }} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #6366f1", fontSize: 14, marginTop: 10, background: "#fff" }}>
                          <option value="">+ Ajouter un article au kit...</option>
                          {stock.filter(s => !s.components && !(editForm.components || []).find(c => c.id === s.id)).map(s => <option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
                        </select>
                        {(!editForm.components || editForm.components.length === 0) && <div style={{ fontSize: 12, color: "#ef4444", marginTop: 8, fontWeight: 700 }}>⚠️ Un kit doit contenir au moins un article pour être enregistré.</div>}
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal open={showInventory} onClose={() => setShowInventory(false)} title="📋 Inventaire du stock" wide>
        {showInventory && <InventoryModal stock={stock} setStock={setStock} onClose={() => setShowInventory(false)} />}
      </Modal>
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Ajouter un article">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 10 }}>
            <Inp label="Icône" value={newItem.icon} onChange={v => setNewItem(f => ({ ...f, icon: v }))} />
            <Inp label="Nom" value={newItem.name} onChange={v => setNewItem(f => ({ ...f, name: v }))} required />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#666", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 6 }}>Choisir une icône</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(40px, 1fr))", gap: 6, maxHeight: 150, overflowY: "auto", padding: 8, background: "#fafafa", borderRadius: 10, border: "1.5px solid #e5e7eb" }}>
              {ICON_LIBRARY.map(ic => (
                <button key={ic} onClick={() => setNewItem(f => ({ ...f, icon: ic }))} style={{ fontSize: 22, padding: 6, borderRadius: 8, cursor: "pointer", border: newItem.icon === ic ? "2px solid #1a1a2e" : "1.5px solid transparent", background: newItem.icon === ic ? "#eef2ff" : "#fff" }}>{ic}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#666", letterSpacing: "0.05em", textTransform: "uppercase" }}>Catégorie</label>
              <select
                value={newItem._newCat ? "__new__" : newItem.category}
                onChange={e => { if (e.target.value === "__new__") setNewItem(f => ({ ...f, _newCat: true, category: "" })); else setNewItem(f => ({ ...f, _newCat: false, category: e.target.value })); }}
                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 14, fontFamily: "inherit", background: "#fafafa", boxSizing: "border-box" }}>
                {[...new Set([...stock.map(s => s.category), "Chaises", "Tables", "Vaisselle", "Linge", "Équipements"])].filter(Boolean).map(c => <option key={c} value={c}>{c}</option>)}
                <option value="__new__">➕ Nouvelle catégorie…</option>
              </select>
              {newItem._newCat && <input autoFocus value={newItem.category} onChange={e => setNewItem(f => ({ ...f, category: e.target.value }))} placeholder="Nom de la nouvelle catégorie" style={{ marginTop: 6, width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #1a1a2e", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" }} />}
            </div>
            <Inp label="Unité" value={newItem.unit} onChange={v => setNewItem(f => ({ ...f, unit: v }))} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: newItem.isKit ? "#eef2ff" : "#fafafa", borderRadius: 10, border: "1.5px solid " + (newItem.isKit ? "#6366f1" : "#e5e7eb"), cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
            <input type="checkbox" checked={!!newItem.isKit} onChange={e => setNewItem(f => ({ ...f, isKit: e.target.checked, category: e.target.checked ? "Kits" : (f.category === "Kits" ? "Équipements" : f.category), components: e.target.checked ? (f.components || []) : null }))} style={{ width: 18, height: 18 }} />
            ☑️ C'est un kit (composé de plusieurs articles)
          </label>
          {newItem.isKit && (
            <div style={{ background: "#f8f9ff", borderRadius: 12, padding: 14, border: "1px solid #e0e4ff" }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>📦 Composition du kit</div>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>Sélectionnez les articles et la quantité de chacun dans 1 kit. Le stock sera décompté automatiquement.</div>
              {(newItem.components || []).map((comp, idx) => {
                const art = stock.find(s => s.id === comp.id);
                return (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ flex: 1, fontSize: 14 }}>{art ? `${art.icon} ${art.name}` : "?"}</span>
                    <input type="number" value={comp.qty} onChange={e => { const q = parseInt(e.target.value) || 0; setNewItem(f => ({ ...f, components: f.components.map((c, i) => i === idx ? { ...c, qty: q } : c) })); }} style={{ width: 60, padding: "6px 8px", borderRadius: 8, border: "1.5px solid #e5e7eb", textAlign: "center" }} />
                    <button onClick={() => setNewItem(f => ({ ...f, components: f.components.filter((_, i) => i !== idx) }))} style={{ background: "#fee2e2", color: "#b91c1c", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontWeight: 700 }}>✕</button>
                  </div>
                );
              })}
              <select value="" onChange={e => { if (!e.target.value) return; const id = e.target.value; setNewItem(f => ({ ...f, components: [...(f.components || []), { id, qty: 1 }] })); }} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #6366f1", fontSize: 14, marginTop: 6, background: "#fff" }}>
                <option value="">➕ Ajouter un article au kit…</option>
                {stock.filter(s => !s.components && !(newItem.components || []).find(c => c.id === s.id)).map(s => <option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
              </select>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <Inp label="Prix loc. €" type="number" value={newItem.price} onChange={v => setNewItem(f => ({ ...f, price: v }))} />
            <Inp label="Coût achat €" type="number" value={newItem.coutAchat} onChange={v => setNewItem(f => ({ ...f, coutAchat: v }))} />
            <Inp label="🔒 Caution €/unité" type="number" value={newItem.caution} onChange={v => setNewItem(f => ({ ...f, caution: v }))} />
          </div>
          <div style={{ background: "#f8f9ff", borderRadius: 10, padding: "12px 14px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: newItem.cleaningOption ? 10 : 0 }}>
              <input type="checkbox" checked={!!newItem.cleaningOption} onChange={e => setNewItem(f => ({ ...f, cleaningOption: e.target.checked }))} style={{ width: 18, height: 18 }} />
              <span style={{ fontSize: 13, fontWeight: 700 }}>🧼 Proposer une option de nettoyage (au lieu de créer un article "sale"/"propre" séparé)</span>
            </label>
            {newItem.cleaningOption && <Inp label="Supplément nettoyage €/unité" type="number" value={newItem.cleaningPrice} onChange={v => setNewItem(f => ({ ...f, cleaningPrice: v }))} />}
          </div>
          {!newItem.isKit && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <Inp label="🚚 Qté camion" type="number" value={newItem.qtyCamion} onChange={v => setNewItem(f => ({ ...f, qtyCamion: v }))} />
            <Inp label="🏠 Qté local" type="number" value={newItem.qtyLocal} onChange={v => setNewItem(f => ({ ...f, qtyLocal: v }))} />
            <Inp label="Seuil" type="number" value={newItem.seuil} onChange={v => setNewItem(f => ({ ...f, seuil: v }))} />
          </div>}
          {!newItem.isKit && <div style={{ fontSize: 12, color: "#666", textAlign: "right" }}>Total : <strong>{(parseInt(newItem.qtyCamion) || 0) + (parseInt(newItem.qtyLocal) || 0)}</strong></div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="secondary" onClick={() => setShowAdd(false)}>Annuler</Btn>
            <Btn variant="primary" disabled={!newItem.name || (newItem.isKit && (!newItem.components || newItem.components.length === 0))} onClick={() => {
              const base = { id: (newItem.isKit ? "kit_" : "custom_") + Date.now(), name: newItem.name, icon: newItem.icon, category: newItem.isKit ? "Kits" : newItem.category, unit: newItem.unit, price: +newItem.price, coutAchat: +newItem.coutAchat, caution: +newItem.caution || 0, cleaningOption: !!newItem.cleaningOption, cleaningPrice: +newItem.cleaningPrice || 0 };
              const qc = +newItem.qtyCamion || 0, ql = +newItem.qtyLocal || 0;
              const item = newItem.isKit
                ? { ...base, components: newItem.components, total: 0, qtyCamion: 0, qtyLocal: 0, seuil: 0, enMaintenance: 0 }
                : { ...base, qtyCamion: qc, qtyLocal: ql, total: qc + ql, seuil: +newItem.seuil, enMaintenance: 0 };
              setStock(prev => [...prev, item]);
              setShowAdd(false);
              setNewItem({ name: "", icon: "📦", category: "Équipements", unit: "unité", price: 0, coutAchat: 0, caution: 0, cleaningOption: false, cleaningPrice: 0, qtyCamion: 0, qtyLocal: 0, total: 0, seuil: 0, enMaintenance: 0, isKit: false, components: null });
            }}><span style={{ width: 14, height: 14 }}>{I.plus}</span> Ajouter</Btn>
          </div>
        </div>
      </Modal>
      {ConfirmUI}
    </div>
  );
}

// ─── COMPTABILITÉ + SEUIL DE RENTABILITÉ ─────────────────────────────────────
function ComptaView({ orders, expenses, setExpenses, stock, settings, expenseCategories, setExpenseCategories, recurringExpenses, setRecurringExpenses }) {
  const [askConfirm, ConfirmUI] = useConfirm();
  const [activeTab, setActiveTab] = useState("synthese");
  const [showForm, setShowForm] = useState(false);
  const [editExp, setEditExp] = useState(null);
  const [filterCat, setFilterCat] = useState("Toutes");
  const [filterMonth, setFilterMonth] = useState("Tous");
  // Filtre de période global (synthèse) : dates début/fin. Vide = tout.
  const [periodeStart, setPeriodeStart] = useState("");
  const [periodeFin, setPeriodeFin] = useState("");
  const [filterCatSynth, setFilterCatSynth] = useState("Toutes");
  const [showCatManager, setShowCatManager] = useState(false);
  const dansPeriode = (dateStr) => {
    if (!dateStr) return false;
    if (periodeStart && dateStr < periodeStart) return false;
    if (periodeFin && dateStr > periodeFin) return false;
    return true;
  };
  const periodeActive = periodeStart || periodeFin;
  const [form, setForm] = useState({ date: TODAY, label: "", category: "Achat matériel", amount: "", supplier: "", paymentMethod: "CB", notes: "", linkedItemId: "", linkedQty: 0 });
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));
  // Dépenses récurrentes (loyer, box internet, forfait téléphone...)
  const [showRecForm, setShowRecForm] = useState(false);
  const [editRec, setEditRec] = useState(null);
  const [recForm, setRecForm] = useState({ label: "", category: "Loyer / Entrepôt", amount: "", dayOfMonth: 1, paymentMethod: "Prélèvement", supplier: "", active: true });
  const setRF = (k, v) => setRecForm(f => ({ ...f, [k]: v }));
  const openAddRec = () => { setEditRec(null); setRecForm({ label: "", category: "Loyer / Entrepôt", amount: "", dayOfMonth: 1, paymentMethod: "Prélèvement", supplier: "", active: true }); setShowRecForm(true); };
  const openEditRec = (r) => { setEditRec(r.id); setRecForm({ ...r }); setShowRecForm(true); };
  const saveRec = () => {
    if (!recForm.label || !recForm.amount) { alert("Libellé et montant requis"); return; }
    const entry = { ...recForm, amount: parseFloat(recForm.amount) || 0, dayOfMonth: parseInt(recForm.dayOfMonth) || 1, id: editRec || "REC-" + Date.now() };
    setRecurringExpenses(prev => editRec ? (prev || []).map(r => r.id === editRec ? entry : r) : [entry, ...(prev || [])]);
    setShowRecForm(false);
  };

  const revenueOrders = useMemo(() => orders.filter(o => o.status === "Clôturée"), [orders]);
  // CA : commandes clôturées, filtrées par période si active (sur la date de livraison ou de retour)
  const revenueOrdersP = periodeActive ? revenueOrders.filter(o => dansPeriode(o.deliveryDate || o.returnDate)) : revenueOrders;
  // Dépenses : filtrées par période (date de la dépense) ET par catégorie
  const expensesP = expenses.filter(e => (!periodeActive || dansPeriode(e.date)) && (filterCatSynth === "Toutes" || e.category === filterCatSynth));
  const totalRevenu = revenueOrdersP.reduce((s, o) => s + orderTotal(o, settings), 0);
  const totalLivraison = revenueOrdersP.reduce((s, o) => s + deliveryCostOf(o, settings) + deliveryExtrasCost(o), 0);
  const totalLavage = revenueOrdersP.reduce((s, o) => s + (o.items || []).reduce((si, i) => i.cleaningSelected ? si + (parseInt(i.qty) || 0) * (parseFloat(i.cleaningPrice) || 0) : si, 0), 0);
  const totalDepenses = expensesP.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const benefice = totalRevenu - totalDepenses;
  const totalAcomptes = (periodeActive ? orders.filter(o => dansPeriode(o.deliveryDate || o.returnDate)) : orders).reduce((s, o) => s + parseFloat(o.acompte || 0), 0);
  const filtreActif = periodeActive || filterCatSynth !== "Toutes";

  const allMonths = [...new Set(expenses.map(e => (e.date || "").slice(0, 7)).filter(Boolean))].sort().reverse();
  const filtered = expenses.filter(e => (filterCat === "Toutes" || e.category === filterCat) && (filterMonth === "Tous" || (e.date || "").startsWith(filterMonth)));
  const totalFiltered = filtered.reduce((s, e) => s + parseFloat(e.amount || 0), 0);

  // ── Seuil de rentabilité par article
  // Calcul lourd (stock × commandes clôturées × articles) : mémorisé pour ne tourner que lorsque
  // stock, expenses ou orders changent réellement — pas à chaque frappe dans un champ du formulaire.
  const rentabilite = useMemo(() => stock.map(item => {
    const totalAchat = expenses.filter(e => e.linkedItemId === item.id).reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    const revenusGeneres = revenueOrders.reduce((s, o) => {
      let total = 0;
      for (const it of (o.items || [])) {
        const qty = parseInt(it.qty) || 0;
        if (qty <= 0) continue;
        if (it.id === item.id) {
          // Ligne directe sur cet article
          total += qty * (parseFloat(it.price) || 0);
        } else {
          // Ligne sur un kit : si cet article fait partie de ses composants, on lui attribue
          // sa part (quantité du composant × prix actuel de l'article), comme si chaque
          // composant avait été loué séparément.
          const stockLine = stock.find(s => s.id === it.id);
          const comp = stockLine && stockLine.components && stockLine.components.find(c => c.id === item.id);
          if (comp) {
            const compQty = (parseInt(comp.qty) || 0) * qty;
            total += compQty * (parseFloat(item.price) || 0);
          }
        }
      }
      return s + total;
    }, 0);
    const qtéAchetee = expenses.filter(e => e.linkedItemId === item.id).reduce((s, e) => s + (parseInt(e.linkedQty) || 0), 0);
    const locParItem = item.price;
    const locsNeeded = totalAchat > 0 && locParItem > 0 ? Math.ceil(totalAchat / locParItem) : null;
    const pct = totalAchat > 0 ? Math.min(100, (revenusGeneres / totalAchat) * 100) : 0;
    return { ...item, totalAchat, revenusGeneres, qtéAchetee, locsNeeded, pct, amorti: revenusGeneres >= totalAchat };
  }).filter(r => r.totalAchat > 0).sort((a, b) => b.totalAchat - a.totalAchat), [stock, expenses, revenueOrders]);

  const openAdd = () => { setEditExp(null); setForm({ date: TODAY, label: "", category: "Achat matériel", amount: "", supplier: "", paymentMethod: "CB", notes: "", linkedItemId: "", linkedQty: 0 }); setShowForm(true); };
  const openEdit = (e) => { setEditExp(e.id); setForm({ ...e }); setShowForm(true); };
  const saveExp = () => {
    if (!form.label || !form.amount) { alert("Libellé et montant requis"); return; }
    const entry = { ...form, amount: parseFloat(form.amount), linkedQty: parseInt(form.linkedQty) || 0, id: editExp || "DEP-" + Date.now() };
    setExpenses(prev => editExp ? prev.map(e => e.id === editExp ? entry : e) : [entry, ...prev]);
    setShowForm(false);
  };

  const last6 = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const rev = revenueOrders.filter(o => o.deliveryDate?.startsWith(key)).reduce((s, o) => s + orderTotal(o, settings), 0);
    const dep = expenses.filter(e => (e.date || "").startsWith(key)).reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    last6.push({ key, label: d.toLocaleString("fr-FR", { month: "short" }), rev, dep });
  }
  const maxBar = Math.max(...last6.map(m => Math.max(m.rev, m.dep)), 1);

  const byCategory = ( expenseCategories || EXPENSE_CATEGORIES).map(cat => ({ cat, total: expenses.filter(e => e.category === cat && (!periodeActive || dansPeriode(e.date))).reduce((s, e) => s + parseFloat(e.amount || 0), 0) })).filter(x => x.total > 0).sort((a, b) => b.total - a.total);
  const maxCat = byCategory[0]?.total || 1;

  const tabs = [{ id: "synthese", label: "📊 Synthèse" }, { id: "seuil", label: "🎯 Rentabilité" }, { id: "depenses", label: "🛒 Dépenses" }, { id: "revenus", label: "📈 Revenus" }];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
        {[
          { label: "Chiffre d'affaires", value: totalRevenu.toFixed(2) + " €", icon: "📈", color: "#10b981" },
          { label: "Acomptes encaissés", value: totalAcomptes.toFixed(2) + " €", icon: "💰", color: "#3b82f6" },
          { label: "Total dépenses", value: totalDepenses.toFixed(2) + " €", icon: "🛒", color: "#ef4444" },
          { label: "Bénéfice net", value: benefice.toFixed(2) + " €", icon: benefice >= 0 ? "✅" : "⚠️", color: benefice >= 0 ? "#10b981" : "#ef4444" },
          { label: "Revenus livraison", value: totalLivraison.toFixed(2) + " €", icon: "🚚", color: "#6366f1" },
          { label: "Revenus lavage", value: totalLavage.toFixed(2) + " €", icon: "🧼", color: "#06b6d4" },
        ].map(s => <Card key={s.label}><div style={{ fontSize: 20, marginBottom: 6 }}>{s.icon}</div><div style={{ fontSize: "clamp(15px, 4.5vw, 22px)", fontWeight: 900, color: s.color, whiteSpace: "nowrap" }}>{s.value}</div><div style={{ fontSize: 10, color: "#999", fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>{s.label}</div></Card>)}
      </div>

      {/* Filtre de période (s'applique aux chiffres ci-dessus) */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>🔎 Filtrer la synthèse</h3>
          {filtreActif && <button onClick={() => { setPeriodeStart(""); setPeriodeFin(""); setFilterCatSynth("Toutes"); }} style={{ background: "none", border: "none", color: "#3b82f6", fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>↺ Tout afficher</button>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <Inp label="Du" type="date" value={periodeStart} onChange={setPeriodeStart} />
          <Inp label="Au" type="date" value={periodeFin} onChange={setPeriodeFin} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {[
            { label: "Ce mois", fn: () => { const d = new Date(); setPeriodeStart(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`); setPeriodeFin(new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().slice(0,10)); } },
            { label: "Cette année", fn: () => { const y = new Date().getFullYear(); setPeriodeStart(`${y}-01-01`); setPeriodeFin(`${y}-12-31`); } },
            { label: "30 derniers jours", fn: () => { const f = new Date(); const s = new Date(); s.setDate(s.getDate()-30); setPeriodeStart(s.toISOString().slice(0,10)); setPeriodeFin(f.toISOString().slice(0,10)); } },
          ].map(b => <button key={b.label} onClick={b.fn} style={{ background: "#f0f4ff", border: "none", color: "#3b82f6", borderRadius: 8, padding: "6px 12px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>{b.label}</button>)}
        </div>
        <div style={{ marginTop: 12 }}>
          <Sel label="Catégorie de dépense (affecte les dépenses et le bénéfice)" value={filterCatSynth} onChange={setFilterCatSynth} options={[{ value: "Toutes", label: "Toutes les catégories" }, ...( expenseCategories || EXPENSE_CATEGORIES).map(c => ({ value: c, label: c }))]} />
        </div>
        {filtreActif && <div style={{ marginTop: 10, fontSize: 12, color: "#10b981", fontWeight: 700 }}>✓ Filtré{periodeStart ? ` du ${fmtD(periodeStart)}` : ""}{periodeFin ? ` au ${fmtD(periodeFin)}` : ""}{filterCatSynth !== "Toutes" ? ` · catégorie : ${filterCatSynth}` : ""} — {revenueOrdersP.length} commande(s), {expensesP.length} dépense(s)</div>}
      </Card>

      <div style={{ display: "flex", gap: 4, background: "#f0f0f0", borderRadius: 12, padding: 4, overflowX: "auto", WebkitOverflowScrolling: "touch", maxWidth: "100%" }}>
        {tabs.map(t => <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ padding: "8px 18px", borderRadius: 10, border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 13, background: activeTab === t.id ? "#fff" : "transparent", color: activeTab === t.id ? "#1a1a2e" : "#999", boxShadow: activeTab === t.id ? "0 2px 8px rgba(0,0,0,0.08)" : "none", whiteSpace: "nowrap", flexShrink: 0 }}>{t.label}</button>)}
      </div>

      {/* ── SYNTHÈSE ── */}
      {activeTab === "synthese" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 16 }}>
          <Card>
            <h3 style={{ margin: "0 0 20px", fontSize: 15, fontWeight: 800 }}>📊 Revenus vs Dépenses (6 mois)</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 160, width: "100%", overflow: "hidden" }}>
              {last6.map(m => (
                <div key={m.key} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 130 }}>
                    <div title={`Revenus: ${m.rev.toFixed(0)} €`} style={{ width: 14, borderRadius: "4px 4px 0 0", background: "#10b981", height: `${Math.max(2, (m.rev / maxBar) * 120)}px` }} />
                    <div title={`Dépenses: ${m.dep.toFixed(0)} €`} style={{ width: 14, borderRadius: "4px 4px 0 0", background: "#ef4444", height: `${Math.max(2, (m.dep / maxBar) * 120)}px` }} />
                  </div>
                  <div style={{ fontSize: 10, color: "#999", fontWeight: 700 }}>{m.label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 10, justifyContent: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}><div style={{ width: 12, height: 12, borderRadius: 3, background: "#10b981" }} />Revenus</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}><div style={{ width: 12, height: 12, borderRadius: 3, background: "#ef4444" }} />Dépenses</div>
            </div>
          </Card>
          <Card>
            <h3 style={{ margin: "0 0 20px", fontSize: 15, fontWeight: 800 }}>🗂️ Dépenses par catégorie</h3>
            {byCategory.length === 0 ? <div style={{ color: "#999", textAlign: "center", padding: 30 }}>Aucune dépense</div> : byCategory.map(({ cat, total }) => (
              <div key={cat} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  <span><span style={{ width: 10, height: 10, borderRadius: 2, background: CAT_COLORS[cat] || "#999", display: "inline-block", marginRight: 6 }} />{cat}</span>
                  <span style={{ fontWeight: 800 }}>{total.toFixed(2)} €</span>
                </div>
                <div style={{ height: 6, background: "#f0f0f0", borderRadius: 4 }}><div style={{ height: "100%", background: CAT_COLORS[cat] || "#999", borderRadius: 4, width: `${(total / maxCat) * 100}%` }} /></div>
              </div>
            ))}
          </Card>
          <Card style={{ gridColumn: "1 / -1" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800 }}>💹 Indicateurs clés</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
              {[
                { label: "Taux de marge", value: totalRevenu > 0 ? ((benefice / totalRevenu) * 100).toFixed(1) + "%" : "—", color: benefice >= 0 ? "#10b981" : "#ef4444" },
                { label: "Dépense moy.", value: expenses.length > 0 ? (totalDepenses / expenses.length).toFixed(2) + " €" : "—", color: "#f59e0b" },
                { label: "Revenu moy. / cmd", value: revenueOrders.length > 0 ? (totalRevenu / revenueOrders.length).toFixed(2) + " €" : "—", color: "#3b82f6" },
                { label: "Reste à encaisser", value: orders.reduce((s, o) => { const t = orderTotal(o, settings); return s + t - parseFloat(o.acompte || 0); }, 0).toFixed(2) + " €", color: "#8b5cf6" },
              ].map(k => <div key={k.label} style={{ background: "#f8f9fa", borderRadius: 12, padding: 16, textAlign: "center" }}><div style={{ fontSize: 20, fontWeight: 900, color: k.color }}>{k.value}</div><div style={{ fontSize: 11, color: "#999", fontWeight: 700, marginTop: 4 }}>{k.label}</div></div>)}
            </div>
          </Card>
        </div>
      )}

      {/* ── SEUIL DE RENTABILITÉ ── */}
      {activeTab === "seuil" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card style={{ background: "linear-gradient(135deg, #1a1a2e, #16213e)", color: "#fff" }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 800 }}>🎯 Seuil de rentabilité</h3>
            <p style={{ margin: 0, opacity: 0.7, fontSize: 13, lineHeight: 1.6 }}>
              Pour chaque article acheté, calculez combien de locations sont nécessaires pour amortir votre investissement. Liez vos dépenses d'achat à un article dans la section "Dépenses" pour voir les calculs.
            </p>
          </Card>
          {rentabilite.length === 0 ? (
            <Card style={{ textAlign: "center", padding: 50 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🔗</div>
              <div style={{ fontWeight: 700, color: "#666", marginBottom: 8 }}>Aucun article lié à une dépense</div>
              <div style={{ fontSize: 13, color: "#999" }}>Dans la section "Dépenses", liez chaque achat à un article du stock pour voir son seuil de rentabilité.</div>
            </Card>
          ) : rentabilite.map(item => (
            <Card key={item.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 28 }}>{item.icon}</span>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{item.name}</div>
                    <div style={{ fontSize: 12, color: "#666" }}>{item.qtéAchetee > 0 ? `${item.qtéAchetee} unités achetées` : "Achat enregistré"}</div>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  {item.amorti ? (
                    <span style={{ background: "#d1fae5", color: "#065f46", borderRadius: 10, padding: "4px 14px", fontWeight: 800, fontSize: 13 }}>✅ Amorti</span>
                  ) : (
                    <span style={{ background: "#fff7ed", color: "#c2410c", borderRadius: 10, padding: "4px 14px", fontWeight: 800, fontSize: 13 }}>⏳ En cours</span>
                  )}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
                <div style={{ background: "#fff7ed", borderRadius: 10, padding: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "#92400e", fontWeight: 700 }}>COÛT TOTAL ACHAT</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "#c2410c" }}>{item.totalAchat.toFixed(2)} €</div>
                </div>
                <div style={{ background: "#f0fdf4", borderRadius: 10, padding: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "#065f46", fontWeight: 700 }}>REVENUS GÉNÉRÉS</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "#10b981" }}>{item.revenusGeneres.toFixed(2)} €</div>
                </div>
                <div style={{ background: item.amorti ? "#ecfdf5" : "#fef3c7", borderRadius: 10, padding: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: item.amorti ? "#065f46" : "#92400e", fontWeight: 700 }}>{item.amorti ? "BÉNÉFICE" : "RESTE À AMORTIR"}</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: item.amorti ? "#059669" : "#f59e0b" }}>
                    {item.amorti
                      ? `+${(item.revenusGeneres - item.totalAchat).toFixed(2)} €`
                      : `${Math.max(0, item.totalAchat - item.revenusGeneres).toFixed(2)} €`}
                  </div>
                </div>
              </div>

              {/* Barre de progression */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#666", marginBottom: 6 }}>
                  <span>Progression amortissement</span>
                  <span style={{ fontWeight: 800, color: item.amorti ? "#10b981" : "#f59e0b" }}>{item.pct.toFixed(0)}%</span>
                </div>
                <div style={{ height: 12, background: "#f0f0f0", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 10, background: item.amorti ? "#10b981" : "linear-gradient(90deg, #f59e0b, #f97316)", width: `${item.pct}%`, transition: "width 0.5s" }} />
                </div>
              </div>

              {item.locsNeeded && !item.amorti && (item.price > 0) && (
                <div style={{ background: "#f0f4ff", borderRadius: 10, padding: 10, fontSize: 13, color: "#3b82f6", fontWeight: 600 }}>
                  💡 Il faut encore <strong>{Math.ceil((item.totalAchat - item.revenusGeneres) / item.price)}</strong> location(s) à {(parseFloat(item.price) || 0).toFixed(2)} €/unité pour amortir complètement cet achat.
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* ── DÉPENSES ── */}
      {activeTab === "depenses" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>🔁 Dépenses récurrentes (automatiques)</h3>
              <Btn variant="primary" size="sm" onClick={openAddRec}><span style={{ width: 14, height: 14 }}>{I.plus}</span> Ajouter</Btn>
            </div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 14, lineHeight: 1.5 }}>
              Loyer, box internet, forfait téléphone... Une dépense est créée <strong>automatiquement chaque mois</strong> pour chaque ligne active ci-dessous, sans rien avoir à refaire.
            </div>
            {(!recurringExpenses || recurringExpenses.length === 0) ? (
              <div style={{ textAlign: "center", padding: 24, color: "#999", fontSize: 13 }}>Aucune dépense récurrente configurée.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {recurringExpenses.map(r => (
                  <div key={r.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, background: r.active === false ? "#f8f8f8" : "#f8f9ff", borderRadius: 10, padding: "10px 14px", opacity: r.active === false ? 0.6 : 1 }}>
                    <div style={{ flex: "1 1 100%", minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{r.label} {r.active === false && <span style={{ fontSize: 11, color: "#999", fontWeight: 700 }}>(en pause)</span>}</div>
                      <div style={{ fontSize: 11, color: "#999" }}>{r.category} · le {r.dayOfMonth} du mois · {r.paymentMethod}</div>
                    </div>
                    <div style={{ fontWeight: 900, fontSize: 15, color: "#ef4444" }}>{(parseFloat(r.amount) || 0).toFixed(2)} €/mois</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Btn variant="secondary" size="sm" onClick={() => setRecurringExpenses(prev => prev.map(x => x.id === r.id ? { ...x, active: x.active === false } : x))}>{r.active === false ? "▶️" : "⏸️"}</Btn>
                      <Btn variant="secondary" size="sm" onClick={() => openEditRec(r)}><span style={{ width: 13, height: 13 }}>{I.edit}</span></Btn>
                      <Btn variant="danger" size="sm" onClick={async () => { if (await askConfirm("Supprimer cette dépense récurrente ?")) setRecurringExpenses(prev => prev.filter(x => x.id !== r.id), true); }}><span style={{ width: 13, height: 13 }}>{I.trash}</span></Btn>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ padding: "7px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontFamily: "inherit", fontSize: 13 }}>
                  {["Toutes", ...(expenseCategories || EXPENSE_CATEGORIES)].map(c => <option key={c}>{c}</option>)}
                </select>
                <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ padding: "7px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontFamily: "inherit", fontSize: 13 }}>
                  {["Tous", ...allMonths].map(m => <option key={m} value={m}>{m === "Tous" ? "Tous les mois" : m}</option>)}
                </select>
                <button onClick={() => setShowCatManager(true)} style={{ padding: "7px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#f8f9fa", color: "#666", fontWeight: 700, fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>⚙️ Gérer</button>
                <span style={{ fontSize: 13, color: "#666", fontWeight: 700 }}>Total : <span style={{ color: "#ef4444" }}>{totalFiltered.toFixed(2)} €</span></span>
              </div>
              <Btn variant="primary" size="sm" onClick={openAdd}><span style={{ width: 14, height: 14 }}>{I.plus}</span> Ajouter</Btn>
            </div>
          </Card>
          <Card style={{ padding: 0, overflow: "hidden" }}>
           <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#f8f9fa" }}>{["Date", "Libellé", "Catégorie", "Article lié", "Fournisseur", "Paiement", "Montant", ""].map(h => <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 800, color: "#999", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
              <tbody>
                {filtered.length === 0 ? <tr><td colSpan={8} style={{ textAlign: "center", padding: 40, color: "#999" }}>Aucune dépense</td></tr> : filtered.map((exp, idx) => {
                  const linked = stock.find(s => s.id === exp.linkedItemId);
                  return (
                    <tr key={exp.id} style={{ borderTop: "1px solid #f0f0f0", background: idx % 2 === 0 ? "#fff" : "#fafafa" }}>
                      <td style={{ padding: "12px 16px", fontSize: 13, color: "#666", whiteSpace: "nowrap" }}>{exp.date}</td>
                      <td style={{ padding: "12px 16px" }}><div style={{ fontWeight: 700 }}>{exp.label}</div>{exp.notes && <div style={{ fontSize: 11, color: "#999" }}>{exp.notes}</div>}</td>
                      <td style={{ padding: "12px 16px" }}><span style={{ background: (CAT_COLORS[exp.category] || "#999") + "22", color: CAT_COLORS[exp.category] || "#999", borderRadius: 8, padding: "2px 10px", fontSize: 12, fontWeight: 700 }}>{exp.category}</span></td>
                      <td style={{ padding: "12px 16px", fontSize: 12 }}>{linked ? <span style={{ background: "#f0f4ff", color: "#3b82f6", borderRadius: 8, padding: "2px 8px", fontWeight: 700 }}>{linked.icon} {linked.name}{exp.linkedQty > 0 ? ` ×${exp.linkedQty}` : ""}</span> : <span style={{ color: "#ccc" }}>—</span>}</td>
                      <td style={{ padding: "12px 16px", fontSize: 13 }}>{exp.supplier || "—"}</td>
                      <td style={{ padding: "12px 16px", fontSize: 13 }}>{exp.paymentMethod}</td>
                      <td style={{ padding: "12px 16px" }}><span style={{ fontWeight: 900, fontSize: 15, color: "#ef4444" }}>{(parseFloat(exp.amount) || 0).toFixed(2)} €</span></td>
                      <td style={{ padding: "12px 16px" }}><div style={{ display: "flex", gap: 6 }}><Btn variant="secondary" size="sm" onClick={() => openEdit(exp)}><span style={{ width: 13, height: 13 }}>{I.edit}</span></Btn><Btn variant="danger" size="sm" onClick={async () => { if (await askConfirm("Supprimer ?")) setExpenses(prev => prev.filter(e => e.id !== exp.id), true); }}><span style={{ width: 13, height: 13 }}>{I.trash}</span></Btn></div></td>
                    </tr>
                  );
                })}
              </tbody>
              {filtered.length > 0 && <tfoot><tr style={{ background: "#f0f4ff", borderTop: "2px solid #e5e7eb" }}><td colSpan={6} style={{ padding: "12px 16px", fontWeight: 800 }}>TOTAL ({filtered.length} transactions)</td><td style={{ padding: "12px 16px", fontWeight: 900, fontSize: 17, color: "#ef4444" }}>{totalFiltered.toFixed(2)} €</td><td /></tr></tfoot>}
            </table>
           </div>
          </Card>
        </div>
      )}

      {/* ── REVENUS ── */}
      {activeTab === "revenus" && (
        <>
        {/* Synthèse par moyen de paiement */}
        <Card style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 12 }}>💳 Acomptes encaissés par canal</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { key: "paypal", label: "💙 PayPal" }, { key: "virement", label: "🏦 Virement" },
              { key: "especes", label: "💵 Espèces" }, { key: "cheque", label: "📄 Chèque" }, { key: "cb", label: "💳 CB" },
            ].map(({ key, label }) => {
              const total = orders.reduce((s, o) => o.acompteMoyen === key ? s + (parseFloat(o.acompte) || 0) : s, 0);
              const count = orders.filter(o => o.acompteMoyen === key && (parseFloat(o.acompte) || 0) > 0).length;
              if (total === 0) return null;
              return (
                <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "#f8f9fa", borderRadius: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
                  <span style={{ fontSize: 13 }}><strong>{total.toFixed(2)} €</strong> <span style={{ color: "#999", fontSize: 11 }}>({count} commande{count > 1 ? "s" : ""})</span></span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card style={{ padding: 0, overflow: "hidden" }}>
         <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "100%", minWidth: 620, borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#f8f9fa" }}>{["N° Commande", "Client", "Date", "Statut", "Acompte", "Canal", "Total", "Reste"].map(h => <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 800, color: "#999", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>
              {[...orders].sort((a, b) => (b.deliveryDate || "").localeCompare(a.deliveryDate || "")).map((o, idx) => {
                const t = orderTotal(o, settings); const a = parseFloat(o.acompte || 0); const r = t - a;
                const MOYEN = { paypal: "💙 PayPal", virement: "🏦 Virement", especes: "💵 Espèces", cheque: "📄 Chèque", cb: "💳 CB" };
                return (
                  <tr key={o.id} style={{ borderTop: "1px solid #f0f0f0", background: idx % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 12, color: "#666" }}>{o.id}</td>
                    <td style={{ padding: "12px 16px", fontWeight: 700 }}>{o.clientName}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#666" }}>{fmtD(o.deliveryDate) || "—"}</td>
                    <td style={{ padding: "12px 16px" }}><Badge status={o.status} /></td>
                    <td style={{ padding: "12px 16px", fontWeight: 700, color: "#3b82f6" }}>{a.toFixed(2)} €</td>
                    <td style={{ padding: "12px 16px", fontSize: 12 }}>{o.acompteMoyen ? MOYEN[o.acompteMoyen] || o.acompteMoyen : "—"}</td>
                    <td style={{ padding: "12px 16px", fontWeight: 900, fontSize: 15 }}>{t.toFixed(2)} €</td>
                    <td style={{ padding: "12px 16px" }}><span style={{ fontWeight: 800, color: r > 0 ? "#f59e0b" : "#10b981" }}>{r <= 0 ? "✓ Soldé" : r.toFixed(2) + " €"}</span></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr style={{ background: "#f0fdf4", borderTop: "2px solid #d1fae5" }}>
              <td colSpan={4} style={{ padding: "12px 16px", fontWeight: 800 }}>TOTAL ({orders.length} commandes)</td>
              <td style={{ padding: "12px 16px", fontWeight: 800, color: "#3b82f6" }}>{totalAcomptes.toFixed(2)} €</td>
              <td />
              <td style={{ padding: "12px 16px", fontWeight: 900, fontSize: 17, color: "#10b981" }}>{orders.reduce((s, o) => s + orderTotal(o, settings), 0).toFixed(2)} €</td>
              <td style={{ padding: "12px 16px", fontWeight: 800, color: "#f59e0b" }}>{orders.reduce((s, o) => s + orderTotal(o, settings) - parseFloat(o.acompte || 0), 0).toFixed(2)} €</td>
            </tr></tfoot>
          </table>
         </div>
        </Card>
        </>
      )}

      {/* Modal gestion des catégories */}
      <Modal open={showCatManager} onClose={() => setShowCatManager(false)} title="⚙️ Gérer les catégories">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(expenseCategories || EXPENSE_CATEGORIES).map((cat, idx) => (
            <div key={cat} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", background: "#f8f9fa", borderRadius: 10 }}>
              <input
                value={cat}
                onChange={e => {
                  const newName = e.target.value;
                  const updated = [...(expenseCategories || EXPENSE_CATEGORIES)];
                  updated[idx] = newName;
                  setExpenseCategories(updated);
                }}
                onBlur={e => {
                  // Si la catégorie a été renommée, on met aussi à jour les dépenses existantes qui l'utilisaient.
                  const newName = e.target.value.trim();
                  if (!newName || newName === cat) return;
                  setExpenses(prev => prev.map(exp => exp.category === cat ? { ...exp, category: newName } : exp));
                }}
                style={{ flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 16, fontFamily: "inherit", background: "#fff", color: "#1a1a2e" }}
              />
              <button onClick={async () => {
                const cats = expenseCategories || EXPENSE_CATEGORIES;
                if (cats.length <= 1) { alert("Il faut au moins une catégorie."); return; }
                const nbUsed = expenses.filter(e => e.category === cat).length;
                const msg = nbUsed > 0
                  ? `${nbUsed} dépense(s) utilisent "${cat}". Les basculer vers "Autre" et supprimer cette catégorie ?`
                  : `Supprimer la catégorie "${cat}" ?`;
                if (!(await askConfirm(msg))) return;
                if (nbUsed > 0) setExpenses(prev => prev.map(e => e.category === cat ? { ...e, category: "Autre" } : e));
                setExpenseCategories(cats.filter(c => c !== cat), true);
              }} style={{ padding: "8px 12px", borderRadius: 8, border: "1.5px solid #fecaca", background: "#fef2f2", color: "#dc2626", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>🗑️</button>
            </div>
          ))}
          <button onClick={() => {
            const name = prompt("Nom de la nouvelle catégorie :");
            if (!name || !name.trim()) return;
            const trimmed = name.trim();
            const cats = expenseCategories || EXPENSE_CATEGORIES;
            if (cats.includes(trimmed)) { alert("Cette catégorie existe déjà."); return; }
            setExpenseCategories([...cats, trimmed]);
          }} style={{ marginTop: 4, background: "none", border: "1.5px dashed #d1d5db", borderRadius: 10, padding: "10px 14px", color: "#6b7280", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700 }}>
            + Ajouter une catégorie
          </button>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <Btn variant="primary" onClick={() => setShowCatManager(false)}>Terminé</Btn>
          </div>
        </div>
      </Modal>

      {/* Modal dépense */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={editExp ? "Modifier la dépense" : "Nouvelle dépense"}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Inp label="Date" type="date" value={form.date} onChange={v => setF("date", v)} required />
            {/* Catégorie avec gestion inline */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.05em" }}>Catégorie</label>
              <div style={{ display: "flex", gap: 6 }}>
                <select value={form.category} onChange={e => setF("category", e.target.value)} style={{ flex: 1, padding: "10px 10px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 16, fontFamily: "inherit", background: "#fafafa", color: "#1a1a2e" }}>
                  {(expenseCategories || EXPENSE_CATEGORIES).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <button onClick={() => {
                  const name = prompt("Nom de la nouvelle catégorie :");
                  if (!name || !name.trim()) return;
                  const trimmed = name.trim();
                  if ((expenseCategories || EXPENSE_CATEGORIES).includes(trimmed)) { alert("Cette catégorie existe déjà."); return; }
                  const updated = [...(expenseCategories || EXPENSE_CATEGORIES), trimmed];
                  setExpenseCategories(updated);
                  setF("category", trimmed);
                }} style={{ padding: "10px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#f0fdf4", color: "#15803d", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: 16, flexShrink: 0 }} title="Ajouter une catégorie">+</button>
                <button onClick={async () => {
                  const cats = expenseCategories || EXPENSE_CATEGORIES;
                  if (cats.length <= 1) { alert("Il faut au moins une catégorie."); return; }
                  if (!(await askConfirm(`Supprimer la catégorie "${form.category}" ?`))) return;
                  const updated = cats.filter(c => c !== form.category);
                  setExpenseCategories(updated);
                  setF("category", updated[0] || "");
                }} style={{ padding: "10px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#fef2f2", color: "#dc2626", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: 16, flexShrink: 0 }} title="Supprimer cette catégorie">−</button>
              </div>
            </div>
          </div>
          <Inp label="Libellé" value={form.label} onChange={v => setF("label", v)} placeholder="Ex: Achat 20 tables rondes" required />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Inp label="Montant (€)" type="number" value={form.amount} onChange={v => setF("amount", v)} min="0" step="0.01" required />
            <Sel label="Paiement" value={form.paymentMethod} onChange={v => setF("paymentMethod", v)} options={["CB", "Espèces", "Virement", "Chèque"].map(m => ({ value: m, label: m }))} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Sel label="Article lié (pour rentabilité)" value={form.linkedItemId} onChange={v => setF("linkedItemId", v)} options={[{ value: "", label: "— Aucun —" }, ...stock.map(s => ({ value: s.id, label: `${s.icon} ${s.name}` }))]} />
            <Inp label="Quantité achetée" type="number" value={form.linkedQty} onChange={v => setF("linkedQty", v)} min="0" />
          </div>
          <Inp label="Fournisseur" value={form.supplier} onChange={v => setF("supplier", v)} placeholder="Nom du fournisseur" />
          <Inp label="Notes" value={form.notes} onChange={v => setF("notes", v)} placeholder="Notes complémentaires..." />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="secondary" onClick={() => setShowForm(false)}>Annuler</Btn>
            <Btn variant="primary" onClick={saveExp}><span style={{ width: 16, height: 16 }}>{I.check}</span> Enregistrer</Btn>
          </div>
        </div>
      </Modal>

      <Modal open={showRecForm} onClose={() => setShowRecForm(false)} title={editRec ? "Modifier la dépense récurrente" : "Nouvelle dépense récurrente"}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Inp label="Libellé" value={recForm.label} onChange={v => setRF("label", v)} placeholder="Ex: Loyer entrepôt, Box internet, Forfait téléphone..." required />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Sel label="Catégorie" value={recForm.category} onChange={v => setRF("category", v)} options={(expenseCategories || EXPENSE_CATEGORIES).map(c => ({ value: c, label: c }))} />
            <Inp label="Montant (€) / mois" type="number" value={recForm.amount} onChange={v => setRF("amount", v)} min="0" step="0.01" required />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Inp label="Jour du mois (1-28)" type="number" value={recForm.dayOfMonth} onChange={v => setRF("dayOfMonth", v)} min="1" max="28" />
            <Sel label="Moyen de paiement" value={recForm.paymentMethod} onChange={v => setRF("paymentMethod", v)} options={["Prélèvement", "CB", "Virement", "Espèces", "Chèque"].map(m => ({ value: m, label: m }))} />
          </div>
          <Inp label="Fournisseur" value={recForm.supplier} onChange={v => setRF("supplier", v)} placeholder="Ex: EDF, Orange, Bailleur..." />
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={recForm.active !== false} onChange={e => setRF("active", e.target.checked)} style={{ width: 18, height: 18 }} />
            <span style={{ fontSize: 14, fontWeight: 700 }}>Active (génère une dépense chaque mois)</span>
          </label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="secondary" onClick={() => setShowRecForm(false)}>Annuler</Btn>
            <Btn variant="primary" onClick={saveRec}><span style={{ width: 16, height: 16 }}>{I.check}</span> Enregistrer</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
function RetourCasse({ order, stock, onSave, onClose, settings }) {
  const [askConfirm, ConfirmUI] = useConfirm();
  // Pour chaque article : qty rendue OK, qty cassée/perdue
  const [retours, setRetours] = useState(() =>
    order.items.map(item => ({
      id: item.id,
      name: item.name,
      icon: item.icon,
      price: item.price,
      qtyCommande: item.qty,
      qtyRendue: item.qty,
      qtyCasse: 0,
      prixAchat: stock.find(s => s.id === item.id)?.coutAchat || 0,
      prixCasseCustom: null, // si défini, remplace le prix calculé automatiquement
    }))
  );
  const [margePercent, setMargePercent] = useState((settings && settings.casseMargePercent) || 30);
  const [confirmed, setConfirmed] = useState(false);
  const [showDeliveryRecap, setShowDeliveryRecap] = useState(false);

  const setR = (id, field, value) => {
    setRetours(prev => prev.map(r => {
      if (r.id !== id) return r;
      // Valeur bornée entre 0 et la quantité louée
      const val = Math.max(0, Math.min(parseInt(value) || 0, r.qtyCommande));
      const updated = { ...r, [field]: val };
      // Auto-ajuster : rendue + cassée <= commandée
      if (field === "qtyRendue") updated.qtyCasse = Math.max(0, Math.min(updated.qtyCasse, updated.qtyCommande - updated.qtyRendue));
      if (field === "qtyCasse") updated.qtyRendue = Math.max(0, Math.min(updated.qtyRendue, updated.qtyCommande - updated.qtyCasse));
      return updated;
    }));
  };

  // Prix unitaire de casse : custom si défini, sinon prix achat + marge arrondi à l'euro
  const prixUnitDe = (r) => r.prixCasseCustom != null ? r.prixCasseCustom : (r.prixAchat > 0 ? Math.ceil(r.prixAchat * (1 + margePercent / 100)) : 0);
  const setPrixCasse = (id, value) => {
    const v = value === "" ? null : Math.max(0, parseFloat(String(value).replace(",", ".")) || 0);
    setRetours(prev => prev.map(r => r.id === id ? { ...r, prixCasseCustom: v } : r));
  };

  const totalCasse = retours.reduce((s, r) => {
    if (r.qtyCasse === 0) return s;
    return s + r.qtyCasse * prixUnitDe(r);
  }, 0);

  const hasCasse = retours.some(r => r.qtyCasse > 0);
  const allRendu = retours.every(r => r.qtyRendue + r.qtyCasse === r.qtyCommande);

  // Caution : selon le moyen, soit juste informatif (chèque/espèces gérés physiquement hors app),
  // soit un vrai calcul de remboursement net (virement/PayPal réellement encaissés).
  const cautionMontant = cautionCost(order, stock);
  const cautionMoyen = order.cautionMoyen || "";
  const cautionEncaisseeReellement = ["virement", "paypal"].includes(cautionMoyen);
  const cautionARembourser = cautionEncaisseeReellement ? Math.max(0, cautionMontant - totalCasse) : null;
  const cautionAbsorbeeParCasse = cautionEncaisseeReellement ? Math.min(cautionMontant, totalCasse) : 0;
  const casseRestantApresCaution = cautionEncaisseeReellement ? Math.max(0, totalCasse - cautionMontant) : totalCasse;

  const MOYEN_LABELS = { paypal: "💙 PayPal", virement: "🏦 Virement", especes: "💵 Espèces", cheque: "📄 Chèque", cb: "💳 CB" };
  const CAUTION_MOYEN_LABELS = { cheque: "Chèque", especes: "Espèces", virement: "Virement", paypal: "PayPal", cb: "CB" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #1a1a2e, #16213e)", color: "#fff", borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>RETOUR DE COMMANDE</div>
        <div style={{ fontSize: 18, fontWeight: 900 }}>{order.id} — {order.clientName}</div>
        <div style={{ opacity: 0.7, fontSize: 13, marginTop: 4 }}>
          {order.items.length} article(s) · Total loué : {retours.reduce((s, r) => s + r.qtyCommande, 0)} unités
        </div>
      </div>

      {order.deliverySignature && (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
          <div onClick={() => setShowDeliveryRecap(s => !s)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", background: "#eff6ff", cursor: "pointer" }}>
            <span style={{ fontSize: 18 }}>🚚</span>
            <span style={{ flex: 1, fontWeight: 800, fontSize: 13, color: "#1e40af" }}>État constaté à la livraison/retrait</span>
            <span style={{ fontSize: 12, color: "#1e40af", transform: showDeliveryRecap ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▼</span>
          </div>
          {showDeliveryRecap && (
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              {(order.etageActive || order.miseEnPlaceActive) && (
                <div style={{ background: "#f8f9fa", borderRadius: 8, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
                  {order.etageActive && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#444" }}><span>🪜 Monter à l'étage ({order.etageNbEtages || 1})</span><span style={{ fontWeight: 700 }}>{(parseFloat(order.etagePrice) || 0).toFixed(2)} €</span></div>}
                  {order.miseEnPlaceActive && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#444" }}><span>🛠️ Mise en place</span><span style={{ fontWeight: 700 }}>{(parseFloat(order.miseEnPlacePrice) || 0).toFixed(2)} €</span></div>}
                </div>
              )}
              <div style={{ fontSize: 12, color: "#666" }}>✅ Signé par {order.deliverySignedBy} {order.deliverySignedAt && `· ${new Date(order.deliverySignedAt).toLocaleString("fr-FR")}`}</div>
              {order.deliveryComment && <div style={{ fontSize: 13, color: "#444", background: "#f8f9fa", borderRadius: 8, padding: "8px 12px" }}>💬 {order.deliveryComment}</div>}
              {order.deliveryPhotos && order.deliveryPhotos.length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {order.deliveryPhotos.map((url, i) => <a key={i} href={url} target="_blank" rel="noreferrer"><img src={url} style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover" }} /></a>)}
                </div>
              )}
              <img src={order.deliverySignature} style={{ maxHeight: 60, maxWidth: 180, background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb" }} />
            </div>
          )}
        </div>
      )}

      {confirmed ? (
        <div style={{ textAlign: "center", padding: 30 }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>✅</div>
          <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 8 }}>Retour enregistré</div>
          {hasCasse && (
            <div style={{ background: "#fee2e2", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 800, color: "#dc2626", fontSize: 16 }}>🔴 Casse à facturer : {totalCasse} €</div>
              <div style={{ fontSize: 13, color: "#7f1d1d", marginTop: 4 }}>Prix achat + {margePercent}% arrondi à l'euro supérieur</div>
            </div>
          )}
          <div style={{ fontSize: 13, color: "#666" }}>Le stock a été mis à jour automatiquement.</div>
          <Btn variant="secondary" onClick={onClose} style={{ marginTop: 16 }}>Fermer</Btn>
        </div>
      ) : (
        <>
          {/* Info marge casse (réglable dans Réglages → Divers) */}
          <div style={{ background: "#fff7ed", borderRadius: 10, padding: "8px 12px", fontSize: 12, color: "#92400e" }}>
            ⚙️ Prix de casse = prix d'achat + {margePercent}% (modifiable dans Réglages). Touchez un prix pour l'ajuster manuellement.
          </div>

          {/* Liste retour article par article (format mobile) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {retours.map(r => {
              const prixUnitCasse = prixUnitDe(r);
              const totalLigne = r.qtyCasse * prixUnitCasse;
              const manquant = r.qtyCommande - r.qtyRendue - r.qtyCasse;
              const statusColor = r.qtyCasse > 0 ? "#fee2e2" : manquant > 0 ? "#fef9c3" : "#f0fdf4";
              const statusBorder = r.qtyCasse > 0 ? "#fca5a5" : manquant > 0 ? "#fde68a" : "#bbf7d0";

              return (
                <div key={r.id} style={{ background: statusColor, border: `2px solid ${statusBorder}`, borderRadius: 12, padding: 14 }}>
                  {/* Nom de l'article */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{r.icon} {r.name}</div>
                    <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                      Loué : <strong>{r.qtyCommande}</strong> unité(s)
                    </div>
                    {/* Prix de casse modifiable */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                      <span style={{ fontSize: 12, color: "#92400e", fontWeight: 700 }}>Prix casse /u :</span>
                      <input type="text" inputMode="decimal"
                        value={prixUnitCasse === 0 ? "" : String(prixUnitCasse)}
                        placeholder="0"
                        onChange={e => setPrixCasse(r.id, e.target.value)}
                        onFocus={e => e.target.select()}
                        style={{ width: 70, padding: "4px 8px", borderRadius: 8, border: "1.5px solid #f59e0b", background: "#fff", fontWeight: 800, fontSize: 16, textAlign: "center", fontFamily: "inherit", outline: "none" }} />
                      <span style={{ fontSize: 12, color: "#92400e", fontWeight: 700 }}>€</span>
                      {r.prixCasseCustom != null && <button onClick={() => setPrixCasse(r.id, "")} style={{ background: "none", border: "none", color: "#3b82f6", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>↺ auto</button>}
                    </div>
                  </div>
                  {/* Champs Rendu / Cassé en colonne (pleine largeur sur mobile) */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ background: "#fff", borderRadius: 10, padding: "10px 12px", border: "2px solid #10b981" }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: "#10b981", textTransform: "uppercase", marginBottom: 6 }}>Rendu ✓</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button onClick={() => setR(r.id, "qtyRendue", r.qtyRendue - 1)} style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 10, border: "none", background: "#dcfce7", color: "#10b981", fontWeight: 900, fontSize: 22, cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }}>−</button>
                        <input type="text" inputMode="numeric"
                          value={r.qtyRendue === 0 ? "" : String(r.qtyRendue)}
                          placeholder="0"
                          onChange={e => setR(r.id, "qtyRendue", e.target.value)}
                          onFocus={e => e.target.select()}
                          style={{ flex: 1, minWidth: 0, padding: "8px", borderRadius: 8, border: "none", background: "#f0fdf4", fontWeight: 900, fontSize: 22, textAlign: "center", fontFamily: "inherit", outline: "none" }} />
                        <button onClick={() => setR(r.id, "qtyRendue", r.qtyRendue + 1)} style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 10, border: "none", background: "#dcfce7", color: "#10b981", fontWeight: 900, fontSize: 22, cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }}>+</button>
                      </div>
                    </div>
                    <div style={{ background: "#fff", borderRadius: 10, padding: "10px 12px", border: "2px solid #ef4444" }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: "#ef4444", textTransform: "uppercase", marginBottom: 6 }}>Cassé 💔</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button onClick={() => setR(r.id, "qtyCasse", r.qtyCasse - 1)} style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 10, border: "none", background: "#fee2e2", color: "#ef4444", fontWeight: 900, fontSize: 22, cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }}>−</button>
                        <input type="text" inputMode="numeric"
                          value={r.qtyCasse === 0 ? "" : String(r.qtyCasse)}
                          placeholder="0"
                          onChange={e => setR(r.id, "qtyCasse", e.target.value)}
                          onFocus={e => e.target.select()}
                          style={{ flex: 1, minWidth: 0, padding: "8px", borderRadius: 8, border: "none", background: "#fee2e2", fontWeight: 900, fontSize: 22, textAlign: "center", fontFamily: "inherit", outline: "none" }} />
                        <button onClick={() => setR(r.id, "qtyCasse", r.qtyCasse + 1)} style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 10, border: "none", background: "#fee2e2", color: "#ef4444", fontWeight: 900, fontSize: 22, cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }}>+</button>
                      </div>
                    </div>
                  </div>
                  {/* Ligne facturé */}
                  <div style={{ textAlign: "right", marginTop: 8, fontWeight: 900, fontSize: 15, color: totalLigne > 0 ? "#dc2626" : "#10b981" }}>
                    {totalLigne > 0 ? `Facturé : ${totalLigne} €` : r.qtyRendue === r.qtyCommande ? "✓ Tout rendu" : ""}
                  </div>
                  {manquant > 0 && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#92400e", fontWeight: 700 }}>
                      ⚠️ {manquant} unité(s) non comptabilisée(s) — vérifiez les quantités
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Récap casse */}
          {hasCasse && (
            <div style={{ background: "#fee2e2", border: "2px solid #fca5a5", borderRadius: 14, padding: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: "#dc2626", marginBottom: 12 }}>🔴 Récapitulatif casse</div>
              {retours.filter(r => r.qtyCasse > 0).map(r => {
                const pu = Math.ceil(r.prixAchat * (1 + margePercent / 100));
                return (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                    <span>{r.icon} {r.name} × {r.qtyCasse} ({r.prixAchat.toFixed(2)} € × {1 + margePercent / 100} = {pu} €/u)</span>
                    <span style={{ fontWeight: 800 }}>{r.qtyCasse * pu} €</span>
                  </div>
                );
              })}
              <div style={{ borderTop: "1.5px solid #fca5a5", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: 18, color: "#dc2626" }}>
                <span>TOTAL À FACTURER</span>
                <span>{totalCasse} €</span>
              </div>
            </div>
          )}

          {/* Caution */}
          {cautionMontant > 0 && (
            <div style={{ background: "#f5f3ff", border: "2px solid #ddd6fe", borderRadius: 14, padding: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: "#6d28d9", marginBottom: 8 }}>🔒 Caution — {CAUTION_MOYEN_LABELS[cautionMoyen] || "moyen non précisé"}</div>
              {!cautionEncaisseeReellement ? (
                <div style={{ fontSize: 13, color: "#7c3aed" }}>
                  Caution de <strong>{cautionMontant.toFixed(2)} €</strong> à conserver physiquement.
                  {hasCasse
                    ? ` Vous pouvez l'utiliser pour couvrir la casse (${totalCasse.toFixed(2)} €) et rendre le reste, ou la rendre intégralement et facturer la casse séparément — à votre choix.`
                    : " Aucune casse : à rendre intégralement au client (chèque détruit ou espèces restituées)."}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#5b21b6" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>Caution encaissée</span><span style={{ fontWeight: 800 }}>{cautionMontant.toFixed(2)} €</span></div>
                  {hasCasse && <div style={{ display: "flex", justifyContent: "space-between", color: "#dc2626" }}><span>− Casse couverte par la caution</span><span style={{ fontWeight: 800 }}>− {cautionAbsorbeeParCasse.toFixed(2)} €</span></div>}
                  <div style={{ borderTop: "1.5px solid #ddd6fe", marginTop: 4, paddingTop: 6, display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: 16, color: "#6d28d9" }}>
                    <span>À rembourser au client</span><span>{cautionARembourser.toFixed(2)} €</span>
                  </div>
                  {casseRestantApresCaution > 0 && (
                    <div style={{ background: "#fee2e2", borderRadius: 8, padding: "8px 12px", color: "#dc2626", fontWeight: 700, marginTop: 4 }}>
                      ⚠️ La casse ({totalCasse.toFixed(2)} €) dépasse la caution : il reste {casseRestantApresCaution.toFixed(2)} € à facturer séparément au client.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Notes + signature : remplacé par BonCapture (commentaire + photos + signature client
              obligatoire avant de pouvoir valider le retour). */}
          {!allRendu && (
            <div style={{ background: "#fef9c3", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#92400e", fontWeight: 600 }}>
              ⚠️ Vérifiez que rendu + cassé = quantité commandée pour chaque article avant de valider.
            </div>
          )}

          <div style={{ borderTop: "1.5px solid #f0f0f0", paddingTop: 16 }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 800 }}>✍️ Confirmation du retour</h3>
            <BonCapture
              orderId={order.id}
              kind="retour"
              confirmLabel={hasCasse ? `✅ Valider retour + facturer ${totalCasse} €` : "✅ Valider le retour"}
              onConfirm={async (data) => {
                const result = {
                  orderId: order.id,
                  date: new Date().toISOString().split("T")[0],
                  retours, margePercent, totalCasse,
                  notes: data.comment, photos: data.photos, signature: data.signature,
                  signedBy: data.signedBy, signedAt: data.signedAt,
                };
                onSave(result);
                setConfirmed(true);
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Btn variant="secondary" onClick={onClose}>Annuler</Btn>
          </div>
        </>
      )}
      {ConfirmUI}
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────


// ─── INTERFACE LIVREUR (livraisons du jour) ──────────────────────────────────
function DeliveryInterface({ orders, stock, settings, onShare, onConfirmDelivery, onRetour, onEncaisser, onDeletePhoto }) {
  const [askConfirm, ConfirmUI] = useConfirm();
  const [signingOrder, setSigningOrder] = useState(null); // commande en cours de signature de livraison
  const [selected, setSelected] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [sousTab, setSousTab] = useState("livraison");

  // Commandes confirmées uniquement (tout sauf brouillon, devis et clôturée)
  const confirmed = orders.filter(o => !["Brouillon", "Devis", "Clôturée"].includes(o.status));
  // À traiter : phase livraison (les récupérations se gèrent dans le menu Retours).
  const aTraiter = confirmed.filter(o => o.phase !== "retour" && o.phase !== "termine")
    .sort((a, b) => (a.deliveryDate || "").localeCompare(b.deliveryDate || ""));
  // Séparation Livraison (déplacement chez le client) / Retrait (client vient à l'entrepôt)
  const aLivrer = aTraiter.filter(o => o.deliveryMode === "livraison");
  const aRetirer = aTraiter.filter(o => o.deliveryMode !== "livraison");
  const listeAffichee = sousTab === "livraison" ? aLivrer : aRetirer;

  const copyFiche = (order) => {
    const total = orderTotal(order, settings);
    const reste = total - parseFloat(order.acompte || 0);
    const text = `${order.deliveryMode === "livraison" ? "🚚 LIVRAISON" : "🏠 RETRAIT"} — ${order.id}\n\n👤 ${order.clientName}\n📞 ${order.clientPhone || "N/A"}\n📍 ${order.address || "Entrepôt"}\n📅 ${fmtD(order.deliveryDate) || ""}${order.deliveryTime ? " à " + order.deliveryTime : ""}\n\n📦 MATÉRIEL :\n${(order.items||[]).map(i => `• ${i.name} × ${i.qty}`).join("\n")}\n\n💶 Total : ${total.toFixed(2)} €\n💳 À encaisser : ${reste.toFixed(2)} €`;
    navigator.clipboard.writeText(text).then(() => { setCopiedId(order.id); setTimeout(() => setCopiedId(null), 2000); });
  };

  const OrderCard = ({ order }) => {
    const total = orderTotal(order, settings);
    const reste = total - parseFloat(order.acompte || 0);
    const dateAff = order.deliveryDate;
    const timeAff = order.deliveryTime;
    const isToday = dateAff === TODAY;
    return (
      <Card style={{ marginBottom: 10, borderLeft: `4px solid #3b82f6` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div><div style={{ fontSize: 16, fontWeight: 800 }}>{order.clientName}</div><div style={{ fontSize: 11, color: "#999", fontFamily: "monospace" }}>{order.id}</div></div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <Badge status={order.status} />
            {isToday && <span style={{ fontSize: 10, fontWeight: 800, background: "#fee2e2", color: "#b91c1c", borderRadius: 6, padding: "1px 8px" }}>AUJOURD'HUI</span>}
          </div>
        </div>
        <div style={{ fontSize: 13, color: "#3b82f6", fontWeight: 700, marginBottom: 6 }}>
          {order.deliveryMode === "livraison" ? "🚚 À livrer" : "🏠 Retrait entrepôt"} : {fmtD(dateAff) || "—"}{timeAff ? ` à ${timeAff}` : ""}
        </div>
        {order.address && order.deliveryMode === "livraison" && <div style={{ fontSize: 13, color: "#555", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 14, flexShrink: 0 }}>{I.location}</span> {order.address}</div>}
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, background: reste > 0 ? "#fff7ed" : "#f0fdf4", color: reste > 0 ? "#c2410c" : "#065f46", borderRadius: 8, padding: "2px 10px", fontWeight: 700 }}>{reste > 0 ? `À encaisser : ${reste.toFixed(2)} €` : "✓ Soldé"}</span>
          <span style={{ fontSize: 12, background: "#f4f4f8", color: "#666", borderRadius: 8, padding: "2px 10px" }}>{(order.items||[]).length} article(s)</span>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <Btn variant="secondary" size="sm" onClick={() => setSelected(order)} style={{ flex: 1 }}><span style={{ width: 14, height: 14 }}>{I.eye}</span> Voir fiche</Btn>
          <Btn variant={copiedId === order.id ? "success" : "primary"} size="sm" onClick={() => copyFiche(order)} style={{ flex: 1 }}><span style={{ width: 14, height: 14 }}>{copiedId === order.id ? I.check : I.copy}</span>{copiedId === order.id ? "Copié !" : "Copier"}</Btn>
        </div>
        <Btn variant="primary" size="sm" onClick={() => setSigningOrder(order)} style={{ width: "100%" }}>✅ Marquer comme {order.deliveryMode === "livraison" ? "livré" : "retiré"}</Btn>
      </Card>
    );
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <div style={{ background: "linear-gradient(135deg, #1a1a2e, #0f3460)", color: "#fff", borderRadius: 20, padding: 24, marginBottom: 16, display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: 40 }}>🚚</span>
        <div><div style={{ fontSize: 22, fontWeight: 900 }}>Livraison / Retrait</div><div style={{ opacity: 0.7, fontSize: 13 }}>{new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} · {aTraiter.length} à traiter</div></div>
      </div>

      {/* Sous-onglets Livraison / Retrait */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setSousTab("livraison")} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 14, fontFamily: "inherit", background: sousTab === "livraison" ? "#3b82f6" : "#f0f0f3", color: sousTab === "livraison" ? "#fff" : "#666" }}>
          🚚 Livraison ({aLivrer.length})
        </button>
        <button onClick={() => setSousTab("retrait")} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 14, fontFamily: "inherit", background: sousTab === "retrait" ? "#3b82f6" : "#f0f0f3", color: sousTab === "retrait" ? "#fff" : "#666" }}>
          🏪 Retrait ({aRetirer.length})
        </button>
      </div>

      {listeAffichee.length > 0 ? listeAffichee.map(o => <OrderCard key={o.id} order={o} />)
        : <div style={{ textAlign: "center", padding: 60, color: "#999" }}><div style={{ fontSize: 48, marginBottom: 12 }}>{sousTab === "livraison" ? "🚚" : "🏪"}</div><div style={{ fontWeight: 700 }}>Aucun{sousTab === "livraison" ? "e livraison" : " retrait"} à préparer</div><div style={{ fontSize: 13, marginTop: 6 }}>Les récupérations se gèrent dans le menu « Retours ».</div></div>}
      <Modal open={!!selected} onClose={() => setSelected(null)} title="Fiche de livraison" wide><DeliverySheet order={selected || {}} settings={settings} onShare={onShare} stock={stock} onEncaisser={onEncaisser} onDeletePhoto={onDeletePhoto} allOrders={orders} /></Modal>

      <Modal open={!!signingOrder} onClose={() => setSigningOrder(null)} title={signingOrder ? `✍️ Confirmer ${signingOrder.deliveryMode === "livraison" ? "la livraison" : "le retrait"} — ${signingOrder.clientName}` : ""}>
        {signingOrder && (
          <BonCapture
            orderId={signingOrder.id}
            kind="livraison"
            confirmLabel={`✅ Confirmer ${signingOrder.deliveryMode === "livraison" ? "la livraison" : "le retrait"}`}
            onConfirm={async (data) => { onConfirmDelivery(signingOrder.id, data); setSigningOrder(null); }}
          />
        )}
      </Modal>
      {ConfirmUI}
    </div>
  );
}

// ─── SECTION RETOURS (menu dédié) ────────────────────────────────────────────
// Pop-ups réutilisables pour choisir l'app de navigation et le moyen de contact.
// Utilisé dans les retours (camion et local) et ailleurs.
function NavChoiceModal({ open, address, onClose }) {
  const addr = encodeURIComponent(address || "");
  return (
    <Modal open={open} onClose={onClose} title="Ouvrir l'itinéraire dans…">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <a href={`waze://?q=${addr}&navigate=yes`} onClick={onClose} style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "#eff6ff", borderRadius: 12, textDecoration: "none", color: "#1e40af", fontWeight: 700 }}><span style={{ fontSize: 24 }}>🔵</span> Waze</a>
        <a href={`https://www.google.com/maps/dir/?api=1&destination=${addr}`} target="_blank" rel="noreferrer" onClick={onClose} style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "#fff7ed", borderRadius: 12, textDecoration: "none", color: "#c2410c", fontWeight: 700 }}><span style={{ fontSize: 24 }}>🗺️</span> Google Maps</a>
        <a href={`maps://maps.apple.com/?daddr=${addr}`} onClick={onClose} style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "#f0fdf4", borderRadius: 12, textDecoration: "none", color: "#065f46", fontWeight: 700 }}><span style={{ fontSize: 24 }}>🍎</span> Plans Apple</a>
      </div>
    </Modal>
  );
}
function PhoneChoiceModal({ open, phone, phones, onClose }) {
  // Liste de numéros normalisée : accepte soit un tableau `phones`, soit un seul `phone` (rétrocompatible).
  const list = (phones && phones.length ? phones : (phone ? [phone] : [])).filter(Boolean);
  const [selectedPhone, setSelectedPhone] = useState(null);
  // Réinitialise l'étape de sélection chaque fois que le modal se rouvre.
  useEffect(() => { if (open) setSelectedPhone(list.length === 1 ? list[0] : null); }, [open]);
  const close = () => { setSelectedPhone(null); onClose(); };
  const tel = (selectedPhone || "").replace(/\s/g, "");
  const wa = (selectedPhone || "").replace(/[^0-9]/g, "").replace(/^0/, "33");
  // Étape 1 : plusieurs numéros et aucun choisi encore → on demande lequel.
  if (list.length > 1 && !selectedPhone) {
    return (
      <Modal open={open} onClose={close} title="Quel numéro ?">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {list.map((p, i) => (
            <button key={i} onClick={() => setSelectedPhone(p)} style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "#f3f4f6", borderRadius: 12, border: "none", textAlign: "left", cursor: "pointer", fontWeight: 700, fontFamily: "inherit", fontSize: 15, color: "#1a1a2e" }}>
              <span style={{ fontSize: 22 }}>📞</span> {p}{i === 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#999", marginLeft: "auto" }}>Principal</span>}
            </button>
          ))}
        </div>
      </Modal>
    );
  }
  // Étape 2 : un seul numéro (ou déjà choisi) → choix de l'app de contact.
  return (
    <Modal open={open} onClose={close} title={list.length > 1 ? `Contacter — ${selectedPhone}` : "Contacter le client"}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {list.length > 1 && <button onClick={() => setSelectedPhone(null)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#3b82f6", fontWeight: 700, fontSize: 13, fontFamily: "inherit", cursor: "pointer", padding: 0, marginBottom: 4 }}>← Changer de numéro</button>}
        <a href={`tel:${tel}`} onClick={close} style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "#dbeafe", borderRadius: 12, textDecoration: "none", color: "#1e40af", fontWeight: 700 }}><span style={{ fontSize: 24 }}>📞</span> Appeler (téléphone)</a>
        <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" onClick={close} style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "#d1fae5", borderRadius: 12, textDecoration: "none", color: "#065f46", fontWeight: 700 }}><span style={{ fontSize: 24 }}>💬</span> Message WhatsApp</a>
        <a href={`https://wa.me/${wa}?call`} target="_blank" rel="noreferrer" onClick={close} style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "#dcfce7", borderRadius: 12, textDecoration: "none", color: "#15803d", fontWeight: 700 }}><span style={{ fontSize: 24 }}>📲</span> Ouvrir WhatsApp</a>
        <a href={`sms:${tel}`} onClick={close} style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "#f3f4f6", borderRadius: 12, textDecoration: "none", color: "#374151", fontWeight: 700 }}><span style={{ fontSize: 24 }}>✉️</span> SMS</a>
      </div>
    </Modal>
  );
}
function RetoursView({ orders, stock, settings, onRetour }) {
  const [selected, setSelected] = useState(null);
  const [sousTab, setSousTab] = useState("camion");
  const [navAddr, setNavAddr] = useState(null); // adresse pour pop-up navigation
  const [phoneNum, setPhoneNum] = useState(null); // numéro pour pop-up contact
  // Commandes en phase retour : livrées, en attente de contrôle
  const enRetour = orders.filter(o => o.phase === "retour" && o.status !== "Clôturée");
  // Camion : commandes livrées (mode livraison) → on va récupérer le matériel
  const retoursCamion = enRetour.filter(o => o.deliveryMode === "livraison");
  // Local : commandes en retrait → le client rapporte le matériel au local
  const retoursLocal = enRetour.filter(o => o.deliveryMode !== "livraison");
  const listeAffichee = sousTab === "camion" ? retoursCamion : retoursLocal;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ background: "linear-gradient(135deg, #c2410c, #ea580c)", color: "#fff", borderRadius: 20, padding: 24, display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: 40 }}>↩️</span>
        <div><div style={{ fontSize: 22, fontWeight: 900 }}>Retours & Contrôle</div><div style={{ opacity: 0.8, fontSize: 13 }}>Total à contrôler : {enRetour.length}</div></div>
      </div>

      {/* Sous-onglets Camion / Local */}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => setSousTab("camion")} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 14, fontFamily: "inherit", background: sousTab === "camion" ? "#c2410c" : "#f0f0f3", color: sousTab === "camion" ? "#fff" : "#666", position: "relative" }}>
          🚚 Retours camion ({retoursCamion.length})
        </button>
        <button onClick={() => setSousTab("local")} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 14, fontFamily: "inherit", background: sousTab === "local" ? "#c2410c" : "#f0f0f3", color: sousTab === "local" ? "#fff" : "#666", position: "relative" }}>
          🏪 Retours local ({retoursLocal.length})
        </button>
      </div>

      <div>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: "#c2410c", marginBottom: 12 }}>
          🔴 {sousTab === "camion" ? "À récupérer chez le client" : "Le client rapporte au local"} ({listeAffichee.length})
        </h3>
        {listeAffichee.length === 0 ? (
          <Card style={{ textAlign: "center", padding: 40, color: "#999" }}><div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>Aucun retour {sousTab === "camion" ? "camion" : "local"} à contrôler</Card>
        ) : listeAffichee.map(o => {
          const total = orderTotal(o, settings);
          return (
            <Card key={o.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div><div style={{ fontSize: 16, fontWeight: 800 }}>{o.clientName}</div><div style={{ fontSize: 11, color: "#999", fontFamily: "monospace" }}>{o.id}</div></div>
                <Badge status={o.status} />
              </div>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>↩️ Retour prévu : {fmtD(o.returnDate) || "—"}{o.returnTime ? ` à ${o.returnTime}` : ""}</div>
              {o.address && sousTab === "camion" && (
                <button onClick={() => setNavAddr(o.address)}
                  style={{ fontSize: 13, color: "#2563eb", marginBottom: 8, display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, textAlign: "left", padding: 0 }}>
                  <span style={{ width: 14, height: 14, flexShrink: 0 }}>{I.location}</span> {o.address} <span style={{ fontSize: 11, color: "#999" }}>↗ naviguer</span>
                </button>
              )}
              {o.clientPhone && (
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  {o.address && sousTab === "camion" && <button onClick={() => setNavAddr(o.address)} style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#c2410c", background: "#fff7ed", borderRadius: 8, padding: "8px", border: "none", cursor: "pointer", fontFamily: "inherit" }}>🧭 Naviguer</button>}
                  <button onClick={() => setPhoneNum(o)} style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#2563eb", background: "#eff6ff", borderRadius: 8, padding: "8px", border: "none", cursor: "pointer", fontFamily: "inherit" }}>📞 Contacter</button>
                </div>
              )}
              <div style={{ fontSize: 13, color: "#666", marginBottom: 10 }}>📦 {o.items.length} article(s) · {o.items.reduce((s, i) => s + i.qty, 0)} unités · Total {total.toFixed(2)} €</div>
              <Btn variant="warning" onClick={() => setSelected(o)} style={{ width: "100%", background: "#fff7ed", color: "#c2410c", border: "1.5px solid #fed7aa" }}>↩️ Contrôler le retour & casse</Btn>
            </Card>
          );
        })}
      </div>

      <NavChoiceModal open={!!navAddr} address={navAddr} onClose={() => setNavAddr(null)} />
      <PhoneChoiceModal open={!!phoneNum} phones={phoneNum?.clientPhones} phone={phoneNum?.clientPhone} onClose={() => setPhoneNum(null)} />

      <Modal open={!!selected} onClose={() => setSelected(null)} title="↩️ Contrôle retour & casse" wide>
        {selected && <RetourCasse order={selected} stock={stock} settings={settings} onSave={(r) => { onRetour(r); setSelected(null); }} onClose={() => setSelected(null)} />}
      </Modal>
    </div>
  );
}

// ─── RÉGLAGES ─────────────────────────────────────────────────────────────────
function SettingsView({ settings, setSettings, driveToken, setDriveToken, driveClientId, setDriveClientId, orders, setOrders, clients, setClients, stock, expenses, pushTokens, setPushTokens, userRoles, setUserRoles, myRole }) {
  const [askConfirm, ConfirmUI] = useConfirm();
  const [tab, setTab] = useState(myRole === "livreur" ? "notifications" : "entreprise");
  const [local, setLocal] = useState(settings);
  // Met à jour le formulaire quand les réglages arrivent de Firestore
  useEffect(() => { setLocal(settings); }, [settings]);
  const [saved, setSaved] = useState(false);
  // Notifications push
  const [notifStatus, setNotifStatus] = useState("idle"); // idle | loading | ok | err | denied
  const [openNotifSections, setOpenNotifSections] = useState(new Set()); // sections de notif dépliées
  const toggleNotifSection = (key) => setOpenNotifSections(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const myToken = useMemo(() => {
    try { return localStorage.getItem("eventdream_fcm_token") || null; } catch { return null; }
  }, []);
  const isThisDeviceRegistered = !!myToken && Array.isArray(pushTokens) && pushTokens.some(t => t.token === myToken);
  const activateNotifications = async () => {
    setNotifStatus("loading");
    try {
      const token = await registerPushNotifications();
      if (!token) {
        setNotifStatus(Notification && Notification.permission === "denied" ? "denied" : "err");
        return;
      }
      try { localStorage.setItem("eventdream_fcm_token", token); } catch {}
      setPushTokens(prev => {
        const list = Array.isArray(prev) ? prev : [];
        if (list.some(t => t.token === token)) return list;
        return [...list, { token, addedAt: new Date().toISOString(), userEmail: auth.currentUser ? auth.currentUser.email : "" }];
      });
      setNotifStatus("ok");
    } catch (e) {
      console.error(e);
      setNotifStatus("err");
    }
  };
  // Création de comptes employés
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("admin");
  const [roleEmailInput, setRoleEmailInput] = useState("");
  const [importMsg, setImportMsg] = useState(null);
  const [acctMsg, setAcctMsg] = useState(null); // {type:'ok'|'err', text}
  const [acctLoading, setAcctLoading] = useState(false);
  const createAccount = async () => {
    setAcctMsg(null);
    if (!newEmail.trim()) { setAcctMsg({ type: "err", text: "Email requis." }); return; }
    setAcctLoading(true);
    try {
      // Mot de passe temporaire généré aléatoirement : la personne ne le connaît jamais, elle
      // choisit le sien via le lien reçu par email (sendPasswordResetEmail) juste après.
      const tempPassword = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      await createUserAsAdmin(newEmail.trim(), tempPassword);
      await sendPasswordResetEmail(auth, newEmail.trim());
      const emailKey = newEmail.trim().toLowerCase();
      if (newRole === "livreur") {
        setUserRoles(prev => ({ ...prev, [emailKey]: "livreur" }));
      }
      setAcctMsg({ type: "ok", text: `Compte créé : ${newEmail.trim()} (${newRole === "livreur" ? "🚚 Livreur" : "🔓 Admin"}). Un email lui a été envoyé pour choisir son mot de passe.` });
      setNewEmail(""); setNewRole("admin");
    } catch (e) {
      const msg = {
        "auth/email-already-in-use": "Un compte existe déjà avec cet email.",
        "auth/invalid-email": "Email invalide.",
      }[e.code] || "Erreur : " + e.message;
      setAcctMsg({ type: "err", text: msg });
    }
    setAcctLoading(false);
  };
  const setL = (k, v) => { setLocal(s => ({ ...s, [k]: v })); setSaved(false); };
  // Liste des délais (en heures) pour un type d'évènement donné ("Livraison", "Retrait", "Retour").
  // Rétrocompatibilité : si l'ancien champ unique (ex: notifLivraisonHeures) existe encore et que
  // la nouvelle liste n'a pas été initialisée, on la reprend comme premier délai.
  const getDelais = (typeKey) => {
    const arr = local[`notif${typeKey}Delais`];
    if (Array.isArray(arr) && arr.length > 0) return arr;
    const legacy = local[`notif${typeKey}Heures`];
    return [typeof legacy === "number" ? legacy : 24];
  };
  const setDelai = (typeKey, idx, val) => {
    const arr = [...getDelais(typeKey)];
    arr[idx] = parseFloat(val) || 0;
    setL(`notif${typeKey}Delais`, arr);
  };
  const addDelai = (typeKey) => {
    const arr = getDelais(typeKey);
    setL(`notif${typeKey}Delais`, [...arr, 1]);
  };
  const removeDelai = (typeKey, idx) => {
    const arr = getDelais(typeKey).filter((_, i) => i !== idx);
    setL(`notif${typeKey}Delais`, arr.length ? arr : [24]);
  };
  const save = () => { setSettings(local); setSaved(true); setTimeout(() => setSaved(false), 2500); };

  // Drive connect
  const [driveId, setDriveId] = useState(driveClientId || "");
  const [driveStatus, setDriveStatus] = useState("idle");
  const connectDrive = async () => {
    if (!driveId.trim()) { alert("Entrez votre Client ID Google"); return; }
    setDriveClientId(driveId.trim()); setDriveStatus("loading");
    try {
      await new Promise((res, rej) => { if (!window.google) { const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.onload = res; s.onerror = rej; document.head.appendChild(s); } else res(); });
      const client = window.google.accounts.oauth2.initTokenClient({ client_id: driveId.trim(), scope: GDRIVE_SCOPE, callback: (r) => { if (r.error) { setDriveStatus("error"); return; } setDriveToken(r.access_token); setDriveStatus("ok"); } });
      client.requestAccessToken();
    } catch { setDriveStatus("error"); }
  };

  const allTabs = [{ id: "entreprise", label: "🏢 Entreprise" }, { id: "tarifs", label: "💶 Tarifs" }, { id: "livraison", label: "🚚 Livraison" }, { id: "divers", label: "⚙️ Divers" }, { id: "notifications", label: "🔔 Notifications" }, { id: "campagnes", label: "📧 Campagnes" }, { id: "cloud", label: "☁️ Cloud" }, { id: "sauvegardes", label: "💾 Sauvegardes" }, { id: "comptes", label: "👥 Comptes" }];
  // Un livreur n'a accès qu'aux réglages qui le concernent (activer ses propres notifications) :
  // pas la fiche entreprise, les tarifs, la sauvegarde cloud ou la gestion des comptes.
  const tabs = myRole === "livreur" ? allTabs.filter(t => t.id === "notifications") : allTabs;

  return (
    <div style={{ maxWidth: 680, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "#666" }}>👤 Connecté : <strong>{auth.currentUser ? auth.currentUser.email : ""}</strong></div>
        <button onClick={async () => { if (await askConfirm("Se déconnecter de l'application ?")) signOut(auth); }} style={{ padding: "8px 16px", borderRadius: 10, border: "1.5px solid #ef4444", background: "#fff", color: "#ef4444", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>🚪 Se déconnecter</button>
      </div>
      <div style={{ display: "flex", gap: 4, background: "#f0f0f0", borderRadius: 12, padding: 4, width: "fit-content", flexWrap: "wrap" }}>
        {tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "8px 16px", borderRadius: 10, border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 13, background: tab === t.id ? "#fff" : "transparent", color: tab === t.id ? "#1a1a2e" : "#999", boxShadow: tab === t.id ? "0 2px 8px rgba(0,0,0,0.08)" : "none" }}>{t.label}</button>)}
      </div>

      {tab === "entreprise" && (
        <Card>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800 }}>🏢 Informations entreprise (sur les devis)</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 10 }}>
              <Inp label="Logo" value={local.companyLogo} onChange={v => setL("companyLogo", v)} />
              <Inp label="Nom de l'entreprise" value={local.companyName} onChange={v => setL("companyName", v)} />
            </div>
            <Inp label="Adresse" value={local.address} onChange={v => setL("address", v)} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Inp label="Téléphone" value={local.phone} onChange={v => setL("phone", v)} />
              <Inp label="Email" value={local.email} onChange={v => setL("email", v)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <Inp label="SIRET" value={local.siret} onChange={v => setL("siret", v)} />
              <Inp label="N° TVA" value={local.tva} onChange={v => setL("tva", v)} />
              <Inp label="Site web" value={local.website} onChange={v => setL("website", v)} />
            </div>
          </div>
        </Card>
      )}

      {tab === "tarifs" && (
        <Card>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800 }}>💶 Tarification livraison</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Inp label="Adresse de l'entrepôt (point de départ)" value={local.warehouseAddress} onChange={v => setL("warehouseAddress", v)} />
            <Inp label="Forfait minimum (couvre les seuils ci-dessous)" type="number" value={local.minDeliveryPrice} onChange={v => setL("minDeliveryPrice", parseFloat(v) || 0)} suffix="€" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <Inp label="Seuil inclus (km)" type="number" value={local.seuilKm} onChange={v => setL("seuilKm", parseFloat(v) || 0)} suffix="km" />
              <Inp label="Seuil inclus (min)" type="number" value={local.seuilMin} onChange={v => setL("seuilMin", parseFloat(v) || 0)} suffix="min" />
            </div>
            <div style={{ fontSize: 12, color: "#666", fontWeight: 700, marginTop: 4 }}>Au-delà des seuils, supplément :</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <Inp label="Prix par km supplémentaire" type="number" value={local.pricePerKm} onChange={v => setL("pricePerKm", parseFloat(v) || 0)} step="0.1" suffix="€/km" />
              <Inp label="Prix par minute supplémentaire" type="number" value={local.pricePerMin} onChange={v => setL("pricePerMin", parseFloat(v) || 0)} step="0.05" suffix="€/min" />
            </div>
            <div style={{ background: "#f0f4ff", borderRadius: 10, padding: 14, fontSize: 13, color: "#3b82f6", lineHeight: 1.6 }}>
              💡 <strong>Comment ça marche :</strong> jusqu'à {local.seuilKm} km et {local.seuilMin} min → forfait de {local.minDeliveryPrice} €.<br/>
              Exemple à {local.seuilKm + 5} km / {local.seuilMin + 5} min → {calcTrajet(local.seuilKm + 5, local.seuilMin + 5, local).toFixed(2)} € par trajet<br/>
              <span style={{ fontSize: 11, color: "#6b7280" }}>({local.minDeliveryPrice} € + {(5 * (local.pricePerKm||0)).toFixed(2)} € (5 km sup.) + {(5 * (local.pricePerMin||0)).toFixed(2)} € (5 min sup.))</span>
            </div>
          </div>

          {/* ── Jours supplémentaires ── */}
          <div style={{ borderTop: "1px solid #f0f0f0", marginTop: 18, paddingTop: 16 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 800 }}>📅 Jours supplémentaires</h3>
            <Inp label="Durée standard incluse (jours)" type="number" value={local.standardDays ?? 2} onChange={v => setL("standardDays", parseInt(v) || 2)} step="1" suffix="jours" />
            <div style={{ background: "#fff7ed", borderRadius: 10, padding: 14, fontSize: 13, color: "#c2410c", lineHeight: 1.6, marginTop: 10 }}>
              💡 <strong>Comment ça marche :</strong> chaque période de {local.standardDays ?? 2} jours = 1× le prix des articles.<br/>
              Le nombre de périodes est arrondi au supérieur. La 1ère période est incluse dans le prix de base.<br/>
              <span style={{ fontSize: 11, color: "#92400e" }}>Exemple : 6 jours / {local.standardDays ?? 2}j = 3 périodes → supplément = 2 × sous-total articles</span>
            </div>
          </div>

          <div style={{ borderTop: "1px solid #f0f0f0", marginTop: 18, paddingTop: 16 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 800 }}>🧾 TVA</h3>
            <Inp label="Taux de TVA (%)" type="number" value={local.tvaRate} onChange={v => setL("tvaRate", parseFloat(v) || 0)} step="0.1" suffix="%" />
            <div style={{ fontSize: 12, color: "#999", marginTop: 6 }}>Vos prix sont TTC. Le devis PDF fera ressortir le HT, la TVA et le TTC. Mettez 0 si vous n'êtes pas assujetti (franchise en base).</div>
          </div>
        </Card>
      )}

      {tab === "livraison" && (
        <Card>
          <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 800 }}>🚚 Tarification automatique des options de livraison</h3>
          <div style={{ fontSize: 13, color: "#666", marginBottom: 16, lineHeight: 1.5 }}>
            Pour chaque article de ton stock : <strong>Monter à l'étage</strong> se calcule en nombre de trajets (selon combien tu peux porter à la fois) × prix du trajet × nombre d'étages. <strong>Mise en place</strong> se calcule par un simple prix unitaire × quantité commandée. Si rien n'est renseigné pour un article, son option vaut 0 € (tu pourras toujours corriger le prix à la main sur chaque devis).
          </div>
          {[...new Set((stock || []).map(s => s.category).filter(Boolean))].sort().map(cat => (
            <div key={cat} style={{ marginBottom: 18 }}>
              <div style={{ fontWeight: 900, fontSize: 13, color: "#999", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>{cat}</div>
              {(stock || []).filter(s => s.category === cat).map(item => (
                <div key={item.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, marginBottom: 10 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 12 }}>{item.icon} {item.name}</div>
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase", marginBottom: 6 }}>🪜 Monter à l'étage</div>
                    <EtageBaremeFields
                      cfg={(local.deliveryEtageBaremes || {})[item.id]}
                      onChange={cfg => setL("deliveryEtageBaremes", { ...(local.deliveryEtageBaremes || {}), [item.id]: cfg })}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase", marginBottom: 6 }}>🛠️ Mise en place</div>
                    <MiseEnPlaceBaremeFields
                      cfg={(local.deliveryMiseEnPlaceBaremes || {})[item.id]}
                      onChange={cfg => setL("deliveryMiseEnPlaceBaremes", { ...(local.deliveryMiseEnPlaceBaremes || {}), [item.id]: cfg })}
                    />
                  </div>
                </div>
              ))}
            </div>
          ))}
          {(stock || []).length === 0 && (
            <div style={{ fontSize: 13, color: "#999", textAlign: "center", padding: 20 }}>Aucun article trouvé — ajoute des articles dans le Stock pour configurer leurs barèmes.</div>
          )}
        </Card>
      )}

      {tab === "divers" && (
        <Card>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800 }}>⚙️ Réglages divers</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Inp label="Acompte par défaut" type="number" value={local.defaultAcomptePercent} onChange={v => setL("defaultAcomptePercent", parseFloat(v) || 0)} suffix="%" />
              <Inp label="Marge casse (sur prix achat)" type="number" value={local.casseMargePercent} onChange={v => setL("casseMargePercent", parseFloat(v) || 0)} suffix="%" />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase" }}>Conditions générales (bas du devis)</label>
              <textarea value={local.conditions} onChange={e => setL("conditions", e.target.value)} rows={3} style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 14, fontFamily: "inherit", resize: "vertical" }} />
            </div>
            <div style={{ background: "#f8f9fa", borderRadius: 10, padding: "12px 14px" }}>
              <Inp label="📷 Suppression auto des photos (livraison/retour) après clôture" type="number" value={local.photoRetentionDays} onChange={v => setL("photoRetentionDays", parseInt(v) || 0)} min="0" suffix="jours" />
              <div style={{ fontSize: 11, color: "#999", marginTop: 6, lineHeight: 1.4 }}>💡 0 = ne jamais supprimer automatiquement. Le commentaire et la signature restent conservés, seules les photos sont effacées (espace de stockage).</div>
            </div>
          </div>
          <div style={{ borderTop: "1px solid #f0f0f0", marginTop: 20, paddingTop: 16 }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 800 }}>💾 Sauvegarde / Export des données</h3>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 14 }}>Téléchargez une copie de vos données. À faire régulièrement pour ne jamais rien perdre.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Btn variant="primary" onClick={() => exportOrdersCsv(orders, settings)} style={{ width: "100%" }}>📊 Exporter les commandes (Google Sheets / Excel)</Btn>
              <Btn variant="ghost" onClick={() => exportFullBackup({ orders, clients, stock, expenses, settings, exportDate: new Date().toISOString() })} style={{ width: "100%" }}>🗄️ Sauvegarde complète (fichier de secours)</Btn>
            </div>
            <div style={{ background: "#f0f4ff", borderRadius: 10, padding: 12, fontSize: 12, color: "#3b82f6", marginTop: 12, lineHeight: 1.5 }}>
              💡 <strong>Le fichier CSV</strong> s'ouvre dans Google Sheets (Fichier → Importer) ou Excel.<br/>
              <strong>La sauvegarde complète</strong> (.json) contient TOUTES vos données : gardez-la précieusement.
            </div>
          </div>

          <div style={{ borderTop: "1px solid #f0f0f0", marginTop: 20, paddingTop: 16 }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 800 }}>📥 Importer des commandes</h3>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 14 }}>Charge un fichier .json contenant une liste de commandes (généré pour toi) et les ajoute à tes commandes existantes — sans rien supprimer ni écraser. Les clients qui n'existent pas encore dans ta bibliothèque sont créés automatiquement.</div>
            <label style={{ display: "block" }}>
              <input
                type="file"
                accept="application/json"
                style={{ display: "none" }}
                onChange={e => {
                  const file = e.target.files && e.target.files[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    try {
                      const parsed = JSON.parse(reader.result);
                      const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.orders) ? parsed.orders : null);
                      if (!list) { setImportMsg({ type: "err", text: "Fichier invalide : il doit contenir un tableau de commandes." }); return; }
                      const existingIds = new Set(orders.map(o => o.id));
                      const toAdd = list.filter(o => o && o.id && !existingIds.has(o.id));
                      if (!toAdd.length) { setImportMsg({ type: "err", text: "Aucune nouvelle commande à importer (déjà présentes ou fichier vide)." }); return; }
                      setOrders(prev => [...prev, ...toAdd]);
                      const newClients = extractNewClientsFromOrders(toAdd, clients);
                      if (newClients.length) setClients(prev => [...prev, ...newClients]);
                      setImportMsg({ type: "ok", text: `${toAdd.length} commande(s) importée(s) (${list.length - toAdd.length} déjà présentes, ignorées) + ${newClients.length} nouveau(x) client(s) ajouté(s) à la bibliothèque.` });
                    } catch (err) {
                      setImportMsg({ type: "err", text: "Fichier JSON invalide ou corrompu." });
                    }
                  };
                  reader.readAsText(file);
                  e.target.value = "";
                }}
              />
              <span style={{ display: "block", textAlign: "center", padding: "13px", borderRadius: 10, border: "1.5px solid #1a1a2e", background: "#fff", color: "#1a1a2e", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>📥 Choisir un fichier de commandes à importer</span>
            </label>
            {importMsg && <div style={{ background: importMsg.type === "ok" ? "#d1fae5" : "#fee2e2", color: importMsg.type === "ok" ? "#065f46" : "#b91c1c", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700, marginTop: 10 }}>{importMsg.type === "ok" ? "✅ " : "⚠️ "}{importMsg.text}</div>}

            <div style={{ borderTop: "1px dashed #e5e7eb", marginTop: 16, paddingTop: 14 }}>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>Des commandes existent déjà mais leurs clients manquent dans la bibliothèque (ex: import déjà fait avant cette mise à jour) ?</div>
              <Btn variant="secondary" onClick={() => {
                const newClients = extractNewClientsFromOrders(orders, clients);
                if (!newClients.length) { setImportMsg({ type: "err", text: "Aucun client manquant détecté — la bibliothèque est déjà à jour." }); return; }
                setClients(prev => [...prev, ...newClients]);
                setImportMsg({ type: "ok", text: `${newClients.length} client(s) manquant(s) rattrapé(s) et ajouté(s) à la bibliothèque.` });
              }} style={{ width: "100%" }}>🔄 Rattraper les clients manquants depuis les commandes existantes</Btn>
            </div>
          </div>
        </Card>
      )}

      {tab === "notifications" && (
        <>
          <Card>
            <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 800 }}>📲 Notifications sur cet appareil</h3>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 14, lineHeight: 1.5 }}>
              Active les notifications pour recevoir les alertes même quand l'application est fermée.<br/>
              <strong>Sur iPhone/iPad :</strong> l'app doit d'abord être ajoutée à l'écran d'accueil (Safari → partager → "Sur l'écran d'accueil"), sinon les notifications ne s'afficheront pas.
            </div>
            {isThisDeviceRegistered ? (
              <div style={{ background: "#f0fdf4", borderRadius: 10, padding: 14, fontSize: 13, color: "#065f46", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                ✅ Notifications activées sur cet appareil
              </div>
            ) : (
              <Btn variant="primary" onClick={activateNotifications} disabled={notifStatus === "loading"} style={{ width: "100%" }}>
                {notifStatus === "loading" ? "Activation en cours..." : "🔔 Activer les notifications sur cet appareil"}
              </Btn>
            )}
            {notifStatus === "denied" && (
              <div style={{ background: "#fef2f2", borderRadius: 10, padding: 12, fontSize: 12, color: "#ef4444", marginTop: 10, lineHeight: 1.5 }}>
                ⚠️ Permission refusée. Va dans les réglages de ton navigateur/téléphone pour autoriser les notifications pour ce site, puis réessaie.
              </div>
            )}
            {notifStatus === "err" && (
              <div style={{ background: "#fef2f2", borderRadius: 10, padding: 12, fontSize: 12, color: "#ef4444", marginTop: 10, lineHeight: 1.5 }}>
                ⚠️ Échec de l'activation. Vérifie que l'app a été ajoutée à l'écran d'accueil (iPhone), puis réessaie.
              </div>
            )}
            <div style={{ fontSize: 11, color: "#999", marginTop: 12 }}>
              {Array.isArray(pushTokens) ? pushTokens.length : 0} appareil(s) enregistré(s) au total dans l'équipe.
            </div>
          </Card>

          {myRole !== "livreur" && (
          <Card>
            <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800 }}>🔔 Types de notifications (toute l'équipe)</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", paddingBottom: 6, borderBottom: "1px solid #f0f0f0" }}>
                <input type="checkbox" checked={!!local.notifyOnValidation} onChange={e => setL("notifyOnValidation", e.target.checked)} style={{ width: 18, height: 18 }} />
                <span style={{ fontSize: 14, fontWeight: 700 }}>✅ Commande validée (Devis → Confirmée)</span>
              </label>

              {[
                { key: "Preparation", icon: "🔄", title: "Commande à préparer (départ qui approche)", label: "avant le départ" },
                { key: "Livraison", icon: "🚚", title: "Approche d'une livraison", label: "avant la livraison" },
                { key: "Retrait", icon: "🏪", title: "Approche d'un retrait", label: "avant le retrait" },
                { key: "Retour", icon: "↩️", title: "Approche d'un retour", label: "avant le retour" },
              ].map(sec => {
                const enabledKey = `notif${sec.key}Enabled`;
                const isOpen = openNotifSections.has(sec.key);
                return (
                  <div key={sec.key} style={{ border: "1px solid #f0f0f0", borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "#fafafa", cursor: "pointer" }} onClick={() => toggleNotifSection(sec.key)}>
                      <input type="checkbox" checked={!!local[enabledKey]} onClick={e => e.stopPropagation()} onChange={e => setL(enabledKey, e.target.checked)} style={{ width: 18, height: 18, flexShrink: 0 }} />
                      <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{sec.icon} {sec.title}</span>
                      <span style={{ fontSize: 12, color: "#999", fontWeight: 700 }}>{getDelais(sec.key).join("h, ")}h</span>
                      <span style={{ fontSize: 12, color: "#999", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▼</span>
                    </div>
                    {isOpen && (
                      <div style={{ padding: "14px 14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                        {getDelais(sec.key).map((h, idx) => (
                          <div key={idx} style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                            <div style={{ flex: 1 }}><Inp label={idx === 0 ? `Délai(s) d'alerte ${sec.label}` : ""} type="number" value={h} onChange={v => setDelai(sec.key, idx, v)} suffix="heures avant" disabled={!local[enabledKey]} /></div>
                            {getDelais(sec.key).length > 1 && <Btn variant="danger" size="sm" disabled={!local[enabledKey]} onClick={() => removeDelai(sec.key, idx)}><span style={{ width: 13, height: 13 }}>{I.trash}</span></Btn>}
                          </div>
                        ))}
                        <Btn variant="secondary" size="sm" disabled={!local[enabledKey]} onClick={() => addDelai(sec.key)}>+ Ajouter un délai</Btn>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ background: "#f0f4ff", borderRadius: 10, padding: 12, fontSize: 12, color: "#3b82f6", marginTop: 16, lineHeight: 1.5 }}>
              💡 Ces réglages sont communs à toute l'équipe : tous les appareils enregistrés ci-dessus reçoivent les mêmes alertes. N'oublie pas de cliquer sur "Enregistrer" en bas de page après modification.
            </div>
          </Card>
          )}
        </>
      )}

      {tab === "campagnes" && (
        <Card>
          <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 800 }}>📧 Campagnes email</h3>
          <div style={{ fontSize: 13, color: "#666", marginBottom: 16, lineHeight: 1.5 }}>
            Réglages de l'expéditeur et de l'apparence de tes campagnes promotionnelles. La clé API Brevo n'est pas configurée ici (pour des raisons de sécurité) — c'est moi qui m'en occupe directement côté serveur.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 480 }}>
            <Inp label="Nom de l'expéditeur" value={local.campaignSenderName} onChange={v => setL("campaignSenderName", v)} placeholder="EventDream" />
            <Inp label="Email expéditeur (vérifié dans Brevo)" value={local.campaignSenderEmail} onChange={v => setL("campaignSenderEmail", v)} placeholder="eventdream.company@gmail.com" />
            <Inp label="URL du logo (image, pour l'en-tête des emails)" value={local.campaignLogoUrl} onChange={v => setL("campaignLogoUrl", v)} placeholder="https://..." />
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#666", display: "block", marginBottom: 4 }}>Couleur d'accent</label>
              <input type="color" value={local.campaignAccentColor || "#1a1a2e"} onChange={e => setL("campaignAccentColor", e.target.value)} style={{ width: 60, height: 38, borderRadius: 8, border: "1.5px solid #e5e7eb", cursor: "pointer" }} />
            </div>
          </div>
          <div style={{ background: "#f0f4ff", borderRadius: 10, padding: 12, fontSize: 12, color: "#3b82f6", marginTop: 16, lineHeight: 1.5 }}>
            💡 Pour composer et envoyer une campagne, va dans <strong>Clients</strong> → sélectionne des destinataires → <strong>"Envoyer une campagne"</strong>.
          </div>
        </Card>
      )}

      {tab === "cloud" && (
        <Card>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800 }}>☁️ Google Drive & Maps</h3>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Clé API Google Maps (calcul distance auto)</div>
            <Inp value={local.googleMapsKey} onChange={v => setL("googleMapsKey", v)} placeholder="AIza..." />
            <div style={{ fontSize: 12, color: "#999", marginTop: 6 }}>Activez "Maps JavaScript API" et "Distance Matrix API" dans Google Cloud Console, puis cliquez sur "Enregistrer les réglages" ci-dessous.</div>
            {local.googleMapsKey && <div style={{ fontSize: 12, color: "#10b981", marginTop: 6, fontWeight: 700 }}>✓ Clé saisie — n'oubliez pas d'enregistrer</div>}
          </div>
          <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Sauvegarde PDF sur Google Drive</div>
            <div style={{ fontSize: 12, color: "#999", marginBottom: 10 }}>Optionnel — non requis pour le calcul de distance.</div>
            {driveToken ? (
              <div style={{ background: "#d1fae5", borderRadius: 12, padding: 14 }}>
                <div style={{ fontWeight: 800, color: "#065f46", marginBottom: 8 }}>✅ Connecté</div>
                <Btn variant="danger" size="sm" onClick={() => setDriveToken(null)}>Déconnecter</Btn>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Inp label="Google Client ID (OAuth)" value={driveId} onChange={setDriveId} placeholder="xxxxx.apps.googleusercontent.com" />
                <Btn variant="secondary" onClick={connectDrive} disabled={driveStatus === "loading"}>{driveStatus === "loading" ? "⏳..." : "☁️ Connecter Google Drive"}</Btn>
                {driveStatus === "error" && <div style={{ color: "#ef4444", fontSize: 13 }}>❌ Erreur. Vérifiez le Client ID et l'origine autorisée : {window.location.origin}</div>}
              </div>
            )}
          </div>
          <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 16, marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>📊 Synchronisation Google Sheets (temps réel)</div>
            <div style={{ fontSize: 12, color: "#999", marginBottom: 10 }}>Commandes et dépenses sont automatiquement réécrites dans ce Google Sheet à chaque modification. N'oublie pas de l'avoir partagé en Éditeur avec <code>eventdream-app@appspot.gserviceaccount.com</code>.</div>
            <Inp label="ID du Google Sheet" value={local.googleSheetId} onChange={v => setL("googleSheetId", v.trim())} placeholder="1-Mz_cKnT3_mqXK-jwAOIZtO0APoVD9h1E3TEwgYRThM" />
            {local.googleSheetId && <div style={{ fontSize: 12, color: "#10b981", marginTop: 6, fontWeight: 700 }}>✓ ID saisi — n'oubliez pas d'enregistrer</div>}
          </div>
        </Card>
      )}

      {tab === "sauvegardes" && (
        <BackupsPanel askConfirm={askConfirm} />
      )}

      {tab === "comptes" && (
        <Card>
          <h3 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 800 }}>👥 Gestion des comptes</h3>
          <div style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>Créez un compte pour chaque employé ou livreur. La personne reçoit un email pour choisir elle-même son mot de passe — tu n'as rien à lui communiquer.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 380 }}>
            <Inp label="Email du nouvel utilisateur" value={newEmail} onChange={setNewEmail} placeholder="employe@exemple.fr" />
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#666", display: "block", marginBottom: 4 }}>Rôle</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value)} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 14, background: "#fafafa" }}>
                <option value="admin">🔓 Admin (accès complet)</option>
                <option value="livreur">🚚 Livreur (accès restreint : Calendrier, Livreur, Retours, Réglages)</option>
              </select>
            </div>
            {acctMsg && <div style={{ background: acctMsg.type === "ok" ? "#d1fae5" : "#fee2e2", color: acctMsg.type === "ok" ? "#065f46" : "#b91c1c", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700 }}>{acctMsg.type === "ok" ? "✅ " : "⚠️ "}{acctMsg.text}</div>}
            <Btn variant="primary" onClick={createAccount} disabled={acctLoading}>{acctLoading ? "⏳ Création..." : "➕ Créer le compte et envoyer le lien"}</Btn>
          </div>
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #f0f0f0", fontSize: 12, color: "#999" }}>
            💡 Pour voir la liste de tous les comptes ou supprimer un compte, rendez-vous sur la console Firebase (Authentication → Users).
          </div>

          <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid #f0f0f0" }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 800 }}>🔐 Rôles restreints (livreurs)</h3>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 14 }}>Tout compte non listé ici a un accès complet (Admin) par défaut. Ajoute un email ci-dessous pour le restreindre.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {Object.keys(userRoles || {}).length === 0 && <div style={{ fontSize: 13, color: "#999", fontStyle: "italic" }}>Aucun compte restreint pour l'instant — tous les comptes ont un accès complet.</div>}
              {Object.entries(userRoles || {}).map(([email, role]) => (
                <div key={email} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, background: "#f8f9ff", borderRadius: 10, padding: "10px 12px" }}>
                  <span style={{ flex: "1 1 100%", fontSize: 13, fontWeight: 600, minWidth: 0, overflowWrap: "break-word" }}>{email}</span>
                  <select value={role} onChange={e => setUserRoles(prev => ({ ...prev, [email]: e.target.value }))} style={{ flex: 1, minWidth: 0, padding: "6px 8px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
                    <option value="admin">🔓 Admin</option>
                    <option value="livreur">🚚 Livreur</option>
                  </select>
                  <Btn variant="danger" size="sm" onClick={() => setUserRoles(prev => { const next = { ...prev }; delete next[email]; return next; }, true)}><span style={{ width: 13, height: 13 }}>{I.trash}</span></Btn>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <input type="email" value={roleEmailInput} onChange={e => setRoleEmailInput(e.target.value)} placeholder="email@exemple.fr" style={{ flex: "1 1 100%", minWidth: 0, padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" }} />
              <Btn variant="secondary" onClick={() => { const em = roleEmailInput.trim().toLowerCase(); if (!em) return; setUserRoles(prev => ({ ...prev, [em]: "livreur" })); setRoleEmailInput(""); }} style={{ flex: "1 1 100%" }}>+ Restreindre en livreur</Btn>
            </div>
          </div>
        </Card>
      )}

      {/* Bouton sauvegarde (sauf onglet comptes, et masqué pour les livreurs qui n'ont rien à enregistrer) */}
      {tab !== "comptes" && myRole !== "livreur" && <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "flex-end" }}>
        {saved && <span style={{ color: "#10b981", fontWeight: 700, fontSize: 14 }}>✅ Enregistré</span>}
        <Btn variant="primary" onClick={save}><span style={{ width: 16, height: 16 }}>{I.check}</span> Enregistrer les réglages</Btn>
      </div>}
      <div style={{ textAlign: "center", fontSize: 11, color: "#bbb", marginTop: 20, fontWeight: 700 }}>EventDream {APP_VERSION}</div>
      {ConfirmUI}
    </div>
  );
}

// ─── APP PRINCIPALE ───────────────────────────────────────────────────────────
// ─── PANNEAU DE SAUVEGARDES ───────────────────────────────────────────────────
function BackupsPanel({ askConfirm }) {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dupGroups, setDupGroups] = useState(null); // résultats de la recherche
  const [findingDups, setFindingDups] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [restoring, setRestoring] = useState(null);
  const [msg, setMsg] = useState(null); // { type: "ok"|"err", text }

  const doFix = async () => {
    setFixing(true); setMsg(null);
    try {
      const res = await fixRecoveredIds();
      setMsg({ type: "ok", text: `✅ ${res.fixedOrders} commande(s) corrigée(s), ${res.fixedItems} article(s) mis à jour. Recharge l'app pour vérifier.` });
    } catch (e) { setMsg({ type: "err", text: "Erreur : " + (e.message || "échec") }); }
    setFixing(false);
  };

  const loadBackups = async () => {
    setLoading(true);
    try {
      const { collection, query, orderBy, limit, getDocs } = await import("firebase/firestore");
      const q = query(collection(db, "backups"), orderBy("createdAt", "desc"), limit(10));
      const snap = await getDocs(q);
      setBackups(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { setMsg({ type: "err", text: "Erreur lors du chargement : " + e.message }); }
    setLoading(false);
  };

  useEffect(() => { loadBackups(); }, []);

  const doBackup = async () => {
    setSaving(true); setMsg(null);
    try {
      const res = await triggerBackup();
      setMsg({ type: "ok", text: `✅ Sauvegarde créée : ${res.orderCount} commandes, ${res.clientCount} clients.` });
      loadBackups();
    } catch (e) { setMsg({ type: "err", text: "Erreur : " + (e.message || "échec de la sauvegarde") }); }
    setSaving(false);
  };

  const doRestore = async (backup) => {
    const confirmed = await askConfirm(`Restaurer la sauvegarde du ${new Date(backup.createdAt).toLocaleString("fr-FR")} ?\n\n${backup.orderCount} commandes, ${backup.clientCount} clients.\n\n⚠️ L'état actuel sera d'abord sauvegardé automatiquement avant la restauration.`);
    if (!confirmed) return;
    setRestoring(backup.id); setMsg(null);
    try {
      const res = await restoreBackup(backup.id);
      setMsg({ type: "ok", text: `✅ ${res.orderCount} commandes restaurées ! Recharge l'application pour voir les changements.` });
      loadBackups();
    } catch (e) { setMsg({ type: "err", text: "Erreur : " + (e.message || "échec de la restauration") }); }
    setRestoring(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 800 }}>💾 Sauvegardes automatiques</h3>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 14, lineHeight: 1.5 }}>
          Une sauvegarde complète (commandes, clients, stock, dépenses, réglages) est créée automatiquement <strong>chaque nuit à 2h</strong>. Les 7 derniers jours sont conservés. En cas de problème, clique sur "Restaurer" pour remettre tout en état en quelques secondes.
        </div>
        <Btn variant="primary" onClick={doBackup} disabled={saving} style={{ width: "100%" }}>
          {saving ? "⏳ Sauvegarde en cours..." : "💾 Sauvegarder maintenant"}
        </Btn>
        <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 12, marginTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#999", marginBottom: 4 }}>🔧 Maintenance</div>
          <Btn variant="secondary" onClick={doFix} disabled={fixing} style={{ width: "100%" }}>
            {fixing ? "⏳ Correction en cours..." : "🔧 Corriger les articles manquants (recovered_xxx)"}
          </Btn>
          <Btn variant="secondary" onClick={async () => {
            if (!(await askConfirm("Fusionner les clients en doublon ?\n\nLes clients avec le même nom seront fusionnés en un seul (téléphones et adresses conservés)."))) return;
            setMsg(null);
            try {
              const res = await deduplicateClients();
              setMsg({ type: "ok", text: `✅ ${res.before} clients → ${res.after} clients (${res.removed} doublons supprimés). Recharge l'app.` });
            } catch (e) { setMsg({ type: "err", text: "Erreur : " + (e.message || "échec") }); }
          }} style={{ width: "100%" }}>
            👥 Fusionner les clients en doublon
          </Btn>
          <Btn variant="secondary" onClick={async () => {
            setFindingDups(true); setDupGroups(null); setMsg(null);
            try {
              const res = await findDuplicateClients();
              setDupGroups(res.groups);
              if (res.count === 0) setMsg({ type: "ok", text: "✅ Aucun doublon potentiel détecté !" });
            } catch (e) { setMsg({ type: "err", text: "Erreur : " + (e.message || "échec") }); }
            setFindingDups(false);
          }} disabled={findingDups} style={{ width: "100%" }}>
            {findingDups ? "⏳ Recherche..." : "🔍 Rechercher les doublons restants"}
          </Btn>
        </div>
      </Card>

      {msg && <div style={{ background: msg.type === "ok" ? "#d1fae5" : "#fef2f2", color: msg.type === "ok" ? "#065f46" : "#b91c1c", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 700 }}>{msg.text}</div>}

      {dupGroups && dupGroups.length > 0 && (
        <Card>
          <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 800 }}>🔍 {dupGroups.length} groupe(s) de doublons potentiels</h3>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>Vérifie et fusionne manuellement dans la bibliothèque clients si nécessaire.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {dupGroups.map((g, i) => (
              <div key={i} style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#92400e", marginBottom: 8 }}>{g.reason}</div>
                {g.clients.map(c => (
                  <div key={c.id} style={{ fontSize: 12, color: "#444", marginBottom: 4, paddingLeft: 8, borderLeft: "2px solid #fde68a" }}>
                    <strong>{c.name}</strong>
                    {(c.phones || []).filter(Boolean).length > 0 && <span style={{ color: "#666" }}> · {(c.phones || []).filter(Boolean).join(", ")}</span>}
                    {c.email && <span style={{ color: "#666" }}> · {c.email}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 800 }}>📋 Sauvegardes disponibles</h3>
        {loading ? <div style={{ color: "#999", fontSize: 13 }}>Chargement...</div> : backups.length === 0 ? (
          <div style={{ color: "#999", fontSize: 13, textAlign: "center", padding: 20 }}>Aucune sauvegarde disponible — crée la première manuellement ci-dessus.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {backups.map(b => (
              <div key={b.id} style={{ background: "#f8f9fa", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>
                    {new Date(b.createdAt).toLocaleString("fr-FR")}
                    {b.manual && <span style={{ marginLeft: 6, fontSize: 11, background: "#e0e7ff", color: "#4338ca", borderRadius: 6, padding: "2px 6px" }}>Manuel</span>}
                    {b.preRestore && <span style={{ marginLeft: 6, fontSize: 11, background: "#fef9c3", color: "#92400e", borderRadius: 6, padding: "2px 6px" }}>Avant restauration</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                    {b.orderCount || 0} commandes · {b.clientCount || 0} clients
                  </div>
                </div>
                <Btn variant="secondary" size="sm" disabled={restoring === b.id} onClick={() => doRestore(b)}>
                  {restoring === b.id ? "⏳" : "↩️ Restaurer"}
                </Btn>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetMsg, setResetMsg] = useState(null); // {type:'ok'|'err', text}
  const [resetLoading, setResetLoading] = useState(false);

  const submit = async () => {
    setError(""); setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e) {
      const msg = {
        "auth/invalid-email": "Email invalide.",
        "auth/user-not-found": "Aucun compte avec cet email.",
        "auth/wrong-password": "Mot de passe incorrect.",
        "auth/invalid-credential": "Email ou mot de passe incorrect.",
      }[e.code] || "Erreur : " + e.message;
      setError(msg);
    }
    setLoading(false);
  };

  const sendReset = async () => {
    setResetMsg(null);
    if (!email.trim()) { setResetMsg({ type: "err", text: "Entre d'abord ton email ci-dessus, puis clique sur ce lien." }); return; }
    setResetLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setResetMsg({ type: "ok", text: `Email envoyé à ${email.trim()} ! Vérifie ta boîte de réception (et les spams) pour réinitialiser ton mot de passe.` });
    } catch (e) {
      const msg = {
        "auth/invalid-email": "Email invalide.",
        "auth/user-not-found": "Aucun compte avec cet email.",
      }[e.code] || "Erreur : " + e.message;
      setResetMsg({ type: "err", text: msg });
    }
    setResetLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 32, width: "100%", maxWidth: 380, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 44, marginBottom: 8 }}>🎪</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: "#1a1a2e" }}>Location Pro</div>
          <div style={{ fontSize: 13, color: "#999", marginTop: 4 }}>Connectez-vous pour continuer</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#666" }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="vous@exemple.fr" style={{ padding: "12px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 15, boxSizing: "border-box" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#666" }}>Mot de passe</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} placeholder="••••••" style={{ padding: "12px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 15, boxSizing: "border-box" }} />
          </div>
          {error && <div style={{ background: "#fee2e2", color: "#b91c1c", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 600 }}>{error}</div>}
          <button onClick={submit} disabled={loading || !email || !password} style={{ padding: "13px", borderRadius: 10, border: "none", background: loading ? "#9ca3af" : "#1a1a2e", color: "#fff", fontWeight: 800, fontSize: 15, cursor: loading ? "default" : "pointer", marginTop: 4 }}>
            {loading ? "Patientez..." : "Se connecter"}
          </button>
          <button onClick={sendReset} disabled={resetLoading} style={{ background: "none", border: "none", color: "#6366f1", fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "center", padding: "4px 0", fontFamily: "inherit" }}>
            {resetLoading ? "Envoi en cours..." : "Mot de passe oublié ?"}
          </button>
          {resetMsg && <div style={{ background: resetMsg.type === "ok" ? "#d1fae5" : "#fee2e2", color: resetMsg.type === "ok" ? "#065f46" : "#b91c1c", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 600 }}>{resetMsg.text}</div>}
        </div>
      </div>
    </div>
  );
}
// Filet de sécurité contre les pages blanches (ex: après une reprise d'app instable suite à un
// partage natif iOS) : si une erreur React imprévue survient, affiche un écran récupérable avec
// un bouton "Recharger" plutôt que de laisser l'utilisateur bloqué sur une page vide.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, message: "", stack: "" }; }
  static getDerivedStateFromError(error) { return { hasError: true, message: error && error.message, stack: error && error.stack }; }
  componentDidCatch(error, info) { console.error("Erreur React interceptée :", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, textAlign: "center", fontFamily: "'Nunito', 'Segoe UI', sans-serif", background: "#f4f5f7" }}>
          <div style={{ fontSize: 48 }}>😵</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>Oups, une erreur est survenue</div>
          <div style={{ fontSize: 14, color: "#666", maxWidth: 320 }}>L'application a rencontré un problème inattendu (souvent après un retour depuis une autre app). Recharge pour continuer — tes données sont en sécurité.</div>
          {/* Détail technique temporaire (phase de test) : à retirer une fois le bug du moment résolu */}
          {this.state.message && (
            <div style={{ maxWidth: 340, background: "#fff", border: "1.5px solid #fecaca", borderRadius: 10, padding: "10px 14px", fontSize: 11, color: "#b91c1c", textAlign: "left", fontFamily: "monospace", maxHeight: 160, overflowY: "auto" }}>
              {this.state.message}
              {this.state.stack && <div style={{ marginTop: 6, color: "#999", whiteSpace: "pre-wrap" }}>{this.state.stack.split("\n").slice(0, 4).join("\n")}</div>}
            </div>
          )}
          <button onClick={() => window.location.reload()} style={{ padding: "13px 28px", borderRadius: 10, border: "none", background: "#1a1a2e", color: "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>🔄 Recharger l'application</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppInner() {
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => { setAuthUser(u); setAuthLoading(false); });
    return () => unsub();
  }, []);
  // L'onglet actif est mémorisé dans le navigateur pour rester sur la même page au rafraîchissement.
  // Toujours démarrer sur le tableau de bord au lancement, quelle que soit la page précédente.
  const [view, setViewRaw] = useState("dashboard");
  const setView = (v) => { setViewRaw(v); };
  // Données synchronisées avec Firestore (sauvegarde cloud automatique)
  const [orders, setOrders] = useFirestoreState("orders", []);
  const [stock, setStock] = useFirestoreState("stock", INITIAL_STOCK);
  const [expenses, setExpenses] = useFirestoreState("expenses", []);
  const [clients, setClients] = useFirestoreState("clients", []);
  const [settings, setSettings] = useFirestoreState("settings", DEFAULT_SETTINGS);
  const [expenseCategories, setExpenseCategories] = useFirestoreState("expenseCategories", EXPENSE_CATEGORIES);
  const [recurringExpenses, setRecurringExpenses] = useFirestoreState("recurringExpenses", []);
  const [pushTokens, setPushTokens] = useFirestoreState("pushTokens", []);
  const [userRoles, setUserRoles] = useFirestoreState("userRoles", {});
  // NOTE : les migrations automatiques "kits par défaut" et "articles Décoration" (qui ajoutaient
  // ces articles au stock s'ils étaient absents) ont été RETIRÉES après la v3.19. Elles avaient déjà
  // rempli leur rôle ; les laisser actives recréait un article que l'utilisateur venait de supprimer
  // volontairement, à chaque rechargement de l'app. Si un nouvel article par défaut doit être ajouté
  // à l'avenir, mieux vaut le faire une fois manuellement plutôt que via une vérification permanente.

  // Génère automatiquement la dépense du mois pour chaque modèle récurrent actif (loyer, box
  // internet, forfait téléphone...), s'il n'en existe pas déjà une pour ce mois. Vérifié à
  // chaque chargement de l'app — pas besoin d'action manuelle de l'utilisateur chaque mois.
  useEffect(() => {
    if (!Array.isArray(recurringExpenses) || !recurringExpenses.length) return;
    if (!Array.isArray(expenses)) return;
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const existingRecurringThisMonth = new Set(
      expenses.filter(e => e.recurringId && (e.date || "").startsWith(ym)).map(e => e.recurringId)
    );
    const toCreate = recurringExpenses
      .filter(r => r.active !== false && !existingRecurringThisMonth.has(r.id))
      .map(r => {
        const day = Math.min(28, Math.max(1, parseInt(r.dayOfMonth) || 1));
        const date = `${ym}-${String(day).padStart(2, "0")}`;
        return {
          id: "DEP-" + Date.now() + "-" + r.id,
          date, label: r.label, category: r.category || "Autre",
          amount: parseFloat(r.amount) || 0, supplier: r.supplier || "",
          paymentMethod: r.paymentMethod || "Prélèvement", notes: "Générée automatiquement (dépense récurrente)",
          linkedItemId: "", linkedQty: 0, recurringId: r.id,
        };
      });
    if (toCreate.length > 0) {
      setExpenses(prev => [...toCreate, ...prev]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recurringExpenses, expenses]);
  const [driveToken, setDriveToken] = useState(null);
  const [driveClientId, setDriveClientId] = useState("");
  const [editOrder, setEditOrder] = useState(null);
  const [viewOrder, setViewOrder] = useState(null);
  const [soldeOrder, setSoldeOrder] = useState(null); // commande dont on encaisse le solde
  const [soldeMoyenSel, setSoldeMoyenSel] = useState("especes");
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState("Toutes");
  const [searchQ, setSearchQ] = useState("");
  const [quickFilter, setQuickFilter] = useState(null); // "aPreparer" | null — déclenché depuis le tableau de bord
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const touchStartX = useRef(null);
  // (shareModal retiré : sharePdf se contente désormais d'un téléchargement direct, sans fenêtre)
  const [expandedOrders, setExpandedOrders] = useState(() => new Set());
  const toggleExpand = (id) => setExpandedOrders(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const saveOrder = (order, isEdit) => setOrders(prev => {
    const exists = prev.find(o => o.id === order.id);
    if (isEdit && exists) {
      // Modification d'un devis existant : on remplace.
      return prev.map(o => o.id === order.id ? order : o);
    }
    // Création : on garantit un id unique (jamais d'écrasement d'un devis existant).
    let newOrder = { ...order, phase: order.phase || "livraison" };
    if (exists) {
      newOrder.id = `${order.id}-${Date.now().toString(36).slice(-4)}`;
    }
    return [newOrder, ...prev];
  });
  const [askConfirm, ConfirmUI] = useConfirm();
  const deleteOrder = async (id) => { if (await askConfirm("Supprimer cette commande ?")) setOrders(prev => prev.filter(o => o.id !== id), true); };
  const updateStatus = (id, status) => setOrders(prev => prev.map(o => {
    if (o.id !== id) return o;
    // Passage automatique en phase retour quand livré
    const phase = ["Chez le client"].includes(status) ? "retour" : status === "Clôturée" ? "termine" : "livraison";
    // Mémorise la date de clôture (référence pour la suppression auto des photos après X jours)
    const closedAt = status === "Clôturée" && !o.closedAt ? new Date().toISOString() : o.closedAt;
    return { ...o, status, phase, closedAt };
  }));

  const saveRetour = (result) => {
    setOrders(prev => prev.map(o => o.id === result.orderId ? {
      ...o, status: "Clôturée", phase: "termine", closedAt: o.closedAt || new Date().toISOString(),
      returnComment: result.notes, returnPhotos: result.photos || [], returnSignature: result.signature || "",
      returnSignedBy: result.signedBy || "", returnSignedAt: result.signedAt || "",
    } : o));
    setStock(prev => prev.map(item => { const r = result.retours.find(r => r.id === item.id); if (!r) return item; return { ...item, total: Math.max(0, item.total - r.qtyCasse) }; }));
    if (result.totalCasse > 0) {
      const lines = result.retours.filter(r => r.qtyCasse > 0).map(r => `${r.name} ×${r.qtyCasse}`).join(", ");
      const o = orders.find(x => x.id === result.orderId);
      setExpenses(prev => [{ id: "CASSE-" + Date.now(), date: result.date, label: `Casse ${result.orderId} — ${lines}`, category: "Maintenance / Réparation", amount: result.totalCasse, supplier: o?.clientName || "", paymentMethod: "À facturer", notes: `Marge ${result.margePercent}% · ${result.notes}`, linkedItemId: "", linkedQty: 0 }, ...prev]);
    }
  };

  // Confirme la livraison/retrait : enregistre le commentaire/photos/signature sur la commande
  // ET passe son statut à "Livrée" en une seule fois (la signature est désormais obligatoire
  // pour valider, plus de simple confirmation sans preuve).
  const confirmDelivery = (orderId, data) => setOrders(prev => prev.map(o => {
    if (o.id !== orderId) return o;
    return {
      ...o, status: "Chez le client", phase: "retour",
      deliveryComment: data.comment, deliveryPhotos: data.photos || [], deliverySignature: data.signature || "",
      deliverySignedBy: data.signedBy || "", deliverySignedAt: data.signedAt || "",
    };
  }));

  // Encaisser le solde : passe l'acompte au total (reste = 0) et enregistre le moyen de paiement du solde.
  const encaisserSolde = (orderId, moyen) => setOrders(prev => prev.map(o => {
    if (o.id !== orderId) return o;
    const total = orderTotal(o, settings);
    return { ...o, acompte: total, soldeMoyen: moyen, soldeDate: new Date().toISOString().slice(0, 10) };
  }));

  // Partage devis PDF
  const sharePdf = async (order, mode = "devis") => {
    try {
      const blob = await buildPdfBlob(order, settings, mode, stock);
      const prefix = mode === "facture" ? order.id.replace(/^dev/, "facture") : order.id;
      const datePart = (order.deliveryDate || "").split("-").reverse().join("-"); // jj-mm-aaaa
      const clientPart = (order.clientName || "client").replace(/[^a-zA-Z0-9À-ÿ]+/g, "_");
      const fname = [prefix, datePart, clientPart].filter(Boolean).join("_") + ".pdf";
      // Volontairement simple : on télécharge le PDF, point final. Aucune fenêtre de partage,
      // aucun lien généré par l'app, aucun partage natif déclenché par notre code (instable en
      // PWA installée) — l'utilisateur choisit lui-même son app de partage depuis ses
      // Téléchargements, en utilisant le bouton natif de son téléphone sur le fichier.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = fname; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { console.error(e); alert("Erreur lors de la génération du PDF."); }
  };

  // Supprime une photo (livraison ou retour) d'une commande : retire le fichier de Storage
  // ET son URL du tableau correspondant sur la commande. kind: "delivery" | "return".
  const deleteOrderPhoto = async (orderId, kind, index, url) => {
    if (!(await askConfirm("Supprimer cette photo ? Cette action est définitive."))) return;
    try { await deletePhoto(url); } catch (e) { console.error(e); }
    const field = kind === "delivery" ? "deliveryPhotos" : "returnPhotos";
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, [field]: (o[field] || []).filter((_, i) => i !== index) } : o));
  };

  const prepLimitNav = (() => { const d = new Date(); d.setDate(d.getDate() + 4); return d.toISOString().split("T")[0]; })();
  const isAPreparer = (o) => !["Brouillon", "Devis", "Chez le client", "Clôturée"].includes(o.status) && o.deliveryDate && o.deliveryDate >= TODAY && o.deliveryDate <= prepLimitNav;
  const filtered = useMemo(() => orders
    .filter(o => {
      if (view === "devisEnAttente") return o.status === "Brouillon" || o.status === "Devis";
      if (filterStatus === "Toutes" && (o.status === "Brouillon" || o.status === "Devis")) return false; // masqués par défaut, voir "Devis en attente"
      return (filterStatus === "Toutes" || o.status === filterStatus);
    })
    .filter(o => ((o.clientName || "").toLowerCase().includes(searchQ.toLowerCase()) || (o.id || "").toLowerCase().includes(searchQ.toLowerCase())) && (quickFilter !== "aPreparer" || isAPreparer(o)))
    .sort((a, b) => {
      const aOpen = a.status !== "Clôturée", bOpen = b.status !== "Clôturée";
      if (aOpen !== bOpen) return aOpen ? -1 : 1; // non clôturées toujours en premier
      return (b.closedAt || b.returnDate || b.deliveryDate || "").localeCompare(a.closedAt || a.returnDate || a.deliveryDate || "");
    }),
    [orders, filterStatus, searchQ, quickFilter, view]);
  const retourCount = useMemo(() => orders.filter(o => o.phase === "retour" && o.status !== "Clôturée").length, [orders]);
  // Compteurs pour les badges du menu (mémorisés : ne se recalculent que si "orders" change réellement,
  // pas à chaque frappe/clic dans l'app — important pour la fluidité avec un grand nombre de commandes)
  // Commandes à préparer : livraison/départ qui approche, pas encore traitées
  const aPreparerCount = useMemo(() => orders.filter(isAPreparer).length, [orders]);
  // Devis/brouillons non conclus : pas encore confirmés par le client, à part pour éviter
  // toute suppression accidentelle et la perte des coordonnées clients associées.
  const pendingDevisCount = useMemo(() => orders.filter(o => o.status === "Brouillon" || o.status === "Devis").length, [orders]);
  // Commandes à livrer : mode livraison, prêtes/confirmées, pas encore livrées
  const aLivrerCount = useMemo(() => orders.filter(o =>
    o.deliveryMode === "livraison" &&
    !["Brouillon", "Devis", "Chez le client", "Clôturée"].includes(o.status)
  ).length, [orders]);
  // Commandes à retirer au local : mode retrait, prêtes/confirmées, pas encore récupérées
  const aRetirerCount = useMemo(() => orders.filter(o =>
    o.deliveryMode === "retrait" &&
    !["Brouillon", "Devis", "Chez le client", "Clôturée"].includes(o.status)
  ).length, [orders]);

  const navItems = [
    { id: "dashboard", label: "Tableau de bord", icon: "🏠" },
    { id: "orders", label: "Commandes", icon: "📋", badge: aPreparerCount },
    { id: "devisEnAttente", label: "Devis en attente", icon: "📝", badge: pendingDevisCount },
    { id: "clients", label: "Clients", icon: "👥" },
    { id: "stock", label: "Stock", icon: "📦" },
    { id: "compta", label: "Comptabilité", icon: "💹" },
    { id: "calendar", label: "Calendrier", icon: "📅" },
    { id: "delivery", label: "Livreur", icon: "🚚", badge: aLivrerCount + aRetirerCount },
    { id: "retours", label: "Retours", icon: "↩️", badge: retourCount },
    { id: "settings", label: "Réglages", icon: "⚙️" },
  ];
  // Rôle de l'utilisateur connecté : "livreur" = accès restreint à Calendrier/Livreur/Retours/Réglages.
  // Par défaut (email non listé dans userRoles), tout le monde est "admin" (accès complet),
  // pour ne jamais bloquer accidentellement un compte existant.
  const myEmail = authUser && authUser.email ? authUser.email.toLowerCase() : "";
  const myRole = (userRoles && userRoles[myEmail]) || "admin";
  const LIVREUR_ALLOWED = ["calendar", "delivery", "retours", "settings"];
  const visibleNavItems = myRole === "livreur" ? navItems.filter(n => LIVREUR_ALLOWED.includes(n.id)) : navItems;

  // Détecte un VRAI changement de compte (UID différent, ex: déconnexion puis connexion avec un
  // autre utilisateur SANS fermer l'app) pour repartir sur une page sûre. Sans ça, la page/les
  // modales ouvertes restaient mémorisées de l'utilisateur précédent (bug observé : un livreur
  // gardait l'accès complet tant que l'app n'était pas totalement fermée/rouverte).
  const prevUidRef = useRef(undefined);
  useEffect(() => {
    const uid = authUser ? authUser.uid : null;
    if (prevUidRef.current !== undefined && prevUidRef.current !== uid) {
      setViewRaw("dashboard");
      setEditOrder(null);
      setViewOrder(null);
      setShowForm(false);
    }
    prevUidRef.current = uid;
  }, [authUser]);

  // Si un livreur se retrouve sur une page qui ne lui est pas autorisée (ancien état mémorisé,
  // changement de rôle en cours de session...), on le ramène automatiquement sur "Livreur".
  useEffect(() => {
    if (myRole === "livreur" && !LIVREUR_ALLOWED.includes(view)) setViewRaw("delivery");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRole, view]);

  if (authLoading) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#1a1a2e", color: "#fff", fontSize: 18, fontWeight: 700 }}>🎪 Chargement…</div>;
  }
  if (!authUser) {
    return <LoginScreen />;
  }

  return (
    <>
    <div style={{ display: "flex", height: "100%", overflow: "hidden", background: "#f4f5f7", fontFamily: "'Nunito', 'Segoe UI', sans-serif" }}>
      <div
        onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchStartX.current == null) return;
          const dx = e.changedTouches[0].clientX - touchStartX.current;
          if (dx > 40) setSidebarOpen(true);
          else if (dx < -40) setSidebarOpen(false);
          touchStartX.current = null;
        }}
        onWheel={(e) => { if (e.deltaX > 20) setSidebarOpen(true); else if (e.deltaX < -20) setSidebarOpen(false); }}
        style={{ width: sidebarOpen ? 230 : 64, background: "#1a1a2e", color: "#fff", display: "flex", flexDirection: "column", transition: "width 0.25s ease", overflow: "hidden", flexShrink: 0, height: "100%" }}>
        <div onClick={() => setSidebarOpen(s => !s)} style={{ padding: "20px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #e94560, #f59e0b)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{settings.companyLogo || "🎪"}</div>
          {sidebarOpen && <div style={{ fontWeight: 900, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{settings.companyName}</div>}
        </div>
        <nav style={{ flex: 1, padding: "12px 8px", overflowY: "auto" }}>
          {visibleNavItems.map(item => (
            <button key={item.id} onClick={() => setView(item.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, marginBottom: 4, background: view === item.id ? "rgba(255,255,255,0.12)" : "transparent", color: view === item.id ? "#fff" : "rgba(255,255,255,0.5)", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 14, textAlign: "left", position: "relative" }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>{item.icon}</span>
              {sidebarOpen && <span style={{ whiteSpace: "nowrap", flex: 1 }}>{item.label}</span>}
              {item.badge > 0 && <span style={{ background: "#ef4444", color: "#fff", borderRadius: 20, padding: "1px 7px", fontSize: 11, fontWeight: 900, position: sidebarOpen ? "static" : "absolute", top: 4, right: 4 }}>{item.badge}</span>}
            </button>
          ))}
        </nav>
        <button onClick={() => setSidebarOpen(s => !s)} style={{ padding: 16, background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", display: "flex", justifyContent: sidebarOpen ? "flex-end" : "center" }}><span style={{ fontSize: 18 }}>{sidebarOpen ? "◀" : "▶"}</span></button>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" }}>
        <div style={{ background: "#fff", borderBottom: "1px solid #eee", padding: "0 16px", height: 64, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: "#1a1a2e", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{navItems.find(n => n.id === view)?.label}</h1>
          {view === "orders" && <Btn variant="primary" size="sm" onClick={() => { setEditOrder(null); setShowForm(true); }} style={{ flexShrink: 0, whiteSpace: "nowrap" }}><span style={{ width: 14, height: 14 }}>{I.plus}</span> Nouveau</Btn>}
        </div>

        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: 24, minWidth: 0 }}>
          {view === "dashboard" && <Dashboard orders={orders} expenses={expenses} settings={settings} setView={setView} setQuickFilter={setQuickFilter} />}
          {view === "stock" && <StockView orders={orders} stock={stock} setStock={setStock} />}
          {view === "compta" && <ComptaView orders={orders} expenses={expenses} setExpenses={setExpenses} stock={stock} settings={settings} expenseCategories={expenseCategories} setExpenseCategories={setExpenseCategories} recurringExpenses={recurringExpenses} setRecurringExpenses={setRecurringExpenses} />}
          {view === "calendar" && <Card><CalendarView orders={orders} onOpenOrder={(o) => setViewOrder(o)} settings={settings} /></Card>}
          {view === "delivery" && <DeliveryInterface orders={orders} stock={stock} settings={settings} onShare={sharePdf} onConfirmDelivery={confirmDelivery} onRetour={saveRetour} onEncaisser={(o) => { setSoldeOrder(o); setSoldeMoyenSel("especes"); }} onDeletePhoto={deleteOrderPhoto} />}
          {view === "retours" && <RetoursView orders={orders} stock={stock} settings={settings} onRetour={saveRetour} />}
          {view === "settings" && <SettingsView settings={settings} setSettings={setSettings} driveToken={driveToken} setDriveToken={setDriveToken} driveClientId={driveClientId} setDriveClientId={setDriveClientId} orders={orders} setOrders={setOrders} clients={clients} setClients={setClients} stock={stock} expenses={expenses} pushTokens={pushTokens} setPushTokens={setPushTokens} userRoles={userRoles} setUserRoles={setUserRoles} myRole={myRole} />}

          {view === "clients" && (
            <Card>
              <h2 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 800 }}>👥 Bibliothèque clients</h2>
              <div style={{ color: "#999", fontSize: 13, marginBottom: 20 }}>{clients.length} client(s) enregistré(s)</div>
              <ClientLibrary clients={clients} setClients={setClients} embedded settings={settings} orders={orders} />
            </Card>
          )}

          {(view === "orders" || view === "devisEnAttente") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {view === "devisEnAttente" && (
                <div style={{ background: "#fffbeb", border: "1.5px solid #fde68a", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#92400e" }}>
                  📝 Devis et brouillons pas encore confirmés par le client — gardés à part pour ne jamais les supprimer par erreur ni perdre les coordonnées saisies (nom, téléphone, email...).
                </div>
              )}
              {quickFilter === "aPreparer" && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "#f5f3ff", border: "1.5px solid #c4b5fd", borderRadius: 10, padding: "10px 14px" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#6d28d9" }}>🔄 Filtre actif : commandes à préparer (départ dans les 4 jours)</span>
                  <Btn variant="secondary" size="sm" onClick={() => setQuickFilter(null)}>✕ Retirer</Btn>
                </div>
              )}
              <Card>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ minWidth: 0 }}><Inp placeholder="🔍 Rechercher client ou N° devis..." value={searchQ} onChange={setSearchQ} /></div>
                  {view === "orders" && (
                    <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setQuickFilter(null); }} style={{ width: "100%", minWidth: 0, padding: "10px 12px", borderRadius: 10, border: filterStatus !== "Toutes" ? "2px solid #1a1a2e" : "1.5px solid #e5e7eb", background: "#fff", color: "#1a1a2e", fontWeight: 700, fontSize: 16, fontFamily: "inherit", cursor: "pointer", boxSizing: "border-box" }}>
                      <option value="Toutes">Toutes les commandes (hors devis/brouillons)</option>
                      {STATUS_FLOW.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </div>
              </Card>

              {filtered.length === 0 ? (
                <Card style={{ textAlign: "center", padding: 60 }}><div style={{ fontSize: 48, marginBottom: 12 }}>📭</div><div style={{ color: "#999", fontWeight: 600 }}>Aucune commande</div></Card>
              ) : filtered.map(order => {
                const total = orderTotal(order, settings);
                const reste = total - parseFloat(order.acompte || 0);
                const phaseLabel = order.phase === "retour" ? "Étape 2 · Retour" : order.phase === "termine" ? "Clôturée" : "Étape 1 · Livraison";
                const phaseColor = order.phase === "retour" ? "#c2410c" : order.phase === "termine" ? "#6b7280" : "#3b82f6";
                const isExp = expandedOrders.has(order.id);
                const orderShortage = !["Brouillon", "Devis", "Clôturée"].includes(order.status) ? stockShortage(order, orders, stock) : [];
                return (
                  <Card key={order.id}>
                    {orderShortage.length > 0 && (
                      <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "8px 12px", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 18 }}>⚠️</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#b91c1c" }}>
                          Article(s) manquant(s) : {orderShortage.map(s => `${s.name} (−${s.manque})`).join(", ")}
                        </span>
                      </div>
                    )}
                    <div onClick={() => toggleExpand(order.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: isExp ? 10 : 0, cursor: "pointer", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <span style={{ fontSize: 16, color: "#bbb", marginTop: 2, transform: isExp ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>▶</span>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 17, fontWeight: 900 }}>{order.clientName}</span>
                            <Badge status={order.status} />
                            {!["Clôturée", "Devis"].includes(order.status) && <span style={{ fontSize: 11, fontWeight: 800, color: phaseColor, background: phaseColor + "18", borderRadius: 8, padding: "2px 10px" }}>{phaseLabel}</span>}
                          </div>
                          <div style={{ fontSize: 12, color: "#666" }}>
                            <span style={{ fontFamily: "monospace", color: "#999" }}>{order.id}</span>
                            {order.deliveryDate && <span> · 📅 {fmtD(order.deliveryDate)}</span>}
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 20, fontWeight: 900 }}>{total.toFixed(2)} €</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: reste > 0 ? "#f59e0b" : "#10b981" }}>{reste > 0 ? `Reste : ${reste.toFixed(2)} €` : "✓ Soldé"}</div>
                        {parseFloat(order.acompte||0) > 0 && order.acompteMoyen && <div style={{ fontSize: 10, color: "#065f46", marginTop: 2 }}>Acompte {{ paypal: "💙 PayPal", virement: "🏦 Virement", especes: "💵 Espèces", cheque: "📄 Chèque", cb: "💳 CB" }[order.acompteMoyen]}</div>}
                        {order.cautionMoyen && <div style={{ fontSize: 10, color: "#6d28d9", marginTop: 1 }}>Caution {{ paypal: "💙 PayPal", virement: "🏦 Virement", especes: "💵 Espèces", cheque: "📄 Chèque", cb: "💳 CB" }[order.cautionMoyen]}</div>}
                      </div>
                    </div>
                    {isExp && (<>
                    <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#666", marginBottom: 10, flexWrap: "wrap" }}>
                      {order.address && <span>📍 {order.address}</span>}
                      {order.deliveryDate && <span>📅 {order.deliveryMode === "livraison" ? "Livr." : "Retrait"} : {fmtD(order.deliveryDate)}{order.deliveryTime ? ` à ${order.deliveryTime}` : ""}</span>}
                      {order.returnDate && <span>↩️ Retour : {fmtD(order.returnDate)}{order.returnTime ? ` à ${order.returnTime}` : ""}</span>}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                      {order.items.map(item => <span key={item.id} style={{ background: "#f4f5f7", borderRadius: 8, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>{item.icon} {item.name} × {item.qty}</span>)}
                    </div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
                      <Sel value={order.status} onChange={v => updateStatus(order.id, v)} options={STATUS_FLOW.map(s => ({ value: s, label: s }))} />
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {reste > 0 && order.status !== "Devis" && <Btn variant="success" size="sm" onClick={() => { setSoldeOrder(order); setSoldeMoyenSel("especes"); }}>💰 Encaisser le solde</Btn>}
                        <Btn variant="secondary" size="sm" onClick={() => sharePdf(order)}><span style={{ width: 14, height: 14 }}>{I.share}</span> Partager</Btn>
                        <Btn variant="secondary" size="sm" onClick={() => sharePdf(order, "facture")}>🧾 Facture</Btn>
                        <Btn variant="secondary" size="sm" onClick={() => setViewOrder(order)}><span style={{ width: 14, height: 14 }}>{I.eye}</span> Voir</Btn>
                        <Btn variant="secondary" size="sm" onClick={() => { setEditOrder(order); setShowForm(true); }}><span style={{ width: 14, height: 14 }}>{I.edit}</span> Modifier</Btn>
                        <Btn variant="danger" size="sm" onClick={() => deleteOrder(order.id)}><span style={{ width: 14, height: 14 }}>{I.trash}</span></Btn>
                      </div>
                    </div>
                    </>)}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editOrder ? "Modifier le devis" : "Nouveau devis"} wide>
        <OrderForm
          initial={editOrder}
          onSave={(order) => {
            // Si un brouillon avec cet ID existe déjà (créé par l'autosave), on le remplace au lieu d'en créer un nouveau.
            const brouillonExiste = orders.find(o => o.id === order.id);
            saveOrder(order, !!editOrder || !!brouillonExiste);
            if (!editOrder) setClients(prev => {
              if (prev.find(c => c.name === order.clientName && c.phone === order.clientPhone)) return prev;
              const phones = (order.clientPhones && order.clientPhones.length ? order.clientPhones : (order.clientPhone ? [order.clientPhone] : []));
              return [...prev, { id: "cli-" + Date.now(), name: order.clientName, phone: order.clientPhone, phones, email: order.clientEmail, address: order.address, notes: "" }];
            });
          }}
          onAutosave={(draft) => { setOrders(prev => { const ex = prev.find(o => o.id === draft.id); return ex ? prev.map(o => o.id === draft.id ? draft : o) : [draft, ...prev]; }); }}
          onClose={() => setShowForm(false)}
          allOrders={orders} clients={clients} settings={settings} stock={stock}
        />
      </Modal>

      <Modal open={!!soldeOrder} onClose={() => setSoldeOrder(null)} title="💰 Encaisser le solde">
        {soldeOrder && (() => {
          const tot = orderTotal(soldeOrder, settings);
          const resteASolder = tot - (parseFloat(soldeOrder.acompte) || 0);
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ background: "#f8f9ff", borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 13, color: "#666" }}>Client : <strong>{soldeOrder.clientName}</strong></div>
                <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>Total : {tot.toFixed(2)} € · Acompte versé : {(parseFloat(soldeOrder.acompte) || 0).toFixed(2)} €</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: "#f59e0b", marginTop: 6 }}>Reste à encaisser : {resteASolder.toFixed(2)} €</div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase", marginBottom: 6 }}>Moyen de paiement du solde</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                  {[{ v: "especes", l: "💵 Espèces" }, { v: "cb", l: "💳 CB" }, { v: "virement", l: "🏦 Virement" }, { v: "cheque", l: "📄 Chèque" }, { v: "paypal", l: "💙 PayPal" }].map(m => (
                    <button key={m.v} onClick={() => setSoldeMoyenSel(m.v)} style={{ padding: "12px", borderRadius: 10, border: "1.5px solid " + (soldeMoyenSel === m.v ? "#10b981" : "#e5e7eb"), background: soldeMoyenSel === m.v ? "#ecfdf5" : "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>{m.l}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Btn variant="secondary" onClick={() => setSoldeOrder(null)}>Annuler</Btn>
                <Btn variant="success" onClick={() => { encaisserSolde(soldeOrder.id, soldeMoyenSel); setSoldeOrder(null); }}>✅ Confirmer l'encaissement</Btn>
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal open={!!viewOrder} onClose={() => setViewOrder(null)} title="Fiche commande" wide>
        {viewOrder && <DeliverySheet order={viewOrder} settings={settings} onShare={sharePdf} stock={stock} onEncaisser={(o) => { setSoldeOrder(o); setSoldeMoyenSel("especes"); }} onDeletePhoto={deleteOrderPhoto} allOrders={orders} />}
      </Modal>
    </div>
    {ConfirmUI}
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
