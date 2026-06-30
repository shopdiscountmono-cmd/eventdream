/**
 * Script de récupération des clients depuis les commandes Firestore
 * Lance depuis ~/Desktop/eventdream/functions :
 *   node recover_clients.cjs
 */
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

if (!getApps().length) {
  initializeApp({ credential: cert(require("./serviceAccountKey.json")) });
}

async function main() {
  const db = getFirestore();
  console.log("🔄 Lecture des commandes...");

  const ordersSnap = await db.collection("app").doc("orders").get();
  const orders = ordersSnap.exists ? ordersSnap.data().value : [];
  console.log(`📋 ${orders.length} commandes trouvées`);

  // Récupération des clients existants (pour ne pas écraser celui qui existe déjà)
  const clientsSnap = await db.collection("app").doc("clients").get();
  const existingClients = clientsSnap.exists ? (clientsSnap.data().value || []) : [];
  console.log(`👥 ${existingClients.length} client(s) existant(s)`);

  // Reconstruction des clients uniques depuis les commandes
  const clientMap = new Map();

  // Garder les clients existants
  existingClients.forEach(c => clientMap.set(c.name?.toLowerCase().trim(), c));

  // Extraire les clients des commandes
  orders.forEach(o => {
    const name = (o.clientName || "").trim();
    if (!name || name === "Client import" || name.startsWith("Client import ")) return;
    const key = name.toLowerCase();
    if (!clientMap.has(key)) {
      const phone = (o.clientPhone || "").trim();
      const address = (o.address || "").trim();
      clientMap.set(key, {
        id: "cli-recovered-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
        name,
        phones: phone ? [phone] : [""],
        email: "",
        addresses: address ? [address] : [""],
        notes: "",
      });
    } else {
      // Enrichir le client existant avec les infos manquantes
      const existing = clientMap.get(key);
      const phone = (o.clientPhone || "").trim();
      const address = (o.address || "").trim();
      if (phone && (!existing.phones || !existing.phones.includes(phone))) {
        existing.phones = [...(existing.phones || [""]).filter(Boolean), phone];
        existing.phones = [...new Set(existing.phones)];
      }
      if (address && (!existing.addresses || !existing.addresses.includes(address))) {
        existing.addresses = [...(existing.addresses || [""]).filter(Boolean), address];
        existing.addresses = [...new Set(existing.addresses)];
      }
    }
  });

  const clients = Array.from(clientMap.values());
  console.log(`✅ ${clients.length} clients reconstruits`);

  // Exemple des 3 premiers
  console.log("\nExemples :");
  clients.slice(0, 3).forEach(c => console.log(` - ${c.name} | ${(c.phones||[]).join(", ")} | ${(c.addresses||[]).join(", ")}`));

  console.log("\n⏳ Écriture dans Firestore...");
  await db.collection("app").doc("clients").set({ value: clients });
  console.log(`🎉 ${clients.length} clients restaurés dans Firestore !`);
}

main().catch(err => { console.error("❌ Erreur :", err.message || err); process.exit(1); });
