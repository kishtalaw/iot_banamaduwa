// index.js

const admin = require("firebase-admin");
const {SecretManagerServiceClient} = require("@google-cloud/secret-manager");
const {onRequest} = require("firebase-functions/v2/https");
// const {onSchedule} = require("firebase-functions/v2/scheduler");

const {onValueWritten} = require("firebase-functions/v2/database");
const {CloudTasksClient} = require("@google-cloud/tasks");
const {URL} = require("url");

const tasksClient = new CloudTasksClient();
const PROJECT = process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT;
const LOCATION = "us-central1";
const QUEUE = "gate-reset-queue";
const RESET_BASEURL = `https://${LOCATION}-${PROJECT}.cloudfunctions.net`;
const functionsV1 = require("firebase-functions/v1");

// functions/index.js
exports.createDailyJob = require("./schedulerManager").createDailyJob;
exports.deleteDailyJob = require("./schedulerManager").deleteDailyJob;
exports.runDaily = require("./runDaily").runDaily;

try {
  admin.initializeApp();
} catch (e) {
  if (!e.message.includes("already exists")) {
    console.error("Firebase Admin initialization error:", e);
  }
}

/**
 * HTTP function that Cloud Tasks will call after 10s
 * to reset a gate’s command back to STOP.
 */
exports.resetGateCommand = onRequest(async (req, res) => {
  const {houseId, deviceId} = req.query;
  if (!houseId || !deviceId) {
    return res.status(400).send("Missing houseId or deviceId");
  }

  const cmdRef = admin.database().ref(`houses/${houseId}/devices/${deviceId}/command`);
  const snap = await cmdRef.once("value");
  const cmd = snap.val();
  if (cmd === "OPEN" || cmd === "CLOSE") {
    await cmdRef.set("STOP");
    console.log(`Auto-reset gate ${houseId}/${deviceId} → STOP`);
  }
  res.status(200).send("OK");
});

/**
 * Database trigger on any write to /houses/{h}/devices/{d}/command.
 * Enqueues a Cloud Task to call resetGateCommand in 10 seconds.
 */
exports.enqueueGateReset = onValueWritten(
    {ref: "houses/{houseId}/devices/{deviceId}/command", region: LOCATION},
    async (event) => {
      const after = event.data.after.val();
      if (after !== "OPEN" && after !== "CLOSE") {
        return null;
      }
      const {houseId, deviceId} = event.params;

      // Confirm this device is a gate
      const typeSnap = await admin.database()
          .ref(`houses/${houseId}/devices/${deviceId}/type`)
          .once("value");
      if (typeSnap.val() !== "gate") {
        return null;
      }

      // Build the URL for our reset handler
      const url = new URL(`${RESET_BASEURL}/resetGateCommand`);
      url.searchParams.append("houseId", houseId);
      url.searchParams.append("deviceId", deviceId);

      const parent = tasksClient.queuePath(PROJECT, LOCATION, QUEUE);
      const scheduleTime = {
        seconds: Math.floor(Date.now() / 1000) + 10,
      };

      const task = {
        httpRequest: {
          httpMethod: "GET",
          url: url.toString(),
        },
        scheduleTime,
      };

      await tasksClient.createTask({parent, task});
      console.log(`Enqueued reset task for ${houseId}/${deviceId} at +10s`);
      return null;
    },
);

const secretClient = new SecretManagerServiceClient();

/**
 * Fetches the “latest” version of a Secret Manager secret.
 *
 * @param {string} secretName The full resource name of the secret version,
 *   e.g. "projects/<PROJECT_ID>/secrets/SECRETS_API_KEY/versions/latest".
 * @return {Promise<string>} The secret’s plaintext as a UTF-8 string.
 */
async function getSecretPayload(secretName) {
  try {
    const [accessResponse] = await secretClient.accessSecretVersion({name: secretName});
    return accessResponse.payload.data.toString("utf8");
  } catch (err) {
    console.error(`Failed to access secret ${secretName}:`, err);
    throw new Error("Failed to retrieve configured secret.");
  }
}

// index.js (inside your existing file, replace the old `exports.hello`)

exports.hello = onRequest(async (req, res) => {
  console.log("Request received. Headers:", JSON.stringify(req.headers));
  console.log("Request body:", JSON.stringify(req.body));

  // Ensure Firebase Admin is initialized for Auth and DB access
  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp();
  }

  // 1) Only allow POST
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed: Only POST is accepted.");
  }

  // 2) Fetch API key from Secret Manager
  const secretResource =
    "projects/home-automation-460908/secrets/SECRETS_API_KEY/versions/latest";
  let API_KEY;
  try {
    API_KEY = await getSecretPayload(secretResource);
  } catch (err) {
    return res.status(500).send("Internal Server Error: Cannot retrieve API key.");
  }

  // 3) Validate x-api-key header
  const apiKeyHeader = req.headers["x-api-key"];
  if (apiKeyHeader !== API_KEY) {
    return res.status(401).send("Unauthorized: Invalid API key.");
  }

  // 4) Parse & validate body: uid, houseId, deviceId, command
  let uid; let houseId; let deviceId; let command;
  try {
    const p = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    ({uid, houseId, deviceId, command} = p);

    if (
      !uid || !houseId || !deviceId || !command ||
      [uid, houseId, deviceId, command].some((x) => typeof x !== "string")
    ) {
      return res.status(400).send("Bad Request: uid, houseId, deviceId and command must be strings.");
    }

    const valid = ["OPEN", "CLOSE", "STOP", "ON", "OFF"];
    if (!valid.includes(command)) {
      return res.status(400).send(`Bad Request: command must be one of ${valid.join(",")}.`);
    }
  } catch (e) {
    return res.status(400).send("Bad Request: malformed JSON.");
  }

  const db = admin.database();

  // 5) Check user_access under correct path:
  try {
    const accessSnap = await db
        .ref(`user_access/${uid}/${deviceId}/${houseId}`)
        .once("value");
    if (!accessSnap.exists()) {
      return res.status(403).send("Forbidden: not authorized for this device.");
    }
  } catch (e) {
    console.error("Auth check DB error:", e);
    return res.status(500).send("Internal Server Error: could not verify access.");
  }

  // 6) Load device metadata to discover its type
  let deviceType = null;
  try {
    const deviceSnap = await db
        .ref(`houses/${houseId}/devices/${deviceId}/type`)
        .once("value");
    deviceType = deviceSnap.exists() ? deviceSnap.val() : null;
    console.log(`Device ${deviceId} type = ${deviceType}`);
  } catch (e) {
    console.warn("Could not read device type, proceeding anyway:", e);
  }

  // AFTER user-access check, BEFORE writing command:
  const deviceRef = db.ref(`houses/${houseId}/devices/${deviceId}`);

  try {
    // read lastSeen
    const lastSeenSnap = await deviceRef.child("lastSeen").once("value");
    const lastSeen = lastSeenSnap.exists() ? lastSeenSnap.val() : 0;
    const now = Date.now();

    // allow only if seen within the last 60 seconds
    const OFFLINE_THRESHOLD = 45 * 1000;
    if ((now - lastSeen > OFFLINE_THRESHOLD)  &&  (deviceType === "gate")) {
      console.warn(`Device ${deviceId} offline (lastSeen ${now - lastSeen}ms ago)`);
      return res.status(409).send("Device appears offline. Try again when it reconnects.");
    }
  } catch (err) {
    console.error("Error checking device lastSeen:", err);
    return res.status(500).send("Internal Server Error during device-online check.");
  }

  // 7) Write the command + timestamp
  try {
    const now = Date.now();
    const cmdRef = db.ref(`houses/${houseId}/devices/${deviceId}`);
    await cmdRef.update({
      command,
      commandTimestamp: now,
    });
    console.log(`Wrote command ${command} @ ${houseId}/${deviceId}`);

    // --- 8) AUDIT LOGGING & 30-DAY CLEANUP ---
    let userEmail = "Unknown";
    let userName = "Unknown";
    
    try {
      const userRecord = await admin.auth().getUser(uid);
      userEmail = userRecord.email || "No email";
      userName = userRecord.displayName || "No name";
    } catch (authErr) {
      console.warn(`Could not fetch user details for uid: ${uid}`);
    }

    const logsRef = db.ref(`houses/${houseId}/logs`);

	const OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const localDateString = new Date(now + OFFSET_MS).toISOString().replace("Z", "+05:30");
    
    try {
      // A) Write the new log entry
      await logsRef.push({
        uid,
        email: userEmail,
        name: userName,
        action: command,
        deviceId,
        timestamp: now,
        dateString: localDateString
      });

      // B) Clean up logs older than 30 days
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      const cutoffTime = now - THIRTY_DAYS_MS;
      
      const oldLogsSnap = await logsRef
          .orderByChild("timestamp")
          .endAt(cutoffTime)
          .once("value");

      if (oldLogsSnap.exists()) {
        const updates = {};
        oldLogsSnap.forEach((child) => {
          updates[child.key] = null; // Setting to null deletes the node
        });
        await logsRef.update(updates);
        console.log(`Cleaned up ${Object.keys(updates).length} log entries older than 30 days.`);
      }
    } catch (logErr) {
      console.error("Failed to write audit log or run cleanup:", logErr);
    }
    // --- END AUDIT LOGGING ---

    return res.status(200).json({
      success: true,
      houseId,
      deviceId,
      command,
      deviceType,
    });
  } catch (e) {
    console.error("DB write error:", e);
    return res.status(500).send("Internal Server Error: could not write command.");
  }
});

/**
 * V1 Database trigger that fires whenever a command is written.
 * This captures direct database writes from the Web and Android Firebase SDKs.
 */
exports.logAppCommands = functionsV1.database
    .ref("houses/{houseId}/devices/{deviceId}/command")
    .onWrite(async (change, context) => {
      const command = change.after.val();

      // Ignore deletions or the automated "STOP" commands sent by the system
      if (!command || command === "STOP") {
        return null;
      }

      const auth = context.auth;
	  
	  if (!auth || !auth.uid) {
        console.log("Write originated from backend/Admin SDK. Skipping duplicate log.");
        return null;
      }
	  
	  // If we reach this point, it came from the Android or Web app directly!
      const uid = auth.uid;
      let userEmail = "Unknown";
      let userName = "Unknown";

      // Extract the UID if the write came from an authenticated Firebase SDK user
      if (auth && auth.uid) {
        uid = auth.uid;
        try {
          const userRecord = await admin.auth().getUser(uid);
          userEmail = userRecord.email || "No email";
          userName = userRecord.displayName || "No name";
        } catch (e) {
          console.warn(`Could not fetch user details for uid: ${uid}`);
        }
      } else if (auth && auth.admin) {
        uid = "System/Admin";
        userName = "Automated Task";
      }

      const houseId = context.params.houseId;
      const deviceId = context.params.deviceId;
      const now = Date.now();
      const logsRef = admin.database().ref(`houses/${houseId}/logs`);

	  // Calculate local time (+05:30)
      const OFFSET_MS = 5.5 * 60 * 60 * 1000;
      const localDateString = new Date(now + OFFSET_MS).toISOString().replace("Z", "+05:30");

      try {
      // A) Write the audit log
        await logsRef.push({
          uid,
          email: userEmail,
          name: userName,
          action: command,
          deviceId,
          timestamp: now,
          dateString: localDateString,
          source: "Firebase SDK App",
        });

        // B) Clean up logs older than 30 days
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
        const cutoffTime = now - THIRTY_DAYS_MS;

        const oldLogsSnap = await logsRef
            .orderByChild("timestamp")
            .endAt(cutoffTime)
            .once("value");

        if (oldLogsSnap.exists()) {
          const updates = {};
          oldLogsSnap.forEach((child) => {
            updates[child.key] = null; // Setting to null deletes the node
          });
          await logsRef.update(updates);
          console.log(`Cleaned up ${Object.keys(updates).length} log entries older than 30 days.`);
        }
      } catch (logErr) {
        console.error("Failed to write database audit log:", logErr);
      }

      return null;
    });
