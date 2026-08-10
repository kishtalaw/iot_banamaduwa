// schedulerManager.js

const admin = require("firebase-admin");
const {CloudSchedulerClient} = require("@google-cloud/scheduler");
const {onValueWritten} = require("firebase-functions/v2/database");

// Initialize Firebase Admin if not already initialized
try {
  admin.initializeApp();
} catch (e) {
  if (!e.message.includes("already exists")) {
    console.error("Firebase Admin initialization error:", e);
  }
}

// Scheduler client
const scheduler = new CloudSchedulerClient();
const PROJECT = process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT;
const LOCATION = "us-central1";

/**
 * Generate a unique Cloud Scheduler job name.
 *
 * @param {string} key      The Realtime DB key of the schedule entry.
 * @param {string} timeKey  The "HH:MM" local time string.
 * @return {string}         A valid, unique job name for Cloud Scheduler.
 */
/**
 * Generate a unique Cloud Scheduler job name for a schedule entry.
 *
 * @param {string} key      The Realtime DB key of the schedule entry.
 * @param {string} timeKey  The "HH:MM" local time string.
 * @return {string}         A valid, unique job name for Cloud Scheduler.
 */
function jobNameFor(key, timeKey) {
  const cleanTimeKey = timeKey.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `daily-${cleanTimeKey}-${safeKey}`;
}

/**
 * Create a Cloud Scheduler job for each new or updated daily schedule.
 */
exports.createDailyJob = onValueWritten(
    {ref: "scheduled_commands/{key}", region: LOCATION},
    async (event) => {
      const data = event.data.after.val();
      const key = event.params.key;
      if (!data || data.type !== "daily") {
        return null;
      }

      // Convert local (UTC+5:30) HH:MM -> UTC cron
      const [hh, mm] = data.timeKey.split(":").map(Number);
      let utcMin = mm - 30;
      let utcHr = hh - 5;
      if (utcMin < 0) {
        utcMin += 60; utcHr -= 1;
      }
      if (utcHr < 0) {
        utcHr += 24;
      }
      const cron = `${utcMin} ${utcHr} * * *`;

      // Build the job definition
      const job = {
        name: scheduler.jobPath(PROJECT, LOCATION, jobNameFor(key, data.timeKey)),
        schedule: cron,
        timeZone: "UTC",
        httpTarget: {
          uri: `https://${LOCATION}-${PROJECT}.cloudfunctions.net/runDaily`,
          httpMethod: "POST",
          body: Buffer.from(JSON.stringify({key})).toString("base64"),
          headers: {"Content-Type": "application/json"},
        },
      };

      // Compute parent path at runtime
      const parent = scheduler.locationPath(PROJECT, LOCATION);
      await scheduler.createJob({parent, job});
      console.log(`Created daily cron job ${job.name} @ ${cron} UTC`);
      return null;
    },
);

/**
 * Delete the Cloud Scheduler job when a daily schedule is removed.
 */
exports.deleteDailyJob = onValueWritten(
    {ref: "scheduled_commands/{key}", region: LOCATION},
    async (event) => {
    // Only on deletion
      if (event.data.after.exists()) {
        return null;
      }

      const key = event.params.key;
      const parent = scheduler.locationPath(PROJECT, LOCATION);
      const [jobs] = await scheduler.listJobs({parent});
      for (const job of jobs) {
        if (job.name.endsWith(`-${key}`)) {
          await scheduler.deleteJob({name: job.name});
          console.log(`Deleted cron job ${job.name}`);
        }
      }
      return null;
    },
);
