import type { Config } from "@netlify/functions";
import { isSuperAdmin } from "./lib/admin.js";
import { checkRateLimit, getClientIp, rateLimitResponse, verifyAdminToken } from "./lib/security.js";

const SB_URL = "https://suqjdctajnitxivczjtg.supabase.co";
const BACKUP_BUCKET = "podlens-backups";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json" },
  });
}

function rowsToCSV(rows: any[]): string {
  if (!rows || rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  };
  return [
    headers.join(","),
    ...rows.map(r => headers.map(h => escape(r[h])).join(",")),
  ].join("\n");
}

export default async (req: Request) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const clientIp = getClientIp(req);
  const rl = await checkRateLimit(clientIp, "download-backup", 5, 60);
  if (!rl.allowed) return rateLimitResponse(rl.resetIn);

  const url = new URL(req.url);
  const email = url.searchParams.get("email") || "";
  const userId = url.searchParams.get("userId") || "";
  const adminToken = req.headers.get("x-admin-token") || "";
  const dateParam = url.searchParams.get("date") || "";
  const tableParam = url.searchParams.get("table") || ""; // optional: download single table

  if (!isSuperAdmin(email)) {
    return json({ error: "Unauthorized" }, 403);
  }

  if (userId && adminToken) {
    const valid = await verifyAdminToken(userId, adminToken);
    if (!valid) return json({ error: "Invalid admin token" }, 403);
  }

  const sbKey = Netlify.env.get("SUPABASE_SERVICE_KEY") || "";
  const sbHeaders: HeadersInit = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json" };

  // List available backups if no date specified
  if (!dateParam) {
    try {
      const res = await fetch(`${SB_URL}/storage/v1/object/list/${BACKUP_BUCKET}`, {
        method: "POST",
        headers: sbHeaders,
        body: JSON.stringify({ prefix: "backup-", limit: 100, sortBy: { column: "name", order: "desc" } }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error("list failed");
      const files = await res.json();
      const backups = (files || [])
        .map((f: any) => f.name)
        .filter((n: string) => n.startsWith("backup-"))
        .map((n: string) => n.replace("backup-", "").replace(".json", ""))
        .sort()
        .reverse();
      return json({ backups });
    } catch (err) {
      return json({ error: "Failed to list backups" }, 500);
    }
  }

  // Fetch specific backup from Supabase Storage
  let backup: any;
  try {
    const res = await fetch(`${SB_URL}/storage/v1/object/${BACKUP_BUCKET}/backup-${dateParam}.json`, {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error("not found");
    backup = await res.json();
  } catch {
    return json({ error: "Backup not found" }, 404);
  }

  if (!backup) return json({ error: "Backup not found" }, 404);

  // If table param — return single table as CSV
  if (tableParam) {
    const rows = backup.data?.[tableParam];
    if (!rows) return json({ error: `Table "${tableParam}" not in backup` }, 404);

    const csv = rowsToCSV(rows);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="podlens-${tableParam}-${dateParam}.csv"`,
      },
    });
  }

  // Return all tables as a JSON bundle (client can save as .json)
  return new Response(JSON.stringify(backup, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="podlens-backup-${dateParam}.json"`,
    },
  });
};

export const config: Config = { path: "/api/download-backup" };
