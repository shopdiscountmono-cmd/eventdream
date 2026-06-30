/**
 * Corrige les IDs "recovered_xxx" dans les commandes Firestore
 * en les remplaçant par les vrais IDs du stock.
 * Lance depuis ~/Desktop/eventdream/functions :
 *   node fix_recovered_ids.cjs
 */
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

if (!getApps().length) {
  initializeApp({ credential: cert(require("./serviceAccountKey.json")) });
}

// Correspondance entre IDs "recovered_xxx" et vrais IDs du stock
// Ajoute ici d'autres correspondances si nécessaire
const ID_MAP = {
  "recovered_chaise_pliante":           "chaise_pliante",
  "recovered_chaise_napoleon":          "chaise_napoleon",
  "recovered_table_ronde_180cm":        "table_ronde",
  "recovered_table_rectangulaire_240cm":"custom_1781857956581",
  "recovered_nappe":                    "nappe",
  "recovered_grande_assiette":          "grande_assiette",
  "recovered_petite_assiette":          "petite_assiette",
  "recovered_fourchette":               "fourchette",
  "recovered_couteau":                  "couteau",
  "recovered_grande_cuillere":          "grande_cuillere",
  "recovered_petite_cuillere":          "petite_cuillere",
  "recovered_verre_pied":               "verre_pied",
  "recovered_verre_eau":                "verre_eau",
  "recovered_rechauffe_plat":           "rechauffe_plat",
  "recovered_centre_de_table":          "centre_de_table",
  "recovered_serviette_de_table":       "serviette_de_table",
  "recovered_arche_ronde":              "arche_ronde",
  "recovered_backdrop":                 "backdrop",
};

async function main() {
  const db = getFirestore();
  console.log("🔄 Lecture des commandes...");

  const snap = await db.collection("app").doc("orders").get();
  const orders = snap.data().value || [];
  console.log(`📋 ${orders.length} commandes trouvées`);

  // Recensement des IDs recovered présents
  const foundIds = new Set();
  orders.forEach(o => (o.items||[]).forEach(i => {
    if ((i.id||"").startsWith("recovered_")) foundIds.add(i.id);
  }));

  if (foundIds.size === 0) {
    console.log("✅ Aucun ID recovered trouvé — rien à corriger !");
    return;
  }

  console.log(`\n🔍 IDs recovered trouvés :`);
  foundIds.forEach(id => {
    const mapped = ID_MAP[id];
    console.log(`  ${id} → ${mapped || "⚠️ PAS DE CORRESPONDANCE (sera ignoré)"}`);
  });

  // Correction
  let fixedOrders = 0;
  let fixedItems = 0;
  const corrected = orders.map(o => {
    if (!o.items || !o.items.some(i => (i.id||"").startsWith("recovered_"))) return o;
    fixedOrders++;
    const newItems = o.items.map(i => {
      if (!(i.id||"").startsWith("recovered_")) return i;
      const newId = ID_MAP[i.id];
      if (!newId) return i; // pas de correspondance, on laisse tel quel
      fixedItems++;
      return { ...i, id: newId };
    });
    return { ...o, items: newItems };
  });

  console.log(`\n✏️  ${fixedOrders} commandes à corriger, ${fixedItems} articles corrigés`);
  console.log("⏳ Écriture dans Firestore...");
  await db.collection("app").doc("orders").set({ value: corrected });
  console.log("🎉 Correction terminée ! Recharge l'application pour vérifier.");
}

main().catch(e => { console.error("❌ Erreur :", e.message); process.exit(1); });
