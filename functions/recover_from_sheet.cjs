const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { google } = require("googleapis");

const SHEET_ID = "1-Mz_cKnT3_mqXK-jwAOIZtO0APoVD9h1E3TEwgYRThM";
const SHEET_RANGE = "Commandes!A1:M400";

if (!getApps().length) {
  initializeApp({ credential: cert(require("./serviceAccountKey.json")) });
}

async function main() {
  console.log("🔄 Connexion à Google Sheets...");
  const auth = new google.auth.GoogleAuth({
    keyFile: "./serviceAccountKey.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: SHEET_RANGE });
  const rows = res.data.values || [];
  console.log(`📊 ${rows.length} lignes lues`);
  const dataRows = rows.slice(1).filter(r => r[0] && r[0].trim());
  const orders = dataRows.map(r => {
    const id = (r[0]||"").trim(), status = (r[1]||"Clôturée").trim(), clientName = (r[2]||"").trim();
    const clientPhone = (r[3]||"").trim(), address = (r[4]||"").trim();
    const deliveryDate = (r[5]||"").trim(), returnDate = (r[6]||"").trim(), itemsText = (r[7]||"").trim();
    const acompte = parseFloat((r[11]||"0").replace(",","."))||0;
    const notes = (r[12]||"").trim();
    const deliveryAmt = parseFloat((r[9]||"0").replace(",","."))||0;
    const remise = parseFloat((r[10]||"0").replace(",","."))||0;
    const items = itemsText.split(/,\s*/).map(part => {
      const m = part.match(/^(\d+)[×x]\s*(.+)$/i);
      if (!m) return null;
      return { id: "recovered_"+m[2].trim().replace(/\s+/g,"_").toLowerCase(), name: m[2].trim(), qty: parseInt(m[1])||1, price: 0, icon: "📦", category: "Importé" };
    }).filter(Boolean);
    const deliveryMode = address && address !== "Retrait entrepôt" && address !== "Au pied du camion" ? "livraison" : "retrait";
    return { id, status, clientName, clientPhone, address: deliveryMode==="livraison"?address:"", deliveryDate, returnDate, deliveryMode, items, deliveryPriceManual: deliveryAmt>0?String(deliveryAmt):"", discountType:"fixed", discountValue: remise>0?String(remise):"", acompte: acompte>0?String(acompte):"", notes, phase: status==="Clôturée"?"termine":"livraison", closedAt: status==="Clôturée"?new Date().toISOString():null, trajetAller:true, trajetRetour:false };
  });
  console.log(`📋 ${orders.length} commandes converties`);
  const db = getFirestore();
  await db.collection("app").doc("orders").set({ value: orders });
  await db.collection("app").doc("sheetSyncGuard").set({ value: { orders: orders.length } });
  console.log(`🎉 ${orders.length} commandes restaurées dans Firestore !`);
}

main().catch(err => { console.error("❌ Erreur :", err.message||err); process.exit(1); });
