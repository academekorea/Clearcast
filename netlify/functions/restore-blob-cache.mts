import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { isSuperAdmin } from "./lib/admin.js";
import { checkRateLimit, getClientIp, rateLimitResponse, verifyAdminToken } from "./lib/security.js";

const SB_URL = "https://suqjdctajnitxivczjtg.supabase.co";

function sbHeaders(): HeadersInit {
  const key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const clientIp = getClientIp(req);
  const rl = await checkRateLimit(clientIp, "restore-blob-cache", 3, 300);
  if (!rl.allowed) return rateLimitResponse(rl.resetIn);

  const url = new URL(req.url);
  const email = url.searchParams.get("email") || "";
  const userId = url.searchParams.get("userId") || "";
  const adminToken = req.headers.get("x-admin-token") || "";

  if (!isSuperAdmin(email)) {
    return json({ error: "Unauthorized" }, 403);
  }

  if (userId && adminToken) {
    const valid = await verifyAdminToken(userId, adminToken);
    if (!valid) return json({ error: "Invalid admin token" }, 403);
  }

  // Fetch all analyses with result_json from Supabase
  const rows: any[] = [];
  let offset = 0;
  const limit = 500;
  let page = 0;

  while (page < 20) { // safety cap: max 10,000 analyses
    try {
      const res = await fetch(
        `${SB_URL}/rest/v1/analyses?select=id,result_json,cache_key&not.result_json.is=null&limit=${limit}&offset=${offset}`,
        { headers: sbHeaders(), signal: AbortSignal.timeout(30000) }
      );
      if (!res.ok) break;
      const batch = await res.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      rows.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
      page++;
    } catch { break; }
  }

  // Restore to Netlify Blobs
  const jobStore = getStore("podlens-jobs");
  let restored = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.result_json) { skipped++; continue; }
    const key = row.cache_key || row.id;
    try {
      await jobStore.setJSON(key, row.result_json);
      restored++;
    } catch {
      failed++;
    }
  }

  console.log(`[restore-blob-cache] restored=${restored} skipped=${skipped} failed=${failed}`);

  return json({
    ok: true,
    total: rows.length,
    restored,
    skipped,
    failed,
    message: `Restored ${restored} analyses to Netlify Blobs cache`,
  });
};

export const config: Config = { path: "/api/restore-blob-cache" };
