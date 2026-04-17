import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Scheduled trigger — fires daily at 3am UTC
// Kicks off the background seeder which has a 15-minute window
// Can be paused via admin dashboard (stores flag in Netlify Blobs)
export default async (req: Request) => {
  // Check if auto pre-analysis is paused
  try {
    const metaStore = getStore("podlens-meta");
    const flag = await metaStore.get("seed-auto-paused", { type: "json" }) as any;
    if (flag?.paused) {
      console.log("[seed-scheduler] Auto pre-analysis is PAUSED — skipping");
      return;
    }
  } catch {}

  const siteUrl = Netlify.env.get("URL") || "https://podlens.app";
  const secret = Netlify.env.get("YOUTUBE_SERVICE_SECRET") || "";

  try {
    await fetch(`${siteUrl}/.netlify/functions/seed-analyses-background`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify({ trigger: "scheduled" }),
      signal: AbortSignal.timeout(5000),
    });
    console.log("[seed-scheduler] Background seeder triggered");
  } catch (e: any) {
    console.warn("[seed-scheduler] Failed to trigger background seeder:", e?.message);
  }
};

export const config: Config = {
  schedule: "0 3 * * *", // Daily 3am UTC
};
