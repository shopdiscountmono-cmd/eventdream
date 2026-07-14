/**
 * Migration Phase 1 — EventDream
 * Copie les commandes du tableau app/orders vers des documents individuels
 * dans la collection "orders". Non destructif : l'ancienne structure reste
 * intacte jusqu'à validation complète.
 *
 * Lance depuis ~/Desktop/eventdream/functions :
 *   node migrate_orders.cjs
 */
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

if (!getApps().length) {
  initializeApp({ credential: cert(require("./serviceAccountKey.json")) });
}

const db = getFirestore();

async function main() {
  console.log("🔄 Lecture de app/orders...");
  const snap = await db.collection("app").doc("orders").get();
  const orders = snap.exists ? (snap.data().value || []) : [];
  console.log(`📋 ${orders.length} commandes trouvées`);

  if (orders.length === 0) {
    console.log("❌ Aucune commande à migrer.");
    return;
  }

  // Vérification : combien sont déjà dans la nouvelle collection ?
  const existingSnap = await db.collection("orders").limit(1).get();
  if (!existingSnap.empty) {
    console.log("⚠️  La collection 'orders' contient déjà des documents.");
    console.log("    Si tu veux relancer la migration, vide d'abord la collection.");
    return;
  }

  // Migration par batch (Firestore limite à 500 opérations par batch)
  const BATCH_SIZE = 400;
  let migrated = 0;
  let skipped = 0;

  for (let i = 0; i < orders.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = orders.slice(i, i + BATCH_SIZE);

    for (const order of chunk) {
      if (!order.id) {
        console.warn(`  ⚠️  Commande sans ID ignorée :`, JSON.stringify(order).slice(0, 80));
        skipped++;
        continue;
      }
      const ref = db.collection("orders").doc(order.id);
      // Nettoyage : retire les undefined (refusés par Firestore)
      const clean = JSON.parse(JSON.stringify(order));
      batch.set(ref, clean);
      migrated++;
    }

    await batch.commit();
    console.log(`  ✅ Batch ${Math.floor(i / BATCH_SIZE) + 1} : ${Math.min(i + BATCH_SIZE, orders.length)}/${orders.length} commandes`);
  }

  console.log(`\n🎉 Migration terminée !`);
  console.log(`   ✅ ${migrated} commandes migrées dans la collection "orders"`);
  if (skipped > 0) console.log(`   ⚠️  ${skipped} commandes ignorées (sans ID)`);
  console.log(`\n⚠️  L'ancienne structure app/orders est conservée.`);
  console.log(`   Elle sera supprimée après validation complète de l'app.`);
}

main().catch(err => {
  console.error("❌ Erreur :", err.message || err);
  process.exit(1);
});
