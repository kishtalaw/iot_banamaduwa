// functions/index.js

const functions = require("firebase-functions");
const admin = require("firebase-admin");

try {
  admin.initializeApp();
} catch (e) {
  if (!e.message.includes("already exists")) {
    console.error("Firebase Admin SDK init error:", e);
  }
}

// This runs every minute, checks for any commands that should fire now or earlier.
exports.runScheduledCommands = functions
  .pubsub
  .schedule("* * * * *")
  .timeZone("Asia/Colombo")
  .onRun(async (context) => {
    const now = Date.now();
    const db = admin.database();
    const schedRef = db.ref("scheduled_commands");

    try {
      // Query only entries where runAt <= now. 
      // Realtime DB doesn’t support “<=” on arbitrary child keys,
      // but you can orderByChild('runAt') and endAt(now).
      const snapshot = await schedRef
        .orderByChild("runAt")
        .endAt(now)
        .once("value");

      if (!snapshot.exists()) {
        console.log("No scheduled commands to run at", new Date(now).toLocaleString());
        return null;
      }

      const updates = [];  // Will hold promises
      const toDelete = [];

      snapshot.forEach(childSnap => {
        const key   = childSnap.key;
        const data  = childSnap.val();
        const { houseId, deviceId, command } = data;

        // 1. Schedule writing the command to the device path
        const cmdRef = db.ref(`/houses/${houseId}/devices/${deviceId}/command`);
        updates.push(cmdRef.set(command));

        // 2. Mark the scheduled entry for deletion
        toDelete.push(schedRef.child(key).remove());
      });

      // Wait for all writes + deletes in parallel
      await Promise.all([...updates, ...toDelete]);
      console.log(`Executed ${updates.length} scheduled command(s).`);
    } catch (err) {
      console.error("Error running scheduled commands:", err);
    }
    return null;
  });
