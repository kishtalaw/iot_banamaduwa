// functions/runDaily.js
const admin = require("firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp();
}

const {onRequest} = require("firebase-functions/v2/https");

exports.runDaily = onRequest(async (req, res) => {
  let body;
  try {
    body = JSON.parse(Buffer.from(req.body, "base64").toString());
  } catch (e) {
    return res.status(400).send("Invalid payload");
  }

  const {key} = body;
  if (!key) return res.status(400).send("Missing schedule key");

  const snap = await admin.database().ref(`/scheduled_commands/${key}`).once("value");
  if (!snap.exists()) return res.status(404).send("No such schedule");

  const data = snap.val();
  const now = Date.now() + 5.5 * 3600 * 1000; // UTC +5:30
  const today = new Date(now).toISOString().slice(0, 10);
  if (data.lastRunDate === today) {
    console.log(`Already ran ${key}`);
    return res.status(200).send("Already executed");
  }

  await admin
      .database()
      .ref(`/houses/${data.houseId}/devices/${data.deviceId}/command`)
      .set(data.command);

  await snap.ref.update({lastRunDate: today});
  console.log(`Executed daily ${key}`);
  res.status(200).send("Executed");
});
