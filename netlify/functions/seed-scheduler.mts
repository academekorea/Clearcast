import type { Config } from "@netlify/functions";

// Scheduled trigger — fires daily at 3am UTC
// Kicks off the background seeder which has a 15-minute window
export default async (req: Request) => {
  const siteUrl = Netlify.env.get("URL") || "https://podlens.app";
  const secret = Netlify.env.get("YOUTUBE_SERVICE_SECRET") || "";

  try {
    // Trigger the background function — returns 202 immediately, runs async
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
