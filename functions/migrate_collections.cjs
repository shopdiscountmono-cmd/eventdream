/**
 * Migration Phase 2 — EventDream
 * Copie clients, stock et expenses vers des documents individuels.
 * Lance depuis ~/Desktop/eventdream/functions :
 *   node migrate_collections.cjs
 */
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

if (!getApps().length) {
  initializeApp({ credential: cert(require("./serviceAccountKey.json")) });
}

const db = getFirestore();

async function migrateCollection(name, idField = "id") {
  console.log(`\n🔄 Migration de "${name}"...`);

  // Lire l'ancienne structure monolithique
  const snap = await db.collection("app").doc(name).get();
  if (!snap.exists) { console.log(`  ⚠️  app/${name} n'existe pas, ignoré.`); return 0; }
  const items = snap.data().value || [];
  if (!Array.isArray(items) || items.length === 0) { console.log(`  ⚠️  Aucun item dans app/${name}.`); return 0; }
  console.log(`  📋 ${items.length} items trouvés`);

  // Vérifier si la collection individuelle existe déjà
  const existing = await db.collection(name).limit(1).get();
  if (!existing.empty) {
    console.log(`  ✅ La collection "${name}" existe déjà — migration ignorée.`);
    return 0;
  }

  // Écriture par batch
  let migrated = 0;
  const BATCH_SIZE = 400;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = items.slice(i, i + BATCH_SIZE);
    for (const item of chunk) {
      const id = String(item[idField] || item.id || `${name}_${i}_${Math.random().toString(36).slice(2)}`);
      const clean = JSON.parse(JSON.stringify({ ...item, id }));
      batch.set(db.collection(name).doc(id), clean);
      migrated++;
    }
    await batch.commit();
    console.log(`  ✅ ${Math.min(i + BATCH_SIZE, items.length)}/${items.length}`);
  }

  console.log(`  🎉 ${migrated} items migrés dans la collection "${name}"`);
  return migrated;
}

async function main() {
  let total = 0;
  total += await migrateCollection("clients");
  total += await migrateCollection("stock");
  total += await migrateCollection("expenses");

  console.log(`\n✅ Migration terminée : ${total} documents créés au total.`);
  console.log(`⚠️  Les anciennes structures app/clients, app/stock, app/expenses sont conservées.`);
  console.log(`   Supprime-les depuis la console Firebase après validation de l'app.`);
}

main().catch(err => { console.error("❌ Erreur :", err.message || err); process.exit(1); });
