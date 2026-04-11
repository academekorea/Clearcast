import type { Config } from "@netlify/functions";

// Admin-only endpoint to manually trigger pre-analysis seeding
// POST /api/trigger-seed with x-internal-secret header
export default async (req: Request) => {
  const adminUserId = req.headers.get("x-admin-userid") || "";
  const superAdminEmail = Netlify.env.get("SUPER_ADMIN_EMAIL") || "";

  if (!adminUserId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });
  }

  // Verify user is super admin via Supabase
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

  const siteUrl = Netlify.env.get("URL") || "https://podlens.app";

  // Fire background function
  fetch(`${siteUrl}/.netlify/functions/seed-analyses-background`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-trigger": "admin",
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
