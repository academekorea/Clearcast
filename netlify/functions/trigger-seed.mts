import type { Config } from "@netlify/functions";

// Admin-only endpoint to manually trigger pre-analysis seeding
// POST /api/trigger-seed with x-internal-secret header
export default async (req: Request) => {
  const secret = Netlify.env.get("YOUTUBE_SERVICE_SECRET") || "";
  const provided = req.headers.get("x-internal-secret") || "";

  if (!secret || provided !== secret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });
  }

  const siteUrl = Netlify.env.get("URL") || "https://podlens.app";

  // Fire background function
  fetch(`${siteUrl}/.netlify/functions/seed-analyses-background`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": secret,
    },
    body: JSON.stringify({ trigger: "manual" }),
  }).catch(() => {});

  return new Response(JSON.stringify({
    status: "triggered",
    message: "Pre-analysis seeding started. Check function logs for progress.",
    shows: 16,
    episodesPerShow: 2,
    estimatedMinutes: 6
  }), {
    status: 202,
    headers: { "Content-Type": "application/json" }
  });
};

export const config: Config = { path: "/api/trigger-seed" };
