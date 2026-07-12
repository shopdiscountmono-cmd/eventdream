const admin = require("firebase-admin");

const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function migrate() {
  const oldSnap = await db.collection("app").doc("orders").get();

  const orders = oldSnap.data().value || [];

  console.log(`Trouvé ${orders.length} devis`);

  for (const order of orders) {
    await db.collection("orders").doc(order.id).set(order);
  }

  console.log("Migration terminée");
}

migrate().catch(console.error);