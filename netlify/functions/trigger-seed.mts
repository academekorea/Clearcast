import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Admin-only endpoint to manually trigger pre-analysis seeding
// Also handles GET/PUT for auto-seed toggle
// POST /api/trigger-seed — trigger manual seed
// GET  /api/trigger-seed — get auto-seed status
// PUT  /api/trigger-seed — set auto-seed enabled/disabled
async function verifyAdmin(req: Request): Promise<Response | null> {
  const adminUserId = req.headers.get("x-admin-userid") || "";
  const superAdminEmail = Netlify.env.get("SUPER_ADMIN_EMAIL") || "";

  if (!adminUserId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });
  }

  const sbUrl = Netlify.env.get("SUPABASE_URL");
  const sbKey = Netlify.env.get("SUPABASE_SERVICE_KEY");
  if (sbUrl && sbKey) {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } });
    const { data: user } = await sb.from("users").select("email").eq("id", adminUserId).single();
    if (!user || user.email !== superAdminEmail) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json" }
      });
    }
  }

  return null; // authorized
}

export default async (req: Request) => {
  const store = getStore("podlens-settings");

  // GET — return current auto-seed status
  if (req.method === "GET") {
    const authErr = await verifyAdmin(req);
    if (authErr) return authErr;

    let enabled = true;
    try {
      const flag = await store.get("auto-seed-enabled");
      if (flag === "false") enabled = false;
    } catch {}

    return new Response(JSON.stringify({ autoSeedEnabled: enabled }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // PUT — toggle auto-seed on/off
  if (req.method === "PUT") {
    const authErr = await verifyAdmin(req);
    if (authErr) return authErr;

    const body = await req.json().catch(() => ({}));
    const enabled = Boolean(body.enabled);
    await store.set("auto-seed-enabled", enabled ? "true" : "false");

    return new Response(JSON.stringify({ autoSeedEnabled: enabled }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // POST — trigger manual seed
  const authErr = await verifyAdmin(req);
  if (authErr) return authErr;

  const siteUrl = Netlify.env.get("URL") || "https://podlens.app";
  const secret = Netlify.env.get("YOUTUBE_SERVICE_SECRET") || "";

  // Fire background function using real secret
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
    shows: 64,
    episodesPerShow: 2,
    estimatedMinutes: 25
  }), {
    status: 202,
    headers: { "Content-Type": "application/json" }
  });
};

export const config: Config = { path: "/api/trigger-seed" };
