import { useState, useMemo, useRef, useCallback } from "react";
import React from "react";

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

// ─── KITS VAISSELLE ───────────────────────────────────────────────────────────
const KITS = [
  {
    id: "kit_couvert_sale", name: "Kit Couvert Complet — Rendu Sale", icon: "🍽️", category: "Kits",
    description: "Grande assiette + Petite assiette + Fourchette + Couteau + Grande cuillère + Petite cuillère + Verre à pied",
    components: [
      { id: "grande_assiette", qty: 1 }, { id: "petite_assiette", qty: 1 },
      { id: "fourchette", qty: 1 }, { id: "couteau", qty: 1 },
      { id: "grande_cuillere", qty: 1 }, { id: "petite_cuillere", qty: 1 },
      { id: "verre_pied", qty: 1 },
    ],
    get price() { return this.components.reduce((s, c) => { const p = BASE_CATALOG.find(b => b.id === c.id); return s + (p ? p.price * c.qty : 0); }, 0) * 0.95; }, // 5% remise kit
    get coutAchat() { return this.components.reduce((s, c) => { const p = BASE_CATALOG.find(b => b.id === c.id); return s + (p ? p.coutAchat * c.qty : 0); }, 0); },
    unit: "couvert",
  },
  {
    id: "kit_couvert_propre", name: "Kit Couvert Complet — Rendu Propre", icon: "✨", category: "Kits",
    description: "Grande assiette + Petite assiette + Fourchette + Couteau + Grande cuillère + Petite cuillère + Verre à pied (retour lavé)",
    components: [
      { id: "grande_assiette", qty: 1 }, { id: "petite_assiette", qty: 1 },
      { id: "fourchette", qty: 1 }, { id: "couteau", qty: 1 },
      { id: "grande_cuillere", qty: 1 }, { id: "petite_cuillere", qty: 1 },
      { id: "verre_pied", qty: 1 },
    ],
    get price() { return this.components.reduce((s, c) => { const p = BASE_CATALOG.find(b => b.id === c.id); return s + (p ? p.price * c.qty : 0); }, 0) * 1.35; }, // +35% lavage
    get coutAchat() { return this.components.reduce((s, c) => { const p = BASE_CATALOG.find(b => b.id === c.id); return s + (p ? p.coutAchat * c.qty : 0); }, 0); },
    unit: "couvert",
  },
  {
    id: "kit_aperitif", name: "Kit Apéritif", icon: "🥂", category: "Kits",
    description: "Verre à pied + Petite assiette + Petite cuillère",
    components: [
      { id: "verre_pied", qty: 1 }, { id: "petite_assiette", qty: 1 }, { id: "petite_cuillere", qty: 1 },
    ],
    get price() { return this.components.reduce((s, c) => { const p = BASE_CATALOG.find(b => b.id === c.id); return s + (p ? p.price * c.qty : 0); }, 0) * 0.95; },
    get coutAchat() { return this.components.reduce((s, c) => { const p = BASE_CATALOG.find(b => b.id === c.id); return s + (p ? p.coutAchat * c.qty : 0); }, 0); },
    unit: "kit",
  },
];

const CATALOG = [
  ...BASE_CATALOG,
  ...KITS.map(k => ({ ...k, price: k.price, coutAchat: k.coutAchat })),
];

// ─── STOCK INITIAL ────────────────────────────────────────────────────────────
const INITIAL_STOCK = BASE_CATALOG.map(p => ({
  ...p,
  total: p.category === "Chaises" ? 200 : p.category === "Tables" ? 30 : p.category === "Vaisselle" ? 500 : p.category === "Linge" ? 80 : 10,
  seuil: p.category === "Chaises" ? 20 : p.category === "Tables" ? 5 : p.category === "Vaisselle" ? 50 : p.category === "Linge" ? 10 : 2,
  enMaintenance: 0,
}));

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const PRICE_PER_KM = 1.2;
const MIN_DELIVERY_PRICE = 15;
const MIN_DELIVERY_KM = 5;
const STATUS_FLOW = ["Devis", "Confirmée", "Préparée", "En livraison", "Livrée", "En cours", "Retour", "Clôturée"];
const STATUS_COLORS = { "Devis": "#f59e0b", "Confirmée": "#3b82f6", "Préparée": "#8b5cf6", "En livraison": "#f97316", "Livrée": "#10b981", "En cours": "#06b6d4", "Retour": "#ef4444", "Clôturée": "#6b7280" };
const EXPENSE_CATEGORIES = ["Achat matériel", "Maintenance / Réparation", "Carburant", "Loyer / Entrepôt", "Salaires", "Fournitures", "Assurance", "Autre"];
const CAT_COLORS = { "Achat matériel": "#3b82f6", "Maintenance / Réparation": "#8b5cf6", "Carburant": "#f97316", "Loyer / Entrepôt": "#ef4444", "Salaires": "#10b981", "Fournitures": "#f59e0b", "Assurance": "#06b6d4", "Autre": "#6b7280" };

// ─── NUMÉROTATION DEVIS : devNDDMMAA ─────────────────────────────────────────
function genDevisId(existingOrders) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const prefix = `dev`;
  const datePart = `${dd}${mm}${yy}`;
  // Compte combien de devis ont déjà été créés aujourd'hui
  const todayPrefix = `${prefix}`;
  const todayPattern = new RegExp(`^dev\\d+${dd}${mm}${yy}$`);
  const todayCount = existingOrders.filter(o => todayPattern.test(o.id)).length;
  return `${prefix}${todayCount + 1}${datePart}`;
}
function gId() { return "CMD-" + Date.now().toString(36).toUpperCase(); }
function calcDelivery(km) { if (km <= 0) return 0; if (km < MIN_DELIVERY_KM) return MIN_DELIVERY_PRICE; return Math.max(MIN_DELIVERY_PRICE, km * PRICE_PER_KM); }
function orderTotal(o) { const del = o.deliveryMode === "livraison" ? calcDelivery(parseFloat(o.deliveryKm) || 0) : 0; return o.items.reduce((s, i) => s + i.qty * i.price, 0) + del; }

// ─── DÉMO ─────────────────────────────────────────────────────────────────────
const TODAY = new Date().toISOString().split("T")[0];
const D = (n) => new Date(Date.now() + 86400000 * n).toISOString().split("T")[0];

const DEMO_ORDERS = [
  { id: "CMD-DEMO1", clientName: "Marie Leblanc", clientPhone: "0612345678", clientEmail: "marie@example.com", address: "24 Avenue des Fleurs, 69003 Lyon", deliveryMode: "livraison", deliveryKm: 12, deliveryDate: TODAY, deliveryTime: "09:00", returnDate: D(2), returnTime: "18:00", items: [{ ...CATALOG[0], qty: 50 }, { ...CATALOG[14], qty: 50 }, { ...CATALOG[12], qty: 2 }], acompte: 150, status: "En livraison", notes: "Mariage — décoration dorée" },
  { id: "CMD-DEMO2", clientName: "Pierre Martin", clientPhone: "0698765432", clientEmail: "pierre@example.com", address: "5 Rue du Commerce, 75015 Paris", deliveryMode: "retrait", deliveryKm: 0, deliveryDate: D(3), deliveryTime: "10:00", returnDate: D(5), returnTime: "", items: [{ ...CATALOG[1], qty: 30 }, { ...CATALOG[2], qty: 5 }], acompte: 0, status: "Confirmée", notes: "" },
  { id: "CMD-DEMO3", clientName: "Sophie Durand", clientPhone: "0711223344", clientEmail: "sophie@example.com", address: "8 Boulevard Victor Hugo, 06000 Nice", deliveryMode: "livraison", deliveryKm: 8, deliveryDate: D(7), deliveryTime: "14:00", returnDate: D(9), returnTime: "17:00", items: [{ ...CATALOG[0], qty: 100 }, { ...CATALOG[17], qty: 100 }, { ...CATALOG[12], qty: 4 }, { ...CATALOG[13], qty: 10 }], acompte: 300, status: "Devis", notes: "Anniversaire 50 ans" },
];

const DEMO_EXPENSES = [
  { id: "DEP-1", date: D(-5), label: "Achat 50 chaises Napoléon", category: "Achat matériel", amount: 400, supplier: "Déco Events SARL", paymentMethod: "Virement", notes: "", linkedItemId: "chaise_napoleon", linkedQty: 50 },
  { id: "DEP-2", date: D(-12), label: "Réparation réchauffe-plats", category: "Maintenance / Réparation", amount: 85, supplier: "Électro Service", paymentMethod: "CB", notes: "3 appareils réparés", linkedItemId: "", linkedQty: 0 },
  { id: "DEP-3", date: D(-20), label: "Loyer entrepôt — Juin", category: "Loyer / Entrepôt", amount: 650, supplier: "SCI Dupont", paymentMethod: "Virement", notes: "", linkedItemId: "", linkedQty: 0 },
  { id: "DEP-4", date: D(-2), label: "Carburant livraisons", category: "Carburant", amount: 95, supplier: "Total", paymentMethod: "CB", notes: "", linkedItemId: "", linkedQty: 0 },
];

// ─── BIBLIOTHÈQUE CLIENTS ─────────────────────────────────────────────────────
const DEMO_CLIENTS = [
  { id: "cli-1", name: "Marie Leblanc", phone: "0612345678", email: "marie@example.com", address: "24 Avenue des Fleurs, 69003 Lyon", notes: "Préfère livraison matin" },
  { id: "cli-2", name: "Pierre Martin", phone: "0698765432", email: "pierre@example.com", address: "5 Rue du Commerce, 75015 Paris", notes: "" },
  { id: "cli-3", name: "Sophie Durand", phone: "0711223344", email: "sophie@example.com", address: "8 Boulevard Victor Hugo, 06000 Nice", notes: "Anniversaire récurrent chaque juin" },
];

// ─── PDF GÉNÉRATION (jsPDF via CDN, chargé dynamiquement) ────────────────────
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

function buildPdfBlob(order) {
  return new Promise(async (resolve) => {
    const JsPDF = await loadJsPDF();
    const doc = new JsPDF({ unit: "mm", format: "a4" });
    const del = order.deliveryMode === "livraison" ? calcDelivery(parseFloat(order.deliveryKm) || 0) : 0;
    const subtotal = order.items.reduce((s, i) => s + i.qty * i.price, 0);
    const total = subtotal + del;
    const acompte = parseFloat(order.acompte || 0);
    const reste = total - acompte;
    const W = 210, m = 16;

    // Fond header
    doc.setFillColor(26, 26, 46);
    doc.rect(0, 0, W, 40, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20); doc.setFont("helvetica", "bold");
    doc.text("Location Pro", m, 16);
    doc.setFontSize(10); doc.setFont("helvetica", "normal");
    doc.text("Devis / Bon de commande", m, 23);

    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text(order.id, W - m, 16, { align: "right" });
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    const dateStr = new Date().toLocaleDateString("fr-FR");
    doc.text(`Émis le ${dateStr}`, W - m, 23, { align: "right" });

    // Badge statut
    doc.setFillColor(245, 158, 11);
    doc.roundedRect(W - m - 30, 27, 30, 8, 2, 2, "F");
    doc.setTextColor(255,255,255); doc.setFontSize(8); doc.setFont("helvetica","bold");
    doc.text(order.status, W - m - 15, 32.5, { align: "center" });

    // Info client
    doc.setTextColor(50, 50, 50);
    doc.setFontSize(11); doc.setFont("helvetica", "bold");
    doc.text("Client", m, 52);
    doc.setFontSize(10); doc.setFont("helvetica", "normal");
    doc.text(order.clientName, m, 59);
    if (order.clientPhone) doc.text(`Tél : ${order.clientPhone}`, m, 65);
    if (order.clientEmail) doc.text(`Email : ${order.clientEmail}`, m, 71);
    if (order.address) { const lines = doc.splitTextToSize(`Adresse : ${order.address}`, 85); doc.text(lines, m, 77); }

    // Info prestation
    doc.setFontSize(11); doc.setFont("helvetica", "bold");
    doc.text("Prestation", 115, 52);
    doc.setFontSize(10); doc.setFont("helvetica", "normal");
    doc.text(order.deliveryMode === "livraison" ? "Livraison à domicile" : "Retrait entrepôt", 115, 59);
    if (order.deliveryDate) doc.text(`Date : ${order.deliveryDate}${order.deliveryTime ? " à " + order.deliveryTime : ""}`, 115, 65);
    if (order.returnDate) doc.text(`Retour : ${order.returnDate}${order.returnTime ? " à " + order.returnTime : ""}`, 115, 71);

    // Ligne séparateur
    doc.setDrawColor(220, 220, 220);
    doc.line(m, 88, W - m, 88);

    // Tableau articles
    let y = 95;
    doc.setFillColor(240, 244, 255);
    doc.rect(m, y - 6, W - 2 * m, 8, "F");
    doc.setTextColor(100, 100, 120); doc.setFontSize(8); doc.setFont("helvetica", "bold");
    doc.text("ARTICLE", m + 2, y - 0.5);
    doc.text("QTÉ", 130, y - 0.5, { align: "center" });
    doc.text("P.U. (€)", 158, y - 0.5, { align: "center" });
    doc.text("TOTAL (€)", W - m - 2, y - 0.5, { align: "right" });
    y += 5;

    doc.setTextColor(30, 30, 30); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    order.items.forEach((item, idx) => {
      if (idx % 2 === 0) { doc.setFillColor(250, 250, 252); doc.rect(m, y - 5, W - 2 * m, 7, "F"); }
      doc.text(item.name, m + 2, y);
      if (item.description) { doc.setFontSize(7); doc.setTextColor(160,160,160); doc.text(`↳ ${item.description}`, m + 2, y + 3.5); doc.setTextColor(30,30,30); doc.setFontSize(9); y += 3.5; }
      doc.text(String(item.qty), 130, y, { align: "center" });
      doc.text(item.price.toFixed(2), 158, y, { align: "center" });
      doc.text((item.qty * item.price).toFixed(2), W - m - 2, y, { align: "right" });
      y += 8;
    });

    if (del > 0) {
      doc.setFillColor(245, 247, 250); doc.rect(m, y - 5, W - 2 * m, 7, "F");
      doc.text("Livraison", m + 2, y);
      doc.text("1", 130, y, { align: "center" });
      doc.text(del.toFixed(2), 158, y, { align: "center" });
      doc.text(del.toFixed(2), W - m - 2, y, { align: "right" });
      y += 8;
    }

    // Totaux
    y += 4;
    doc.setDrawColor(220,220,220); doc.line(m, y, W - m, y); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text("Sous-total HT", W - m - 60, y); doc.text(`${subtotal.toFixed(2)} €`, W - m, y, { align: "right" }); y += 7;
    if (del > 0) { doc.text("Livraison", W - m - 60, y); doc.text(`${del.toFixed(2)} €`, W - m, y, { align: "right" }); y += 7; }
    if (acompte > 0) { doc.setTextColor(16,185,129); doc.text("Acompte versé", W - m - 60, y); doc.text(`- ${acompte.toFixed(2)} €`, W - m, y, { align: "right" }); doc.setTextColor(30,30,30); y += 7; }

    doc.setFillColor(26, 26, 46);
    doc.rect(m, y - 5, W - 2 * m, 10, "F");
    doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(11);
    doc.text("SOLDE À PAYER", m + 4, y + 2);
    doc.text(`${reste.toFixed(2)} €`, W - m - 2, y + 2, { align: "right" });
    y += 16;

    // Notes
    if (order.notes) {
      doc.setTextColor(100,100,100); doc.setFont("helvetica","italic"); doc.setFontSize(9);
      doc.text(`Notes : ${order.notes}`, m, y);
      y += 8;
    }

    // Pied de page
    doc.setDrawColor(220,220,220); doc.line(m, 275, W - m, 275);
    doc.setTextColor(160,160,160); doc.setFont("helvetica","normal"); doc.setFontSize(8);
    doc.text("Location Pro — Document généré automatiquement", W / 2, 281, { align: "center" });

    resolve(doc.output("blob"));
  });
}

// ─── GOOGLE DRIVE API ─────────────────────────────────────────────────────────
const GDRIVE_CLIENT_ID = "VOTRE_CLIENT_ID_GOOGLE"; // À remplacer dans les paramètres
const GDRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

async function uploadToDrive(blob, filename, accessToken) {
  const meta = JSON.stringify({ name: filename, mimeType: "application/pdf" });
  const form = new FormData();
  form.append("metadata", new Blob([meta], { type: "application/json" }));
  form.append("file", blob);
  const resp = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
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
  chat: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
  map: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>,
  trend: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  star: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  alert: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
};

// ─── UI BASE ──────────────────────────────────────────────────────────────────
function Badge({ status }) {
  return <span style={{ background: STATUS_COLORS[status] + "22", color: STATUS_COLORS[status], border: `1px solid ${STATUS_COLORS[status]}55`, padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{status}</span>;
}

function Card({ children, style, onClick }) {
  return (
    <div onClick={onClick} style={{ background: "#fff", borderRadius: 16, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", padding: 20, border: "1px solid #f0f0f0", cursor: onClick ? "pointer" : undefined, transition: "box-shadow 0.18s", ...style }}
      onMouseEnter={e => onClick && (e.currentTarget.style.boxShadow = "0 4px 24px rgba(0,0,0,0.13)")}
      onMouseLeave={e => onClick && (e.currentTarget.style.boxShadow = "0 2px 16px rgba(0,0,0,0.07)")}
    >{children}</div>
  );
}

function Btn({ children, onClick, variant = "primary", size = "md", style, disabled }) {
  const sz = { sm: { padding: "6px 14px", fontSize: 13 }, md: { padding: "10px 20px", fontSize: 14 }, lg: { padding: "14px 28px", fontSize: 16 } }[size];
  const vr = { primary: { background: "#1a1a2e", color: "#fff" }, secondary: { background: "#f4f4f8", color: "#333" }, danger: { background: "#fee2e2", color: "#dc2626" }, success: { background: "#d1fae5", color: "#065f46" }, ghost: { background: "transparent", color: "#666" }, warning: { background: "#fef9c3", color: "#92400e" } }[variant];
  return <button disabled={disabled} onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "none", borderRadius: 10, cursor: disabled ? "not-allowed" : "pointer", fontWeight: 700, fontFamily: "inherit", transition: "all 0.15s", opacity: disabled ? 0.5 : 1, ...sz, ...vr, ...style }}>{children}</button>;
}

function Inp({ label, value, onChange, type = "text", placeholder, required, min, step, suffix }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && <label style={{ fontSize: 12, fontWeight: 700, color: "#666", letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}{required && <span style={{ color: "#ef4444" }}> *</span>}</label>}
      <div style={{ position: "relative" }}>
        <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} min={min} step={step}
          style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 14, fontFamily: "inherit", background: "#fafafa", boxSizing: "border-box", paddingRight: suffix ? 36 : 14, outline: "none" }}
          onFocus={e => e.target.style.borderColor = "#1a1a2e"} onBlur={e => e.target.style.borderColor = "#e5e7eb"} />
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

function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: 28, width: "100%", maxWidth: wide ? 780 : 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.22)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{title}</h2>
          <Btn variant="ghost" onClick={onClose} style={{ width: 32, height: 32, padding: 0, borderRadius: 8 }}><span style={{ width: 18, height: 18, display: "block" }}>{I.x}</span></Btn>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── SECTION : HEURE SOUHAITÉE ────────────────────────────────────────────────
function TimeInput({ label, value, onChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: "#666", letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</label>
      <input type="time" value={value || ""} onChange={e => onChange(e.target.value)}
        style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 14, fontFamily: "inherit", background: "#fafafa", outline: "none" }}
        onFocus={e => e.target.style.borderColor = "#1a1a2e"} onBlur={e => e.target.style.borderColor = "#e5e7eb"} />
    </div>
  );
}

// ─── BIBLIOTHÈQUE CLIENTS ─────────────────────────────────────────────────────
function ClientLibrary({ clients, setClients, onSelect, onClose }) {
  const [search, setSearch] = useState("");
  const [addMode, setAddMode] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", notes: "" });
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search) ||
    c.email.toLowerCase().includes(search.toLowerCase())
  );

  const save = () => {
    if (!form.name.trim()) { alert("Nom requis"); return; }
    setClients(prev => [...prev, { ...form, id: "cli-" + Date.now() }]);
    setForm({ name: "", phone: "", email: "", address: "", notes: "" });
    setAddMode(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {!addMode ? (
        <>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><Inp placeholder="🔍 Rechercher un client..." value={search} onChange={setSearch} /></div>
            <Btn variant="secondary" size="sm" onClick={() => setAddMode(true)}><span style={{ width: 14, height: 14 }}>{I.plus}</span> Nouveau</Btn>
          </div>
          <div style={{ maxHeight: 420, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.length === 0 ? (
              <div style={{ textAlign: "center", padding: 30, color: "#999" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>👤</div>
                <div>Aucun client trouvé</div>
              </div>
            ) : filtered.map(client => (
              <div key={client.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#f8f9fa", borderRadius: 12, border: "1.5px solid #f0f0f0", transition: "all 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "#3b82f6"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "#f0f0f0"}
              >
                <div style={{ width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg, #1a1a2e, #3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: 16, flexShrink: 0 }}>
                  {client.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 14 }}>{client.name}</div>
                  <div style={{ fontSize: 12, color: "#666" }}>{client.phone}{client.email ? ` · ${client.email}` : ""}</div>
                  {client.address && <div style={{ fontSize: 11, color: "#999", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📍 {client.address}</div>}
                  {client.notes && <div style={{ fontSize: 11, color: "#f59e0b" }}>💡 {client.notes}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <Btn variant="primary" size="sm" onClick={() => { onSelect(client); onClose(); }}>Sélectionner</Btn>
                  <Btn variant="danger" size="sm" onClick={() => { if (window.confirm(`Supprimer ${client.name} ?`)) setClients(prev => prev.filter(c => c.id !== client.id)); }}>
                    <span style={{ width: 13, height: 13 }}>{I.trash}</span>
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>➕ Nouveau client</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Inp label="Nom complet *" value={form.name} onChange={v => setF("name", v)} placeholder="Jean Dupont" required />
            <Inp label="Téléphone" value={form.phone} onChange={v => setF("phone", v)} placeholder="06 xx xx xx xx" />
            <Inp label="Email" value={form.email} onChange={v => setF("email", v)} placeholder="jean@email.com" />
            <Inp label="Adresse" value={form.address} onChange={v => setF("address", v)} placeholder="12 rue de la Paix, Paris" />
          </div>
          <Inp label="Notes" value={form.notes} onChange={v => setF("notes", v)} placeholder="Préférences, habitudes..." />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="secondary" onClick={() => setAddMode(false)}>Annuler</Btn>
            <Btn variant="primary" onClick={save}><span style={{ width: 14, height: 14 }}>{I.check}</span> Enregistrer</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PARAMÈTRES GOOGLE DRIVE ──────────────────────────────────────────────────
function DriveSettings({ driveToken, setDriveToken, clientId, setClientId }) {
  const [localId, setLocalId] = useState(clientId || "");
  const [status, setStatus] = useState("idle"); // idle | loading | ok | error

  const connect = async () => {
    if (!localId.trim()) { alert("Entrez votre Client ID Google"); return; }
    setClientId(localId.trim());
    setStatus("loading");
    try {
      await new Promise((resolve, reject) => {
        if (!window.google) {
          const s = document.createElement("script");
          s.src = "https://accounts.google.com/gsi/client";
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        } else resolve();
      });
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: localId.trim(),
        scope: GDRIVE_SCOPE,
        callback: (resp) => {
          if (resp.error) { setStatus("error"); return; }
          setDriveToken(resp.access_token);
          setStatus("ok");
        },
      });
      client.requestAccessToken();
    } catch { setStatus("error"); }
  };

  const disconnect = () => { setDriveToken(null); setStatus("idle"); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ background: "linear-gradient(135deg, #1a1a2e, #16213e)", color: "#fff", borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 22, marginBottom: 8 }}>☁️</div>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Synchronisation Google Drive</div>
        <div style={{ opacity: 0.7, fontSize: 13 }}>Les devis sont sauvegardés automatiquement en PDF dans votre Google Drive à chaque création.</div>
      </div>

      {driveToken ? (
        <div style={{ background: "#d1fae5", borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 800, color: "#065f46", marginBottom: 6 }}>✅ Google Drive connecté</div>
          <div style={{ fontSize: 13, color: "#064e3b", marginBottom: 12 }}>Les devis seront automatiquement sauvegardés en PDF.</div>
          <Btn variant="danger" onClick={disconnect}>Se déconnecter</Btn>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: "#fef9c3", borderRadius: 10, padding: 14, fontSize: 13, lineHeight: 1.6 }}>
            <strong>Comment configurer :</strong><br/>
            1. Allez sur <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" style={{ color: "#1d4ed8" }}>console.cloud.google.com</a><br/>
            2. Créez un projet → APIs &amp; Services → Identifiants<br/>
            3. Créez un ID client OAuth 2.0 (type : Application Web)<br/>
            4. Ajoutez l'origine autorisée : <code style={{ background: "#f0f0f0", padding: "1px 4px", borderRadius: 4 }}>{window.location.origin}</code><br/>
            5. Copiez le Client ID ci-dessous
          </div>
          <Inp label="Google Client ID" value={localId} onChange={setLocalId} placeholder="xxxxx.apps.googleusercontent.com" />
          <Btn variant="primary" onClick={connect} disabled={status === "loading"}>
            {status === "loading" ? "⏳ Connexion..." : "☁️ Connecter Google Drive"}
          </Btn>
          {status === "error" && <div style={{ color: "#ef4444", fontSize: 13 }}>❌ Erreur de connexion. Vérifiez votre Client ID et l'origine autorisée.</div>}
        </div>
      )}
    </div>
  );
}

// ─── FORMULAIRE COMMANDE ──────────────────────────────────────────────────────
function OrderForm({ initial, onSave, onClose, allOrders, clients, driveToken }) {
  const empty = {
    id: genDevisId(allOrders || []),
    clientName: "", clientPhone: "", clientEmail: "", address: "",
    deliveryMode: "retrait", deliveryKm: 0, deliveryDate: "", deliveryTime: "",
    returnDate: "", returnTime: "", items: [], acompte: 0, status: "Devis", notes: ""
  };
  const [form, setForm] = useState(initial || empty);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("articles");
  const [errors, setErrors] = useState({});
  const [showClientLib, setShowClientLib] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // null | "ok" | "error" | "nodrive"
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: undefined })); }

  const applyClient = (client) => {
    setForm(f => ({ ...f, clientName: client.name, clientPhone: client.phone, clientEmail: client.email, address: client.address }));
    setErrors(e => ({ ...e, clientName: undefined, address: undefined }));
  };

  const deliveryCost = form.deliveryMode === "livraison" ? calcDelivery(parseFloat(form.deliveryKm) || 0) : 0;
  const total = form.items.reduce((s, i) => s + i.qty * i.price, 0) + deliveryCost;
  const reste = total - (parseFloat(form.acompte) || 0);

  const addItem = (product) => {
    const existing = form.items.find(i => i.id === product.id);
    if (existing) set("items", form.items.map(i => i.id === product.id ? { ...i, qty: i.qty + 1 } : i));
    else set("items", [...form.items, { ...product, price: product.price, qty: 1 }]);
  };
  // Allows empty string while typing so user can clear field and type a new number
  const updQty = (id, rawVal) => {
    if (rawVal === "" || rawVal === "0") { set("items", form.items.filter(i => i.id !== id)); return; }
    const qty = parseInt(rawVal);
    if (isNaN(qty) || qty <= 0) { set("items", form.items.filter(i => i.id !== id)); return; }
    set("items", form.items.map(i => i.id === id ? { ...i, qty } : i));
  };

  const validate = () => {
    const e = {};
    if (!form.clientName.trim()) e.clientName = "Le nom du client est obligatoire";
    if (!form.deliveryDate) e.deliveryDate = "La date de retrait / livraison est obligatoire";
    if (!form.returnDate) e.returnDate = "La date de retour est obligatoire";
    if (form.items.length === 0) e.items = "Ajoutez au moins un article";
    if (form.deliveryMode === "livraison" && !form.address.trim()) e.address = "L'adresse est obligatoire pour une livraison";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const allCatalog = CATALOG;
  const filtered = allCatalog.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) && (activeTab === "kits" ? c.category === "Kits" : activeTab === "articles" ? c.category !== "Kits" : true));
  const cats = [...new Set(filtered.map(c => c.category))];

  const ErrMsg = ({ field }) => errors[field] ? <div style={{ color: "#ef4444", fontSize: 12, marginTop: 3, fontWeight: 600 }}>⚠ {errors[field]}</div> : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Bandeau erreurs global */}
      {Object.keys(errors).length > 0 && (
        <div style={{ background: "#fee2e2", border: "1.5px solid #fca5a5", borderRadius: 12, padding: "12px 16px" }}>
          <div style={{ fontWeight: 800, color: "#dc2626", marginBottom: 6, fontSize: 14 }}>⚠️ Champs obligatoires manquants :</div>
          {Object.values(errors).map((msg, i) => <div key={i} style={{ fontSize: 13, color: "#b91c1c" }}>• {msg}</div>)}
        </div>
      )}

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "#999", textTransform: "uppercase" }}>👤 Client</h3>
          <Btn variant="secondary" size="sm" onClick={() => setShowClientLib(true)}>📋 Choisir un client</Btn>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <Inp label="Nom complet" value={form.clientName} onChange={v => set("clientName", v)} placeholder="Jean Dupont" required />
            <ErrMsg field="clientName" />
          </div>
          <Inp label="Téléphone" value={form.clientPhone} onChange={v => set("clientPhone", v)} placeholder="06 xx xx xx xx" />
          <Inp label="Email" value={form.clientEmail} onChange={v => set("clientEmail", v)} placeholder="jean@email.com" />
          <div>
            <Inp label="Adresse" value={form.address} onChange={v => set("address", v)} placeholder="12 rue de la Paix, 75001 Paris" />
            <ErrMsg field="address" />
          </div>
        </div>
      </div>

      <div>
        <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: "#999", textTransform: "uppercase" }}>🚚 Livraison & Horaires</h3>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          {["retrait", "livraison"].map(m => (
            <button key={m} onClick={() => set("deliveryMode", m)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "2px solid", borderColor: form.deliveryMode === m ? "#1a1a2e" : "#e5e7eb", background: form.deliveryMode === m ? "#1a1a2e" : "#fafafa", color: form.deliveryMode === m ? "#fff" : "#666", fontWeight: 700, cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>
              {m === "retrait" ? "🏪 Retrait entrepôt" : "🚚 Livraison à domicile"}
            </button>
          ))}
        </div>
        {form.deliveryMode === "livraison" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <Inp label="Distance (km)" type="number" value={form.deliveryKm} onChange={v => set("deliveryKm", v)} min="0" step="0.1" suffix="km" />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase" }}>Coût livraison</label>
              <div style={{ padding: "10px 14px", borderRadius: 10, background: "#f0fdf4", fontWeight: 800, fontSize: 16, color: "#065f46" }}>{deliveryCost.toFixed(2)} €</div>
            </div>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
          <div>
            <Inp label={form.deliveryMode === "livraison" ? "Date livraison" : "Date retrait"} type="date" value={form.deliveryDate} onChange={v => set("deliveryDate", v)} required />
            <ErrMsg field="deliveryDate" />
          </div>
          <TimeInput label="Heure souhaitée" value={form.deliveryTime} onChange={v => set("deliveryTime", v)} />
          <div>
            <Inp label="Date de retour" type="date" value={form.returnDate} onChange={v => set("returnDate", v)} required />
            <ErrMsg field="returnDate" />
          </div>
          <TimeInput label="Heure retour" value={form.returnTime} onChange={v => set("returnTime", v)} />
        </div>
      </div>

      <div>
        <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: "#999", textTransform: "uppercase" }}>📦 Matériel</h3>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {[{ id: "articles", label: "🪑 Articles" }, { id: "kits", label: "🎁 Kits Vaisselle" }].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ padding: "7px 16px", borderRadius: 10, border: "2px solid", borderColor: activeTab === t.id ? "#1a1a2e" : "#e5e7eb", background: activeTab === t.id ? "#1a1a2e" : "#fff", color: activeTab === t.id ? "#fff" : "#666", fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>{t.label}</button>
          ))}
        </div>
        <Inp placeholder="🔍 Rechercher..." value={search} onChange={setSearch} />
        <div style={{ marginTop: 10, maxHeight: 240, overflowY: "auto", border: "1.5px solid #f0f0f0", borderRadius: 12 }}>
          {cats.map(cat => (
            <div key={cat}>
              <div style={{ padding: "7px 14px", background: "#f8f8f8", fontSize: 11, fontWeight: 800, color: "#999", textTransform: "uppercase" }}>{cat}</div>
              {filtered.filter(c => c.category === cat).map(product => {
                const inCart = form.items.find(i => i.id === product.id);
                return (
                  <div key={product.id} style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid #f4f4f4", gap: 10 }}>
                    <span style={{ fontSize: 20 }}>{product.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{product.name}</div>
                      {product.description && <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{product.description}</div>}
                      <div style={{ fontSize: 12, color: "#10b981", fontWeight: 700 }}>{product.price.toFixed(2)} € / {product.unit}</div>
                    </div>
                    {inCart ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <button onClick={() => updQty(product.id, String(inCart.qty - 1))} style={{ width: 28, height: 28, borderRadius: 8, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 16, flexShrink: 0 }}>−</button>
                        <input
                          type="number" min="1" value={inCart.qty}
                          onChange={e => {
                            const raw = e.target.value;
                            if (raw === "") { set("items", form.items.map(i => i.id === product.id ? { ...i, qty: "" } : i)); return; }
                            const v = parseInt(raw);
                            if (!isNaN(v) && v >= 1) set("items", form.items.map(i => i.id === product.id ? { ...i, qty: v } : i));
                            else if (!isNaN(v) && v <= 0) set("items", form.items.filter(i => i.id !== product.id));
                          }}
                          onBlur={e => { if (!inCart.qty || inCart.qty === "") set("items", form.items.filter(i => i.id !== product.id)); }}
                          onFocus={e => e.target.select()}
                          style={{ width: 54, height: 30, borderRadius: 8, border: "1.5px solid #1a1a2e", textAlign: "center", fontWeight: 800, fontSize: 14, fontFamily: "inherit", background: "#f0f4ff", outline: "none" }}
                        />
                        <button onClick={() => set("items", form.items.map(i => i.id === product.id ? { ...i, qty: (parseInt(i.qty)||0) + 1 } : i))} style={{ width: 28, height: 28, borderRadius: 8, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 16, flexShrink: 0 }}>+</button>
                      </div>
                    ) : (
                      <Btn variant="secondary" size="sm" onClick={() => addItem(product)}><span style={{ width: 14, height: 14 }}>{I.plus}</span> Ajouter</Btn>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <ErrMsg field="items" />
      </div>

      {form.items.length > 0 && (
        <div style={{ background: "#f8f9fa", borderRadius: 12, padding: 16 }}>
          <h4 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 800 }}>📋 Récapitulatif</h4>
          {form.items.map(item => (
            <div key={item.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
              <span>{item.icon} {item.name} × {item.qty}</span>
              <span style={{ fontWeight: 700 }}>{(item.qty * item.price).toFixed(2)} €</span>
            </div>
          ))}
          {deliveryCost > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#666" }}><span>🚚 Livraison</span><span>{deliveryCost.toFixed(2)} €</span></div>}
          <div style={{ borderTop: "1.5px solid #e5e7eb", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 16 }}><span>Total</span><span>{total.toFixed(2)} €</span></div>
        </div>
      )}

      <div>
        <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: "#999", textTransform: "uppercase" }}>💶 Paiement</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <Inp label="Acompte versé (€)" type="number" value={form.acompte} onChange={v => set("acompte", v)} min="0" step="0.01" />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase" }}>Total</label>
            <div style={{ padding: "10px 14px", borderRadius: 10, background: "#f0f4ff", fontWeight: 800, fontSize: 16, color: "#1a1a2e" }}>{total.toFixed(2)} €</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase" }}>Reste à payer</label>
            <div style={{ padding: "10px 14px", borderRadius: 10, background: reste > 0 ? "#fff7ed" : "#f0fdf4", fontWeight: 800, fontSize: 16, color: reste > 0 ? "#c2410c" : "#065f46" }}>{reste.toFixed(2)} €</div>
          </div>
        </div>
      </div>
      <Inp label="Notes internes" value={form.notes} onChange={v => set("notes", v)} placeholder="Informations complémentaires..." />

      {/* ID du devis */}
      <div style={{ background: "#f0f4ff", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "#6b7280" }}>Référence devis</span>
        <span style={{ fontFamily: "monospace", fontWeight: 800, color: "#1a1a2e", fontSize: 14 }}>{form.id}</span>
      </div>

      {saveStatus === "ok" && <div style={{ background: "#d1fae5", borderRadius: 10, padding: "10px 14px", color: "#065f46", fontWeight: 700, fontSize: 13 }}>✅ Devis sauvegardé en PDF sur Google Drive</div>}
      {saveStatus === "nodrive" && <div style={{ background: "#fef9c3", borderRadius: 10, padding: "10px 14px", color: "#92400e", fontWeight: 700, fontSize: 13 }}>⚠️ Devis enregistré localement — connectez Google Drive dans Paramètres pour la sauvegarde cloud.</div>}
      {saveStatus === "error" && <div style={{ background: "#fee2e2", borderRadius: 10, padding: "10px 14px", color: "#dc2626", fontWeight: 700, fontSize: 13 }}>❌ Erreur lors de la sauvegarde PDF. Devis enregistré localement.</div>}

      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <Btn variant="secondary" onClick={onClose}>Annuler</Btn>
        <Btn variant="primary" disabled={saving} onClick={async () => {
          if (!validate()) return;
          setSaving(true);
          setSaveStatus(null);
          onSave(form);
          // Générer et uploader le PDF
          try {
            const blob = await buildPdfBlob(form);
            // Téléchargement local toujours disponible
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = `${form.id}.pdf`; a.click();
            URL.revokeObjectURL(url);
            // Upload Drive si token disponible
            if (driveToken) {
              await uploadToDrive(blob, `${form.id}.pdf`, driveToken);
              setSaveStatus("ok");
            } else {
              setSaveStatus("nodrive");
            }
          } catch (err) {
            console.error(err);
            setSaveStatus("error");
          }
          setSaving(false);
          if (!driveToken) setTimeout(onClose, 2000);
          else setTimeout(onClose, 1500);
        }}>
          <span style={{ width: 16, height: 16 }}>{saving ? "⏳" : I.check}</span>
          {saving ? "Génération PDF..." : "Enregistrer + PDF"}
        </Btn>
      </div>

      {/* Modal bibliothèque clients */}
      <Modal open={showClientLib} onClose={() => setShowClientLib(false)} title="📋 Bibliothèque clients" wide>
        <ClientLibrary clients={clients || []} setClients={() => {}} onSelect={applyClient} onClose={() => setShowClientLib(false)} />
      </Modal>
    </div>
  );
}

// ─── SIGNATURE PAD (composant autonome, compatible tactile tous écrans) ────────
function SignaturePad({ onSave, onClose, title }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
  };
  const start = (e) => { e.preventDefault(); drawing.current = true; lastPos.current = getPos(e, canvasRef.current); };
  const move = (e) => {
    e.preventDefault();
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const pos = getPos(e, canvas);
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#1a1a2e"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.stroke();
    lastPos.current = pos;
  };
  const stop = (e) => { e.preventDefault(); drawing.current = false; };
  const clear = () => { const c = canvasRef.current; c.getContext("2d").clearRect(0, 0, c.width, c.height); };
  const save = () => { onSave(canvasRef.current.toDataURL("image/png")); onClose(); };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 480, boxShadow: "0 24px 64px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>✍️ {title}</h3>
          <Btn variant="ghost" onClick={onClose} style={{ padding: 6 }}><span style={{ width: 20, height: 20 }}>{I.x}</span></Btn>
        </div>
        <div style={{ fontSize: 12, color: "#999", marginBottom: 10, textAlign: "center" }}>Signez avec votre doigt ou stylet</div>
        <div style={{ border: "2px solid #1a1a2e", borderRadius: 12, overflow: "hidden", background: "#fafafa", marginBottom: 14, touchAction: "none" }}>
          <canvas ref={canvasRef} width={800} height={280}
            style={{ width: "100%", height: 180, display: "block", touchAction: "none" }}
            onMouseDown={start} onMouseMove={move} onMouseUp={stop} onMouseLeave={stop}
            onTouchStart={start} onTouchMove={move} onTouchEnd={stop}
          />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn variant="secondary" onClick={clear} style={{ flex: 1 }}>🗑️ Effacer</Btn>
          <Btn variant="primary" onClick={save} style={{ flex: 1 }}><span style={{ width: 16, height: 16 }}>{I.check}</span> Valider</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── FICHE LIVREUR ────────────────────────────────────────────────────────────
function DeliverySheet({ order }) {
  const [phoneModal, setPhoneModal] = useState(false);
  const [addressModal, setAddressModal] = useState(false);
  const [activeTab, setActiveTab] = useState("fiche");
  const [materialChecks, setMaterialChecks] = useState(() =>
    Object.fromEntries((order.items || []).map(i => [i.id, false]))
  );
  const [payChecks, setPayChecks] = useState({
    acompteRecu: !!parseFloat(order.acompte || 0),
    soldeRecu: false, reçuRemis: false,
    cautionChèque: false, cautionPaypal: false, cautionCNI: false, cautionAutre: false,
    cautionMontant: "", cautionNote: "",
  });
  const [bonSigned, setBonSigned] = useState(false);
  const [bonClientName, setBonClientName] = useState("");
  const [bonReserves, setBonReserves] = useState("");
  const [showSigModal, setShowSigModal] = useState(null);
  const [sigLivreur, setSigLivreur] = useState(null);
  const [sigClient, setSigClient] = useState(null);

  const deliveryCost = order.deliveryMode === "livraison" ? calcDelivery(parseFloat(order.deliveryKm) || 0) : 0;
  const total = (order.items || []).reduce((s, i) => s + i.qty * i.price, 0) + deliveryCost;
  const reste = total - (parseFloat(order.acompte) || 0);
  const phone = (order.clientPhone || "").replace(/\s/g, "");
  const addr = encodeURIComponent(order.address || "");

  const toggleMat = (id) => setMaterialChecks(c => ({ ...c, [id]: !c[id] }));
  const setPay = (k, v) => setPayChecks(c => ({ ...c, [k]: v }));
  const checkedCount = Object.values(materialChecks).filter(Boolean).length;
  const materialDone = (order.items || []).length > 0 && checkedCount === (order.items || []).length;

  const tabs = [
    { id: "fiche", label: "📋 Fiche" },
    { id: "checklist", label: `✅ Matériel (${checkedCount}/${(order.items||[]).length})` },
    { id: "paiement", label: "💶 Paiement" },
    { id: "bon", label: "✍️ Bon" },
  ];

  const CheckBox = ({ checked, onToggle, color = "#10b981" }) => (
    <div onClick={onToggle} style={{ width: 24, height: 24, borderRadius: 7, border: "2px solid", borderColor: checked ? color : "#d1d5db", background: checked ? color : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", transition: "all 0.15s" }}>
      {checked && <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} style={{ width: 13, height: 13 }}><polyline points="20 6 9 17 4 12"/></svg>}
    </div>
  );

  return (
    <div style={{ fontFamily: "inherit" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)", color: "#fff", borderRadius: 16, padding: 20, marginBottom: 14 }}>
        <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 2 }}>FICHE DE {order.deliveryMode === "livraison" ? "LIVRAISON" : "RETRAIT"}</div>
        <div style={{ fontSize: 19, fontWeight: 900 }}>{order.id} — {order.clientName}</div>
        <div style={{ opacity: 0.75, marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
          {order.deliveryDate && <span>📅 {order.deliveryDate}{order.deliveryTime ? ` à ${order.deliveryTime}` : ""}</span>}
          {order.returnDate && <span>↩️ Retour {order.returnDate}{order.returnTime ? ` à ${order.returnTime}` : ""}</span>}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, background: materialDone ? "#d1fae5" : "#fef3c7", color: materialDone ? "#065f46" : "#92400e", borderRadius: 8, padding: "2px 10px" }}>{materialDone ? "✅ Matériel OK" : `📦 ${checkedCount}/${(order.items||[]).length}`}</span>
          <span style={{ fontSize: 11, fontWeight: 700, background: bonSigned ? "#d1fae5" : "#f3f4f6", color: bonSigned ? "#065f46" : "#6b7280", borderRadius: 8, padding: "2px 10px" }}>{bonSigned ? "✍️ Bon signé" : "✍️ Non signé"}</span>
          <span style={{ fontSize: 11, fontWeight: 700, background: payChecks.soldeRecu ? "#d1fae5" : "#fff7ed", color: payChecks.soldeRecu ? "#065f46" : "#c2410c", borderRadius: 8, padding: "2px 10px" }}>{payChecks.soldeRecu ? "✅ Soldé" : `💶 ${reste.toFixed(2)} € à enc.`}</span>
        </div>
      </div>

      {/* Onglets */}
      <div style={{ display: "flex", gap: 4, background: "#f0f0f0", borderRadius: 12, padding: 4, marginBottom: 16, overflowX: "auto" }}>
        {tabs.map(t => <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ padding: "7px 14px", borderRadius: 10, border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12, background: activeTab === t.id ? "#fff" : "transparent", color: activeTab === t.id ? "#1a1a2e" : "#999", boxShadow: activeTab === t.id ? "0 2px 8px rgba(0,0,0,0.08)" : "none", whiteSpace: "nowrap" }}>{t.label}</button>)}
      </div>

      {/* ── FICHE ── */}
      {activeTab === "fiche" && (
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
          <div style={{ background: "#f8f9fa", borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "#999", fontWeight: 700, marginBottom: 10 }}>📦 MATÉRIEL</div>
            {(order.items||[]).map(item => (
              <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #eee" }}>
                <div><span style={{ fontSize: 14 }}>{item.icon} {item.name}</span>{item.description && <div style={{ fontSize: 11, color: "#888", marginTop: 1 }}>↳ {item.description}</div>}</div>
                <span style={{ background: "#1a1a2e", color: "#fff", borderRadius: 8, padding: "2px 10px", fontWeight: 800, fontSize: 14 }}>× {item.qty}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div style={{ background: "#fffbeb", borderRadius: 12, padding: 14, textAlign: "center" }}><div style={{ fontSize: 11, color: "#92400e", fontWeight: 700 }}>TOTAL</div><div style={{ fontSize: 18, fontWeight: 900, color: "#92400e" }}>{total.toFixed(2)} €</div></div>
            <div style={{ background: "#f0fdf4", borderRadius: 12, padding: 14, textAlign: "center" }}><div style={{ fontSize: 11, color: "#065f46", fontWeight: 700 }}>ACOMPTE</div><div style={{ fontSize: 18, fontWeight: 900, color: "#065f46" }}>{parseFloat(order.acompte||0).toFixed(2)} €</div></div>
            <div style={{ background: reste > 0 ? "#fff7ed" : "#f0fdf4", borderRadius: 12, padding: 14, textAlign: "center" }}><div style={{ fontSize: 11, color: reste > 0 ? "#c2410c" : "#065f46", fontWeight: 700 }}>À ENCAISSER</div><div style={{ fontSize: 18, fontWeight: 900, color: reste > 0 ? "#c2410c" : "#065f46" }}>{reste.toFixed(2)} €</div></div>
          </div>
          {order.notes && <div style={{ background: "#fef9c3", borderRadius: 12, padding: 14 }}><div style={{ fontSize: 11, color: "#854d0e", fontWeight: 700, marginBottom: 4 }}>📝 NOTES</div><div style={{ fontSize: 13 }}>{order.notes}</div></div>}
        </div>
      )}

      {/* ── CHECKLIST MATÉRIEL ── */}
      {activeTab === "checklist" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>✅ Vérification matériel</h3>
            <span style={{ fontSize: 13, fontWeight: 700, color: materialDone ? "#10b981" : "#f59e0b" }}>{checkedCount}/{(order.items||[]).length}</span>
          </div>
          <div style={{ height: 8, background: "#f0f0f0", borderRadius: 8, marginBottom: 18, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 8, background: materialDone ? "#10b981" : "#f59e0b", width: `${(order.items||[]).length > 0 ? (checkedCount/(order.items||[]).length)*100 : 0}%`, transition: "width 0.3s" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(order.items||[]).map(item => (
              <div key={item.id} onClick={() => toggleMat(item.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", borderRadius: 12, border: "2px solid", borderColor: materialChecks[item.id] ? "#10b981" : "#e5e7eb", background: materialChecks[item.id] ? "#f0fdf4" : "#fff", cursor: "pointer", transition: "all 0.15s" }}>
                <CheckBox checked={materialChecks[item.id]} onToggle={() => toggleMat(item.id)} />
                <span style={{ fontSize: 20 }}>{item.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, textDecoration: materialChecks[item.id] ? "line-through" : "none", color: materialChecks[item.id] ? "#6b7280" : "#111" }}>{item.name}</div>
                  {item.description && <div style={{ fontSize: 11, color: "#999" }}>↳ {item.description}</div>}
                </div>
                <span style={{ background: "#1a1a2e", color: "#fff", borderRadius: 8, padding: "2px 10px", fontWeight: 800, fontSize: 14 }}>× {item.qty}</span>
              </div>
            ))}
          </div>
          {materialDone && <div style={{ marginTop: 16, background: "#d1fae5", borderRadius: 12, padding: 16, textAlign: "center" }}><div style={{ fontSize: 28 }}>✅</div><div style={{ fontWeight: 800, color: "#065f46" }}>Tout le matériel vérifié !</div></div>}
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <Btn variant="secondary" size="sm" onClick={() => setMaterialChecks(Object.fromEntries((order.items||[]).map(i => [i.id, false])))} style={{ flex: 1 }}>Tout décocher</Btn>
            <Btn variant="success" size="sm" onClick={() => setMaterialChecks(Object.fromEntries((order.items||[]).map(i => [i.id, true])))} style={{ flex: 1 }}>✅ Tout cocher</Btn>
          </div>
        </div>
      )}

      {/* ── PAIEMENT & CAUTION ── */}
      {activeTab === "paiement" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div style={{ background: "#fffbeb", borderRadius: 12, padding: 14, textAlign: "center" }}><div style={{ fontSize: 11, color: "#92400e", fontWeight: 700 }}>TOTAL</div><div style={{ fontSize: 18, fontWeight: 900, color: "#92400e" }}>{total.toFixed(2)} €</div></div>
            <div style={{ background: "#f0fdf4", borderRadius: 12, padding: 14, textAlign: "center" }}><div style={{ fontSize: 11, color: "#065f46", fontWeight: 700 }}>ACOMPTE</div><div style={{ fontSize: 18, fontWeight: 900, color: "#065f46" }}>{parseFloat(order.acompte||0).toFixed(2)} €</div></div>
            <div style={{ background: reste > 0 ? "#fff7ed" : "#f0fdf4", borderRadius: 12, padding: 14, textAlign: "center" }}><div style={{ fontSize: 11, color: reste > 0 ? "#c2410c" : "#065f46", fontWeight: 700 }}>À ENCAISSER</div><div style={{ fontSize: 18, fontWeight: 900, color: reste > 0 ? "#c2410c" : "#065f46" }}>{reste.toFixed(2)} €</div></div>
          </div>
          <div style={{ background: "#f8f9fa", borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>💶 Suivi du paiement</div>
            {[
              { key: "acompteRecu", label: "Acompte reçu", sub: parseFloat(order.acompte||0) > 0 ? `${parseFloat(order.acompte).toFixed(2)} €` : "Aucun acompte", color: "#3b82f6" },
              { key: "soldeRecu", label: "Solde reçu (paiement final)", sub: `${reste.toFixed(2)} € à encaisser`, color: "#10b981" },
              { key: "reçuRemis", label: "Reçu / facture remis", sub: "Document de paiement", color: "#8b5cf6" },
            ].map(item => (
              <div key={item.key} onClick={() => setPay(item.key, !payChecks[item.key])} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 10, border: "2px solid", borderColor: payChecks[item.key] ? item.color : "#e5e7eb", background: payChecks[item.key] ? item.color + "11" : "#fff", cursor: "pointer", marginBottom: 8, transition: "all 0.15s" }}>
                <CheckBox checked={payChecks[item.key]} onToggle={() => setPay(item.key, !payChecks[item.key])} color={item.color} />
                <div><div style={{ fontWeight: 700, fontSize: 14 }}>{item.label}</div><div style={{ fontSize: 11, color: "#999" }}>{item.sub}</div></div>
              </div>
            ))}
          </div>
          <div style={{ background: "#f8f9fa", borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>🔒 Caution</div>
            <div style={{ fontSize: 12, color: "#999", marginBottom: 12 }}>Mode(s) de caution :</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
              {[
                { key: "cautionChèque", label: "🏦 Chèque", color: "#3b82f6" },
                { key: "cautionPaypal", label: "💙 PayPal", color: "#0070ba" },
                { key: "cautionCNI", label: "🪪 Carte d'identité", color: "#f59e0b" },
                { key: "cautionAutre", label: "📋 Autre", color: "#6b7280" },
              ].map(item => (
                <div key={item.key} onClick={() => setPay(item.key, !payChecks[item.key])} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderRadius: 10, border: "2px solid", borderColor: payChecks[item.key] ? item.color : "#e5e7eb", background: payChecks[item.key] ? item.color + "11" : "#fff", cursor: "pointer", transition: "all 0.15s" }}>
                  <CheckBox checked={payChecks[item.key]} onToggle={() => setPay(item.key, !payChecks[item.key])} color={item.color} />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{item.label}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase" }}>Montant caution (€)</label>
                <input type="number" value={payChecks.cautionMontant} onChange={e => setPay("cautionMontant", e.target.value)} placeholder="0.00" style={{ padding: "8px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 14, fontFamily: "inherit" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase" }}>Note</label>
                <input value={payChecks.cautionNote} onChange={e => setPay("cautionNote", e.target.value)} placeholder="Ex: Chèque n°12345" style={{ padding: "8px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 14, fontFamily: "inherit" }} />
              </div>
            </div>
            {(payChecks.cautionChèque || payChecks.cautionPaypal || payChecks.cautionCNI || payChecks.cautionAutre) && (
              <div style={{ marginTop: 12, background: "#fef3c7", borderRadius: 10, padding: 12, fontSize: 13 }}>
                <strong>Caution :</strong> {[payChecks.cautionChèque && "Chèque", payChecks.cautionPaypal && "PayPal", payChecks.cautionCNI && "CNI", payChecks.cautionAutre && "Autre"].filter(Boolean).join(" + ")}
                {payChecks.cautionMontant && ` — ${payChecks.cautionMontant} €`}
                {payChecks.cautionNote && ` — ${payChecks.cautionNote}`}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── BON DE LIVRAISON ── */}
      {activeTab === "bon" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ border: "2px solid #e5e7eb", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ background: "#1a1a2e", color: "#fff", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div><div style={{ fontWeight: 900, fontSize: 15 }}>🎪 Location Pro</div><div style={{ opacity: 0.6, fontSize: 11 }}>Bon de livraison</div></div>
              <div style={{ textAlign: "right" }}><div style={{ fontWeight: 800 }}>{order.id}</div><div style={{ opacity: 0.7, fontSize: 12 }}>{new Date().toLocaleDateString("fr-FR")}</div></div>
            </div>
            <div style={{ padding: 18 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#999", textTransform: "uppercase", marginBottom: 4 }}>Client</div>
                  <div style={{ fontWeight: 800, fontSize: 14 }}>{order.clientName}</div>
                  {order.clientPhone && <div style={{ fontSize: 13, color: "#666" }}>{order.clientPhone}</div>}
                  {order.address && <div style={{ fontSize: 12, color: "#666", marginTop: 3 }}>{order.address}</div>}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#999", textTransform: "uppercase", marginBottom: 4 }}>Prestation</div>
                  <div style={{ fontSize: 13 }}>{order.deliveryMode === "livraison" ? "🚚 Livraison" : "🏪 Retrait"}</div>
                  {order.deliveryDate && <div style={{ fontSize: 13 }}>📅 {order.deliveryDate}{order.deliveryTime ? ` à ${order.deliveryTime}` : ""}</div>}
                  {order.returnDate && <div style={{ fontSize: 13 }}>↩️ Retour {order.returnDate}{order.returnTime ? ` à ${order.returnTime}` : ""}</div>}
                </div>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14, fontSize: 13 }}>
                <thead><tr style={{ background: "#f8f9fa" }}>
                  <th style={{ padding: "7px 10px", textAlign: "left", fontSize: 11, fontWeight: 800, color: "#999", textTransform: "uppercase" }}>Article</th>
                  <th style={{ padding: "7px 10px", textAlign: "center", fontSize: 11, fontWeight: 800, color: "#999" }}>Qté</th>
                  <th style={{ padding: "7px 10px", textAlign: "right", fontSize: 11, fontWeight: 800, color: "#999" }}>P.U.</th>
                  <th style={{ padding: "7px 10px", textAlign: "right", fontSize: 11, fontWeight: 800, color: "#999" }}>Total</th>
                </tr></thead>
                <tbody>
                  {(order.items||[]).map(item => (
                    <tr key={item.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "7px 10px" }}>{item.icon} {item.name}</td>
                      <td style={{ padding: "7px 10px", textAlign: "center", fontWeight: 700 }}>{item.qty}</td>
                      <td style={{ padding: "7px 10px", textAlign: "right" }}>{item.price.toFixed(2)} €</td>
                      <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700 }}>{(item.qty * item.price).toFixed(2)} €</td>
                    </tr>
                  ))}
                  {deliveryCost > 0 && <tr style={{ borderBottom: "1px solid #f0f0f0" }}><td style={{ padding: "7px 10px" }}>🚚 Livraison</td><td style={{ padding: "7px 10px", textAlign: "center" }}>1</td><td style={{ padding: "7px 10px", textAlign: "right" }}>{deliveryCost.toFixed(2)} €</td><td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700 }}>{deliveryCost.toFixed(2)} €</td></tr>}
                </tbody>
                <tfoot>
                  <tr style={{ background: "#f8f9fa" }}><td colSpan={3} style={{ padding: "7px 10px", fontWeight: 800 }}>Sous-total</td><td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 800 }}>{total.toFixed(2)} €</td></tr>
                  {parseFloat(order.acompte||0) > 0 && <tr><td colSpan={3} style={{ padding: "7px 10px", color: "#10b981" }}>Acompte versé</td><td style={{ padding: "7px 10px", textAlign: "right", color: "#10b981", fontWeight: 700 }}>- {parseFloat(order.acompte).toFixed(2)} €</td></tr>}
                  <tr style={{ background: "#1a1a2e", color: "#fff" }}><td colSpan={3} style={{ padding: "9px 10px", fontWeight: 900 }}>SOLDE À PAYER</td><td style={{ padding: "9px 10px", textAlign: "right", fontWeight: 900 }}>{reste.toFixed(2)} €</td></tr>
                </tfoot>
              </table>
              {(payChecks.cautionChèque || payChecks.cautionPaypal || payChecks.cautionCNI || payChecks.cautionAutre) && (
                <div style={{ background: "#fef9c3", borderRadius: 8, padding: 10, fontSize: 12, marginBottom: 14 }}>
                  🔒 <strong>Caution :</strong> {[payChecks.cautionChèque && "Chèque", payChecks.cautionPaypal && "PayPal", payChecks.cautionCNI && "CNI", payChecks.cautionAutre && "Autre"].filter(Boolean).join(" + ")}
                  {payChecks.cautionMontant && ` — ${payChecks.cautionMontant} €`}
                  {payChecks.cautionNote && ` — ${payChecks.cautionNote}`}
                </div>
              )}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#666", marginBottom: 6, textTransform: "uppercase" }}>Réserves / remarques</div>
                <textarea value={bonReserves} onChange={e => setBonReserves(e.target.value)} placeholder="Ex: 2 chaises légèrement abîmées à réception..." rows={2} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontFamily: "inherit", fontSize: 13, resize: "vertical", boxSizing: "border-box" }} />
              </div>
              {/* Zones de signature */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#666", marginBottom: 6, textTransform: "uppercase" }}>Signature livreur</div>
                  <div onClick={() => setShowSigModal("livreur")} style={{ border: "1.5px dashed #3b82f6", borderRadius: 8, height: 80, background: "#eff6ff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    {sigLivreur ? <img src={sigLivreur} alt="sig livreur" style={{ maxHeight: 76, maxWidth: "100%", objectFit: "contain" }} /> : <span style={{ color: "#3b82f6", fontSize: 12, fontWeight: 700 }}>Appuyer pour signer ✍️</span>}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#666", marginBottom: 6, textTransform: "uppercase" }}>Signature client</div>
                  <div onClick={() => setShowSigModal("client")} style={{ border: "1.5px dashed #10b981", borderRadius: 8, height: 80, background: "#f0fdf4", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    {sigClient ? <img src={sigClient} alt="sig client" style={{ maxHeight: 76, maxWidth: "100%", objectFit: "contain" }} /> : <span style={{ color: "#10b981", fontSize: 12, fontWeight: 700 }}>Appuyer pour signer ✍️</span>}
                  </div>
                  <input value={bonClientName} onChange={e => setBonClientName(e.target.value)} placeholder="Nom du client signataire" style={{ marginTop: 6, width: "100%", padding: "6px 10px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 12, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: 10, color: "#999", textAlign: "center", lineHeight: 1.5 }}>En signant ce bon, le client reconnaît avoir reçu le matériel en bon état et accepte les conditions de location.</div>
            </div>
          </div>
          {!bonSigned ? (
            <Btn variant="primary" onClick={() => { if (!bonClientName) { alert("Saisissez le nom du signataire"); return; } if (!sigClient) { alert("La signature client est requise"); return; } setBonSigned(true); }} style={{ width: "100%" }}>
              <span style={{ width: 16, height: 16 }}>{I.check}</span> Confirmer — Bon signé par {bonClientName || "..."}
            </Btn>
          ) : (
            <div style={{ background: "#d1fae5", borderRadius: 12, padding: 14, textAlign: "center" }}>
              <div style={{ fontSize: 24 }}>✅</div>
              <div style={{ fontWeight: 800, color: "#065f46" }}>Bon signé par {bonClientName}</div>
              <button onClick={() => setBonSigned(false)} style={{ marginTop: 6, background: "none", border: "none", color: "#10b981", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>Annuler</button>
            </div>
          )}
        </div>
      )}

      {/* Modals contact / navigation */}
      <Modal open={phoneModal} onClose={() => setPhoneModal(false)} title="Contacter le client">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, color: "#666", fontSize: 14 }}>Comment souhaitez-vous contacter <strong>{order.clientName}</strong> ?</p>
          <a href={`tel:${phone}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "#dbeafe", borderRadius: 12, textDecoration: "none", color: "#1e40af", fontWeight: 700, fontSize: 15 }}><span style={{ fontSize: 24 }}>📞</span> Appeler — {order.clientPhone}</a>
          <a href={`https://wa.me/${phone.replace(/^0/, "33")}`} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "#d1fae5", borderRadius: 12, textDecoration: "none", color: "#065f46", fontWeight: 700, fontSize: 15 }}><span style={{ fontSize: 24 }}>💬</span> WhatsApp</a>
          <a href={`sms:${phone}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "#f3f4f6", borderRadius: 12, textDecoration: "none", color: "#374151", fontWeight: 700, fontSize: 15 }}><span style={{ fontSize: 24 }}>✉️</span> SMS</a>
        </div>
      </Modal>
      <Modal open={addressModal} onClose={() => setAddressModal(false)} title="Ouvrir dans…">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, color: "#666", fontSize: 14, lineHeight: 1.5 }}>📍 <strong>{order.address}</strong></p>
          <a href={`waze://?q=${addr}&navigate=yes`} style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "#eff6ff", borderRadius: 12, textDecoration: "none", color: "#1e40af", fontWeight: 700, fontSize: 15 }}><span style={{ fontSize: 24 }}>🔵</span> Ouvrir dans Waze</a>
          <a href={`https://www.google.com/maps/dir/?api=1&destination=${addr}`} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "#fff7ed", borderRadius: 12, textDecoration: "none", color: "#c2410c", fontWeight: 700, fontSize: 15 }}><span style={{ fontSize: 24 }}>🗺️</span> Google Maps</a>
          <a href={`maps://maps.apple.com/?daddr=${addr}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "#f0fdf4", borderRadius: 12, textDecoration: "none", color: "#065f46", fontWeight: 700, fontSize: 15 }}><span style={{ fontSize: 24 }}>🍎</span> Plans Apple</a>
        </div>
      </Modal>

      {/* Modal signature tactile */}
      {showSigModal && (
        <SignaturePad
          title={showSigModal === "livreur" ? "Signature du livreur" : "Signature du client"}
          onSave={(dataURL) => { if (showSigModal === "livreur") setSigLivreur(dataURL); else setSigClient(dataURL); setShowSigModal(null); }}
          onClose={() => setShowSigModal(null)}
        />
      )}
    </div>
  );
}



// ─── CALENDRIER MOBILE-FRIENDLY ───────────────────────────────────────────────
function CalendarView({ orders, onOpenOrder }) {
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
            const t = orderTotal(ev);
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
function Dashboard({ orders, expenses }) {
  const ca = useMemo(() => orders.reduce((s, o) => s + orderTotal(o), 0), [orders]);
  const dep = useMemo(() => expenses.reduce((s, e) => s + parseFloat(e.amount || 0), 0), [expenses]);
  const acomptes = useMemo(() => orders.reduce((s, o) => s + parseFloat(o.acompte || 0), 0), [orders]);
  const actives = orders.filter(o => !["Clôturée", "Devis"].includes(o.status)).length;
  const upcoming = orders.filter(o => o.deliveryDate && o.deliveryDate >= TODAY).sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate)).slice(0, 5);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {[
          { label: "Commandes", value: orders.length, icon: "📋", color: "#3b82f6" },
          { label: "CA Total", value: ca.toFixed(0) + " €", icon: "💶", color: "#10b981" },
          { label: "Bénéfice net", value: (ca - dep).toFixed(0) + " €", icon: (ca - dep) >= 0 ? "📈" : "📉", color: (ca - dep) >= 0 ? "#10b981" : "#ef4444" },
          { label: "En cours", value: actives, icon: "🔄", color: "#8b5cf6" },
        ].map(s => (
          <Card key={s.label}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>{s.icon}</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#999", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
          </Card>
        ))}
      </div>
      <Card>
        <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800 }}>📅 Prochaines livraisons / retraits</h3>
        {upcoming.length === 0 ? <div style={{ color: "#999", textAlign: "center", padding: 20 }}>Aucune à venir</div> : upcoming.map(o => (
          <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #f4f4f4" }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: "#f0f4ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{o.deliveryMode === "livraison" ? "🚚" : "🏪"}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{o.clientName}</div>
              <div style={{ fontSize: 12, color: "#666" }}>{o.deliveryDate}{o.deliveryTime ? ` à ${o.deliveryTime}` : ""} — {o.deliveryMode === "livraison" ? o.address : "Retrait entrepôt"}</div>
            </div>
            <Badge status={o.status} />
          </div>
        ))}
      </Card>
    </div>
  );
}

// ─── GESTION DE STOCK ─────────────────────────────────────────────────────────
function StockView({ orders, stock, setStock }) {
  const [editItem, setEditItem] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [filterCat, setFilterCat] = useState("Toutes");
  const [showAdd, setShowAdd] = useState(false);
  const [newItem, setNewItem] = useState({ name: "", icon: "📦", category: "Équipements", unit: "unité", price: 0, coutAchat: 0, total: 0, seuil: 0, enMaintenance: 0 });

  const activeStatuses = ["Confirmée", "Préparée", "En livraison", "Livrée", "En cours"];
  const stockSorti = useMemo(() => {
    const out = {};
    orders.filter(o => activeStatuses.includes(o.status)).forEach(o => o.items.forEach(i => { out[i.id] = (out[i.id] || 0) + i.qty; }));
    return out;
  }, [orders]);

  const cats = ["Toutes", ...new Set(stock.map(s => s.category))];
  const filtered = stock.filter(s => filterCat === "Toutes" || s.category === filterCat);
  const getDispo = (item) => item.total - item.enMaintenance - (stockSorti[item.id] || 0);

  const alertes = stock.filter(s => getDispo(s) <= s.seuil).length;
  const totalSorti = Object.values(stockSorti).reduce((a, b) => a + b, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {[
          { label: "Total articles", value: stock.reduce((s, i) => s + i.total, 0), icon: "📦", color: "#3b82f6" },
          { label: "En location", value: totalSorti, icon: "🚚", color: "#f97316" },
          { label: "En maintenance", value: stock.reduce((s, i) => s + i.enMaintenance, 0), icon: "🔧", color: "#8b5cf6" },
          { label: "Alertes stock", value: alertes, icon: "⚠️", color: alertes > 0 ? "#ef4444" : "#10b981" },
        ].map(s => <Card key={s.label}><div style={{ fontSize: 24, marginBottom: 8 }}>{s.icon}</div><div style={{ fontSize: 26, fontWeight: 900, color: s.color }}>{s.value}</div><div style={{ fontSize: 11, color: "#999", fontWeight: 700, textTransform: "uppercase" }}>{s.label}</div></Card>)}
      </div>
      <Card>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {cats.map(c => <button key={c} onClick={() => setFilterCat(c)} style={{ padding: "6px 14px", borderRadius: 20, border: "1.5px solid", borderColor: filterCat === c ? "#1a1a2e" : "#e5e7eb", background: filterCat === c ? "#1a1a2e" : "#fff", color: filterCat === c ? "#fff" : "#666", fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>{c}</button>)}
          </div>
          <Btn variant="primary" size="sm" onClick={() => setShowAdd(true)}><span style={{ width: 14, height: 14 }}>{I.plus}</span> Ajouter</Btn>
        </div>
      </Card>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#f8f9fa" }}>{["Article", "Prix loc.", "Coût achat", "Total", "En location", "Maintenance", "Disponible", "Seuil", ""].map(h => <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 800, color: "#999", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((item, idx) => {
                const sorti = stockSorti[item.id] || 0;
                const dispo = getDispo(item);
                const alerte = dispo <= item.seuil;
                const isEd = editItem === item.id;
                return (
                  <tr key={item.id} style={{ borderTop: "1px solid #f0f0f0", background: alerte ? "#fff7ed" : idx % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ padding: "12px 16px" }}>
                      {isEd ? <div style={{ display: "flex", gap: 6 }}><input value={editForm.icon} onChange={e => setEditForm(f => ({ ...f, icon: e.target.value }))} style={{ width: 36, padding: "4px", borderRadius: 6, border: "1.5px solid #e5e7eb", textAlign: "center" }} /><input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} style={{ flex: 1, padding: "4px 8px", borderRadius: 6, border: "1.5px solid #e5e7eb", fontSize: 13 }} /></div>
                        : <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 18 }}>{item.icon}</span><div><div style={{ fontWeight: 700 }}>{item.name}</div><div style={{ fontSize: 11, color: "#999" }}>/{item.unit}</div></div></div>}
                    </td>
                    <td style={{ padding: "12px 16px" }}>{isEd ? <input type="number" value={editForm.price} onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))} style={{ width: 70, padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e5e7eb" }} /> : <span style={{ fontWeight: 700 }}>{item.price.toFixed(2)} €</span>}</td>
                    <td style={{ padding: "12px 16px" }}>{isEd ? <input type="number" value={editForm.coutAchat} onChange={e => setEditForm(f => ({ ...f, coutAchat: e.target.value }))} style={{ width: 70, padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e5e7eb" }} /> : <span style={{ color: "#666" }}>{(item.coutAchat || 0).toFixed(2)} €</span>}</td>
                    <td style={{ padding: "12px 16px" }}>{isEd ? <input type="number" value={editForm.total} onChange={e => setEditForm(f => ({ ...f, total: e.target.value }))} style={{ width: 70, padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e5e7eb" }} /> : <span style={{ fontWeight: 800 }}>{item.total}</span>}</td>
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
                          <Btn variant="success" size="sm" onClick={() => { setStock(prev => prev.map(s => s.id === editItem ? { ...editForm, total: +editForm.total, seuil: +editForm.seuil, enMaintenance: +editForm.enMaintenance, price: +editForm.price, coutAchat: +editForm.coutAchat } : s)); setEditItem(null); }}><span style={{ width: 13, height: 13 }}>{I.check}</span></Btn>
                          <Btn variant="secondary" size="sm" onClick={() => setEditItem(null)}><span style={{ width: 13, height: 13 }}>{I.x}</span></Btn>
                        </> : <>
                          <Btn variant="secondary" size="sm" onClick={() => { setEditItem(item.id); setEditForm({ ...item }); }}><span style={{ width: 13, height: 13 }}>{I.edit}</span></Btn>
                          <Btn variant="danger" size="sm" onClick={() => { if (window.confirm("Supprimer ?")) setStock(prev => prev.filter(s => s.id !== item.id)); }}><span style={{ width: 13, height: 13 }}>{I.trash}</span></Btn>
                        </>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Ajouter un article">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 10 }}>
            <Inp label="Icône" value={newItem.icon} onChange={v => setNewItem(f => ({ ...f, icon: v }))} />
            <Inp label="Nom" value={newItem.name} onChange={v => setNewItem(f => ({ ...f, name: v }))} required />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Sel label="Catégorie" value={newItem.category} onChange={v => setNewItem(f => ({ ...f, category: v }))} options={["Chaises", "Tables", "Vaisselle", "Linge", "Équipements"].map(c => ({ value: c, label: c }))} />
            <Inp label="Unité" value={newItem.unit} onChange={v => setNewItem(f => ({ ...f, unit: v }))} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
            <Inp label="Prix loc. €" type="number" value={newItem.price} onChange={v => setNewItem(f => ({ ...f, price: v }))} />
            <Inp label="Coût achat €" type="number" value={newItem.coutAchat} onChange={v => setNewItem(f => ({ ...f, coutAchat: v }))} />
            <Inp label="Quantité" type="number" value={newItem.total} onChange={v => setNewItem(f => ({ ...f, total: v }))} />
            <Inp label="Seuil" type="number" value={newItem.seuil} onChange={v => setNewItem(f => ({ ...f, seuil: v }))} />
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="secondary" onClick={() => setShowAdd(false)}>Annuler</Btn>
            <Btn variant="primary" disabled={!newItem.name} onClick={() => { setStock(prev => [...prev, { ...newItem, id: "custom_" + Date.now(), total: +newItem.total, seuil: +newItem.seuil, enMaintenance: 0, price: +newItem.price, coutAchat: +newItem.coutAchat }]); setShowAdd(false); }}><span style={{ width: 14, height: 14 }}>{I.plus}</span> Ajouter</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── COMPTABILITÉ + SEUIL DE RENTABILITÉ ─────────────────────────────────────
function ComptaView({ orders, expenses, setExpenses, stock }) {
  const [activeTab, setActiveTab] = useState("synthese");
  const [showForm, setShowForm] = useState(false);
  const [editExp, setEditExp] = useState(null);
  const [filterCat, setFilterCat] = useState("Toutes");
  const [filterMonth, setFilterMonth] = useState("Tous");
  const [form, setForm] = useState({ date: TODAY, label: "", category: "Achat matériel", amount: "", supplier: "", paymentMethod: "CB", notes: "", linkedItemId: "", linkedQty: 0 });
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const revenueOrders = orders.filter(o => ["Clôturée", "Livrée", "En cours"].includes(o.status));
  const totalRevenu = useMemo(() => revenueOrders.reduce((s, o) => s + orderTotal(o), 0), [orders]);
  const totalDepenses = useMemo(() => expenses.reduce((s, e) => s + parseFloat(e.amount || 0), 0), [expenses]);
  const benefice = totalRevenu - totalDepenses;
  const totalAcomptes = useMemo(() => orders.reduce((s, o) => s + parseFloat(o.acompte || 0), 0), [orders]);

  const allMonths = [...new Set(expenses.map(e => e.date.slice(0, 7)))].sort().reverse();
  const filtered = expenses.filter(e => (filterCat === "Toutes" || e.category === filterCat) && (filterMonth === "Tous" || e.date.startsWith(filterMonth)));
  const totalFiltered = filtered.reduce((s, e) => s + parseFloat(e.amount || 0), 0);

  // ── Seuil de rentabilité par article
  const rentabilite = stock.map(item => {
    const totalAchat = expenses.filter(e => e.linkedItemId === item.id).reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    const revenusGeneres = revenueOrders.reduce((s, o) => {
      const itemInOrder = o.items.find(i => i.id === item.id);
      return s + (itemInOrder ? itemInOrder.qty * itemInOrder.price : 0);
    }, 0);
    const qtéAchetee = expenses.filter(e => e.linkedItemId === item.id).reduce((s, e) => s + (parseInt(e.linkedQty) || 0), 0);
    const locParItem = item.price;
    const locsNeeded = totalAchat > 0 && locParItem > 0 ? Math.ceil(totalAchat / locParItem) : null;
    const pct = totalAchat > 0 ? Math.min(100, (revenusGeneres / totalAchat) * 100) : 0;
    return { ...item, totalAchat, revenusGeneres, qtéAchetee, locsNeeded, pct, amorti: revenusGeneres >= totalAchat };
  }).filter(r => r.totalAchat > 0).sort((a, b) => b.totalAchat - a.totalAchat);

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
    const rev = revenueOrders.filter(o => o.deliveryDate?.startsWith(key)).reduce((s, o) => s + orderTotal(o), 0);
    const dep = expenses.filter(e => e.date.startsWith(key)).reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    last6.push({ key, label: d.toLocaleString("fr-FR", { month: "short" }), rev, dep });
  }
  const maxBar = Math.max(...last6.map(m => Math.max(m.rev, m.dep)), 1);

  const byCategory = EXPENSE_CATEGORIES.map(cat => ({ cat, total: expenses.filter(e => e.category === cat).reduce((s, e) => s + parseFloat(e.amount || 0), 0) })).filter(x => x.total > 0).sort((a, b) => b.total - a.total);
  const maxCat = byCategory[0]?.total || 1;

  const tabs = [{ id: "synthese", label: "📊 Synthèse" }, { id: "seuil", label: "🎯 Rentabilité" }, { id: "depenses", label: "🛒 Dépenses" }, { id: "revenus", label: "📈 Revenus" }];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {[
          { label: "Chiffre d'affaires", value: totalRevenu.toFixed(2) + " €", icon: "📈", color: "#10b981" },
          { label: "Acomptes encaissés", value: totalAcomptes.toFixed(2) + " €", icon: "💰", color: "#3b82f6" },
          { label: "Total dépenses", value: totalDepenses.toFixed(2) + " €", icon: "🛒", color: "#ef4444" },
          { label: "Bénéfice net", value: benefice.toFixed(2) + " €", icon: benefice >= 0 ? "✅" : "⚠️", color: benefice >= 0 ? "#10b981" : "#ef4444" },
        ].map(s => <Card key={s.label}><div style={{ fontSize: 22, marginBottom: 8 }}>{s.icon}</div><div style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{s.value}</div><div style={{ fontSize: 11, color: "#999", fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>{s.label}</div></Card>)}
      </div>

      <div style={{ display: "flex", gap: 4, background: "#f0f0f0", borderRadius: 12, padding: 4, width: "fit-content" }}>
        {tabs.map(t => <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ padding: "8px 18px", borderRadius: 10, border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 13, background: activeTab === t.id ? "#fff" : "transparent", color: activeTab === t.id ? "#1a1a2e" : "#999", boxShadow: activeTab === t.id ? "0 2px 8px rgba(0,0,0,0.08)" : "none" }}>{t.label}</button>)}
      </div>

      {/* ── SYNTHÈSE ── */}
      {activeTab === "synthese" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Card>
            <h3 style={{ margin: "0 0 20px", fontSize: 15, fontWeight: 800 }}>📊 Revenus vs Dépenses (6 mois)</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 160 }}>
              {last6.map(m => (
                <div key={m.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 130 }}>
                    <div title={`Revenus: ${m.rev.toFixed(0)} €`} style={{ width: 16, borderRadius: "4px 4px 0 0", background: "#10b981", height: `${Math.max(2, (m.rev / maxBar) * 120)}px` }} />
                    <div title={`Dépenses: ${m.dep.toFixed(0)} €`} style={{ width: 16, borderRadius: "4px 4px 0 0", background: "#ef4444", height: `${Math.max(2, (m.dep / maxBar) * 120)}px` }} />
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              {[
                { label: "Taux de marge", value: totalRevenu > 0 ? ((benefice / totalRevenu) * 100).toFixed(1) + "%" : "—", color: benefice >= 0 ? "#10b981" : "#ef4444" },
                { label: "Dépense moy.", value: expenses.length > 0 ? (totalDepenses / expenses.length).toFixed(2) + " €" : "—", color: "#f59e0b" },
                { label: "Revenu moy. / cmd", value: revenueOrders.length > 0 ? (totalRevenu / revenueOrders.length).toFixed(2) + " €" : "—", color: "#3b82f6" },
                { label: "Reste à encaisser", value: orders.reduce((s, o) => { const t = orderTotal(o); return s + t - parseFloat(o.acompte || 0); }, 0).toFixed(2) + " €", color: "#8b5cf6" },
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

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
                <div style={{ background: "#fff7ed", borderRadius: 10, padding: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "#92400e", fontWeight: 700 }}>COÛT TOTAL ACHAT</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "#c2410c" }}>{item.totalAchat.toFixed(2)} €</div>
                </div>
                <div style={{ background: "#f0fdf4", borderRadius: 10, padding: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "#065f46", fontWeight: 700 }}>REVENUS GÉNÉRÉS</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "#10b981" }}>{item.revenusGeneres.toFixed(2)} €</div>
                </div>
                <div style={{ background: item.amorti ? "#f0fdf4" : "#fef3c7", borderRadius: 10, padding: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: item.amorti ? "#065f46" : "#92400e", fontWeight: 700 }}>RESTE À AMORTIR</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: item.amorti ? "#10b981" : "#f59e0b" }}>{Math.max(0, item.totalAchat - item.revenusGeneres).toFixed(2)} €</div>
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

              {item.locsNeeded && !item.amorti && (
                <div style={{ background: "#f0f4ff", borderRadius: 10, padding: 10, fontSize: 13, color: "#3b82f6", fontWeight: 600 }}>
                  💡 Il faut encore <strong>{Math.ceil((item.totalAchat - item.revenusGeneres) / item.price)}</strong> location(s) à {item.price.toFixed(2)} €/unité pour amortir complètement cet achat.
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
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ padding: "7px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontFamily: "inherit", fontSize: 13 }}>
                  {["Toutes", ...EXPENSE_CATEGORIES].map(c => <option key={c}>{c}</option>)}
                </select>
                <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ padding: "7px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontFamily: "inherit", fontSize: 13 }}>
                  {["Tous", ...allMonths].map(m => <option key={m} value={m}>{m === "Tous" ? "Tous les mois" : m}</option>)}
                </select>
                <span style={{ fontSize: 13, color: "#666", fontWeight: 700 }}>Total : <span style={{ color: "#ef4444" }}>{totalFiltered.toFixed(2)} €</span></span>
              </div>
              <Btn variant="primary" size="sm" onClick={openAdd}><span style={{ width: 14, height: 14 }}>{I.plus}</span> Ajouter</Btn>
            </div>
          </Card>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
                      <td style={{ padding: "12px 16px" }}><span style={{ fontWeight: 900, fontSize: 15, color: "#ef4444" }}>{parseFloat(exp.amount).toFixed(2)} €</span></td>
                      <td style={{ padding: "12px 16px" }}><div style={{ display: "flex", gap: 6 }}><Btn variant="secondary" size="sm" onClick={() => openEdit(exp)}><span style={{ width: 13, height: 13 }}>{I.edit}</span></Btn><Btn variant="danger" size="sm" onClick={() => { if (window.confirm("Supprimer ?")) setExpenses(prev => prev.filter(e => e.id !== exp.id)); }}><span style={{ width: 13, height: 13 }}>{I.trash}</span></Btn></div></td>
                    </tr>
                  );
                })}
              </tbody>
              {filtered.length > 0 && <tfoot><tr style={{ background: "#f0f4ff", borderTop: "2px solid #e5e7eb" }}><td colSpan={6} style={{ padding: "12px 16px", fontWeight: 800 }}>TOTAL ({filtered.length} transactions)</td><td style={{ padding: "12px 16px", fontWeight: 900, fontSize: 17, color: "#ef4444" }}>{totalFiltered.toFixed(2)} €</td><td /></tr></tfoot>}
            </table>
          </Card>
        </div>
      )}

      {/* ── REVENUS ── */}
      {activeTab === "revenus" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#f8f9fa" }}>{["N° Commande", "Client", "Date", "Statut", "Acompte", "Total", "Reste"].map(h => <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 800, color: "#999", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>
              {[...orders].sort((a, b) => (b.deliveryDate || "").localeCompare(a.deliveryDate || "")).map((o, idx) => {
                const t = orderTotal(o); const a = parseFloat(o.acompte || 0); const r = t - a;
                return (
                  <tr key={o.id} style={{ borderTop: "1px solid #f0f0f0", background: idx % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 12, color: "#666" }}>{o.id}</td>
                    <td style={{ padding: "12px 16px", fontWeight: 700 }}>{o.clientName}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#666" }}>{o.deliveryDate || "—"}</td>
                    <td style={{ padding: "12px 16px" }}><Badge status={o.status} /></td>
                    <td style={{ padding: "12px 16px", fontWeight: 700, color: "#3b82f6" }}>{a.toFixed(2)} €</td>
                    <td style={{ padding: "12px 16px", fontWeight: 900, fontSize: 15 }}>{t.toFixed(2)} €</td>
                    <td style={{ padding: "12px 16px" }}><span style={{ fontWeight: 800, color: r > 0 ? "#f59e0b" : "#10b981" }}>{r <= 0 ? "✓ Soldé" : r.toFixed(2) + " €"}</span></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr style={{ background: "#f0fdf4", borderTop: "2px solid #d1fae5" }}>
              <td colSpan={4} style={{ padding: "12px 16px", fontWeight: 800 }}>TOTAL ({orders.length} commandes)</td>
              <td style={{ padding: "12px 16px", fontWeight: 800, color: "#3b82f6" }}>{totalAcomptes.toFixed(2)} €</td>
              <td style={{ padding: "12px 16px", fontWeight: 900, fontSize: 17, color: "#10b981" }}>{orders.reduce((s, o) => s + orderTotal(o), 0).toFixed(2)} €</td>
              <td style={{ padding: "12px 16px", fontWeight: 800, color: "#f59e0b" }}>{orders.reduce((s, o) => s + orderTotal(o) - parseFloat(o.acompte || 0), 0).toFixed(2)} €</td>
            </tr></tfoot>
          </table>
        </Card>
      )}

      {/* Modal dépense */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={editExp ? "Modifier la dépense" : "Nouvelle dépense"}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Inp label="Date" type="date" value={form.date} onChange={v => setF("date", v)} required />
            <Sel label="Catégorie" value={form.category} onChange={v => setF("category", v)} options={EXPENSE_CATEGORIES.map(c => ({ value: c, label: c }))} />
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
    </div>
  );
}

// ─── INTERFACE LIVREUR ────────────────────────────────────────────────────────
function DeliveryInterface({ orders }) {
  const [selected, setSelected] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const todayOrders = orders.filter(o => o.deliveryDate === TODAY || o.returnDate === TODAY);
  const upcoming = orders.filter(o => o.deliveryDate > TODAY && o.deliveryMode === "livraison").sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));

  const copyFiche = (order) => {
    const del = order.deliveryMode === "livraison" ? calcDelivery(parseFloat(order.deliveryKm) || 0) : 0;
    const total = order.items.reduce((s, i) => s + i.qty * i.price, 0) + del;
    const reste = total - parseFloat(order.acompte || 0);
    const text = `🚚 FICHE ${order.deliveryMode === "livraison" ? "LIVRAISON" : "RETRAIT"} — ${order.id}\n\n👤 ${order.clientName}\n📞 ${order.clientPhone || "N/A"}\n📍 ${order.address || "Retrait entrepôt"}\n📅 ${order.deliveryDate || ""}${order.deliveryTime ? " à " + order.deliveryTime : ""}${order.returnDate ? "\n↩️ Retour : " + order.returnDate + (order.returnTime ? " à " + order.returnTime : "") : ""}\n\n📦 MATÉRIEL :\n${order.items.map(i => `• ${i.name} × ${i.qty}`).join("\n")}\n\n💶 Total : ${total.toFixed(2)} €\n💰 Acompte : ${parseFloat(order.acompte || 0).toFixed(2)} €\n💳 À encaisser : ${reste.toFixed(2)} €\n\n📝 Notes : ${order.notes || "Aucune"}`;
    navigator.clipboard.writeText(text).then(() => { setCopiedId(order.id); setTimeout(() => setCopiedId(null), 2000); });
  };

  const OrderCard = ({ order }) => {
    const del = order.deliveryMode === "livraison" ? calcDelivery(parseFloat(order.deliveryKm) || 0) : 0;
    const total = order.items.reduce((s, i) => s + i.qty * i.price, 0) + del;
    const reste = total - parseFloat(order.acompte || 0);
    return (
      <Card style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div><div style={{ fontSize: 16, fontWeight: 800 }}>{order.clientName}</div><div style={{ fontSize: 11, color: "#999", fontFamily: "monospace" }}>{order.id}</div></div>
          <Badge status={order.status} />
        </div>
        {order.deliveryTime && <div style={{ fontSize: 13, color: "#3b82f6", fontWeight: 700, marginBottom: 6 }}>🕐 {order.deliveryMode === "livraison" ? "Livraison" : "Retrait"} à {order.deliveryTime}</div>}
        {order.address && <div style={{ fontSize: 13, color: "#555", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 14, flexShrink: 0 }}>{I.location}</span> {order.address}</div>}
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, background: reste > 0 ? "#fff7ed" : "#f0fdf4", color: reste > 0 ? "#c2410c" : "#065f46", borderRadius: 8, padding: "2px 10px", fontWeight: 700 }}>{reste > 0 ? `À encaisser : ${reste.toFixed(2)} €` : "✓ Soldé"}</span>
          <span style={{ fontSize: 12, background: "#f4f4f8", color: "#666", borderRadius: 8, padding: "2px 10px" }}>{order.items.length} article(s)</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="secondary" size="sm" onClick={() => setSelected(order)} style={{ flex: 1 }}><span style={{ width: 14, height: 14 }}>{I.eye}</span> Voir fiche</Btn>
          <Btn variant={copiedId === order.id ? "success" : "primary"} size="sm" onClick={() => copyFiche(order)} style={{ flex: 1 }}><span style={{ width: 14, height: 14 }}>{copiedId === order.id ? I.check : I.copy}</span>{copiedId === order.id ? "Copié !" : "Copier"}</Btn>
        </div>
      </Card>
    );
  };

  return (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      <div style={{ background: "linear-gradient(135deg, #1a1a2e, #0f3460)", color: "#fff", borderRadius: 20, padding: 24, marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: 40 }}>🚚</span>
        <div><div style={{ fontSize: 22, fontWeight: 900 }}>Interface Livreur</div><div style={{ opacity: 0.7, fontSize: 13 }}>{new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</div></div>
      </div>
      {todayOrders.length > 0 && (<div style={{ marginBottom: 20 }}><h3 style={{ fontSize: 13, fontWeight: 800, color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>🔴 Aujourd'hui ({todayOrders.length})</h3>{todayOrders.map(o => <OrderCard key={o.id} order={o} />)}</div>)}
      {upcoming.length > 0 && (<div><h3 style={{ fontSize: 13, fontWeight: 800, color: "#3b82f6", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>📅 Prochaines livraisons</h3>{upcoming.map(o => <OrderCard key={o.id} order={o} />)}</div>)}
      {todayOrders.length === 0 && upcoming.length === 0 && <div style={{ textAlign: "center", padding: 60, color: "#999" }}><div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div><div style={{ fontWeight: 700 }}>Aucune livraison prévue</div></div>}
      <Modal open={!!selected} onClose={() => setSelected(null)} title="Fiche de livraison" wide><DeliverySheet order={selected || {}} /></Modal>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState("dashboard");
  const [orders, setOrders] = useState(DEMO_ORDERS);
  const [stock, setStock] = useState(INITIAL_STOCK);
  const [expenses, setExpenses] = useState(DEMO_EXPENSES);
  const [clients, setClients] = useState(DEMO_CLIENTS);
  const [driveToken, setDriveToken] = useState(null);
  const [driveClientId, setDriveClientId] = useState("");
  const [editOrder, setEditOrder] = useState(null);
  const [viewOrder, setViewOrder] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState("Toutes");
  const [searchQ, setSearchQ] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const saveOrder = (order) => setOrders(prev => { const ex = prev.find(o => o.id === order.id); return ex ? prev.map(o => o.id === order.id ? order : o) : [order, ...prev]; });
  const deleteOrder = (id) => { if (window.confirm("Supprimer cette commande ?")) setOrders(prev => prev.filter(o => o.id !== id)); };
  const updateStatus = (id, status) => setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o));

  const filtered = orders.filter(o => (filterStatus === "Toutes" || o.status === filterStatus) && (o.clientName.toLowerCase().includes(searchQ.toLowerCase()) || o.id.toLowerCase().includes(searchQ.toLowerCase())));

  const navItems = [
    { id: "dashboard", label: "Tableau de bord", icon: "🏠" },
    { id: "orders", label: "Commandes", icon: "📋" },
    { id: "clients", label: "Clients", icon: "👥" },
    { id: "stock", label: "Gestion de stock", icon: "📦" },
    { id: "compta", label: "Comptabilité", icon: "💹" },
    { id: "calendar", label: "Calendrier", icon: "📅" },
    { id: "delivery", label: "Interface Livreur", icon: "🚚" },
    { id: "settings", label: "Paramètres", icon: "⚙️" },
  ];

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#f4f5f7", fontFamily: "'Nunito', 'Segoe UI', sans-serif" }}>
      {/* SIDEBAR */}
      <div style={{ width: sidebarOpen ? 240 : 64, background: "#1a1a2e", color: "#fff", display: "flex", flexDirection: "column", transition: "width 0.25s ease", overflow: "hidden", flexShrink: 0, height: "100vh" }}>
        <div style={{ padding: "20px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #e94560, #f59e0b)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>🎪</div>
          {sidebarOpen && <div style={{ fontWeight: 900, fontSize: 16, whiteSpace: "nowrap" }}>Location Pro</div>}
        </div>
        <nav style={{ flex: 1, padding: "12px 8px" }}>
          {navItems.map(item => (
            <button key={item.id} onClick={() => setView(item.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, marginBottom: 4, background: view === item.id ? "rgba(255,255,255,0.12)" : "transparent", color: view === item.id ? "#fff" : "rgba(255,255,255,0.5)", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 14, textAlign: "left", transition: "all 0.15s" }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>{item.icon}</span>
              {sidebarOpen && <span style={{ whiteSpace: "nowrap" }}>{item.label}</span>}
            </button>
          ))}
        </nav>
        <button onClick={() => setSidebarOpen(s => !s)} style={{ padding: 16, background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", display: "flex", justifyContent: sidebarOpen ? "flex-end" : "center" }}>
          <span style={{ fontSize: 18 }}>{sidebarOpen ? "◀" : "▶"}</span>
        </button>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", height: "100vh" }}>
        <div style={{ background: "#fff", borderBottom: "1px solid #eee", padding: "0 24px", height: 64, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: "#1a1a2e" }}>{navItems.find(n => n.id === view)?.label}</h1>
          {view === "orders" && <Btn variant="primary" onClick={() => { setEditOrder(null); setShowForm(true); }}><span style={{ width: 16, height: 16 }}>{I.plus}</span> Nouvelle commande</Btn>}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {view === "dashboard" && <Dashboard orders={orders} expenses={expenses} />}
          {view === "stock" && <StockView orders={orders} stock={stock} setStock={setStock} />}
          {view === "compta" && <ComptaView orders={orders} expenses={expenses} setExpenses={setExpenses} stock={stock} />}
          {view === "calendar" && <Card><CalendarView orders={orders} onOpenOrder={(order) => { setViewOrder(order); }} /></Card>}
          {view === "delivery" && <DeliveryInterface orders={orders} />}

          {view === "clients" && (
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>👥 Bibliothèque clients</h2>
                  <div style={{ color: "#999", fontSize: 13, marginTop: 4 }}>{clients.length} client(s) enregistré(s)</div>
                </div>
              </div>
              <ClientLibrary
                clients={clients}
                setClients={setClients}
                onSelect={() => {}}
                onClose={() => {}}
              />
            </Card>
          )}

          {view === "settings" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 560 }}>
              <Card>
                <DriveSettings
                  driveToken={driveToken}
                  setDriveToken={setDriveToken}
                  clientId={driveClientId}
                  setClientId={setDriveClientId}
                />
              </Card>
              <Card>
                <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 800 }}>📋 Numérotation des devis</h3>
                <div style={{ fontSize: 13, color: "#666", lineHeight: 1.7 }}>
                  Les devis sont numérotés automatiquement au format :<br/>
                  <code style={{ background: "#f0f4ff", padding: "2px 8px", borderRadius: 6, fontWeight: 700, color: "#1a1a2e" }}>devN DDMMAA</code><br/>
                  Exemple : <strong>dev1080626</strong> = 1er devis du 08/06/2026
                </div>
                <div style={{ marginTop: 12, background: "#f8f9fa", borderRadius: 10, padding: 12, fontSize: 12, color: "#999" }}>
                  Devis du jour : <strong style={{ color: "#1a1a2e" }}>{orders.filter(o => {
                    const now = new Date();
                    const dd = String(now.getDate()).padStart(2, "0");
                    const mm = String(now.getMonth() + 1).padStart(2, "0");
                    const yy = String(now.getFullYear()).slice(-2);
                    return new RegExp(`^dev\\d+${dd}${mm}${yy}$`).test(o.id);
                  }).length}</strong> créé(s) aujourd'hui
                </div>
              </Card>
            </div>
          )}

          {view === "orders" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Card>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ flex: 1, minWidth: 200 }}><Inp placeholder="🔍 Rechercher client ou N° commande..." value={searchQ} onChange={setSearchQ} /></div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {["Toutes", ...STATUS_FLOW].map(s => (
                      <button key={s} onClick={() => setFilterStatus(s)} style={{ padding: "6px 14px", borderRadius: 20, border: "1.5px solid", borderColor: filterStatus === s ? "#1a1a2e" : "#e5e7eb", background: filterStatus === s ? "#1a1a2e" : "#fff", color: filterStatus === s ? "#fff" : "#666", fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>{s}</button>
                    ))}
                  </div>
                </div>
              </Card>

              {filtered.length === 0 ? (
                <Card style={{ textAlign: "center", padding: 60 }}><div style={{ fontSize: 48, marginBottom: 12 }}>📭</div><div style={{ color: "#999", fontWeight: 600 }}>Aucune commande</div></Card>
              ) : filtered.map(order => {
                const del = order.deliveryMode === "livraison" ? calcDelivery(parseFloat(order.deliveryKm) || 0) : 0;
                const total = order.items.reduce((s, i) => s + i.qty * i.price, 0) + del;
                const reste = total - parseFloat(order.acompte || 0);
                return (
                  <Card key={order.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                          <span style={{ fontSize: 17, fontWeight: 900 }}>{order.clientName}</span>
                          <Badge status={order.status} />
                        </div>
                        <div style={{ fontSize: 11, color: "#999", fontFamily: "monospace" }}>{order.id}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 20, fontWeight: 900 }}>{total.toFixed(2)} €</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: reste > 0 ? "#f59e0b" : "#10b981" }}>{reste > 0 ? `Reste : ${reste.toFixed(2)} €` : "✓ Soldé"}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#666", marginBottom: 10, flexWrap: "wrap" }}>
                      {order.address && <span>📍 {order.address}</span>}
                      {order.deliveryDate && <span>📅 {order.deliveryMode === "livraison" ? "Livraison" : "Retrait"} : {order.deliveryDate}{order.deliveryTime ? ` à ${order.deliveryTime}` : ""}</span>}
                      {order.returnDate && <span>↩️ Retour : {order.returnDate}{order.returnTime ? ` à ${order.returnTime}` : ""}</span>}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                      {order.items.map(item => <span key={item.id} style={{ background: "#f4f5f7", borderRadius: 8, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>{item.icon} {item.name} × {item.qty}</span>)}
                    </div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
                      <Sel value={order.status} onChange={v => updateStatus(order.id, v)} options={STATUS_FLOW.map(s => ({ value: s, label: s }))} />
                      <div style={{ display: "flex", gap: 8 }}>
                        <Btn variant="secondary" size="sm" onClick={() => setViewOrder(order)}><span style={{ width: 14, height: 14 }}>{I.eye}</span> Voir</Btn>
                        <Btn variant="secondary" size="sm" onClick={() => { setEditOrder(order); setShowForm(true); }}><span style={{ width: 14, height: 14 }}>{I.edit}</span> Modifier</Btn>
                        <Btn variant="danger" size="sm" onClick={() => deleteOrder(order.id)}><span style={{ width: 14, height: 14 }}>{I.trash}</span></Btn>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editOrder ? "Modifier la commande" : "Nouvelle commande"} wide>
        <OrderForm
          initial={editOrder}
          onSave={(order) => { saveOrder(order); if (!editOrder) setClients(prev => { const exists = prev.find(c => c.name === order.clientName && c.phone === order.clientPhone); if (exists) return prev; return [...prev, { id: "cli-" + Date.now(), name: order.clientName, phone: order.clientPhone, email: order.clientEmail, address: order.address, notes: "" }]; }); }}
          onClose={() => setShowForm(false)}
          allOrders={orders}
          clients={clients}
          driveToken={driveToken}
        />
      </Modal>
      <Modal open={!!viewOrder} onClose={() => setViewOrder(null)} title="Fiche de livraison" wide>
        {viewOrder && <DeliverySheet order={viewOrder} />}
      </Modal>
    </div>
  );
}
