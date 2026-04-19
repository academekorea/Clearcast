import type { Config } from "@netlify/functions";
import { runBackup } from "./lib/backup.js";

// Scheduled function — runs every Sunday at 2am UTC
// No path — Netlify scheduled functions must not have an HTTP route
// For manual triggers, use POST /api/run-backup instead

export default async () => {
  await runBackup();
};

export const config: Config = {
  schedule: "0 2 * * 0",
};
