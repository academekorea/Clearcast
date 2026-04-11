import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { isSuperAdmin } from "./lib/admin.js";
import { checkRateLimit, getClientIp, rateLimitResponse, verifyAdminToken, sha256hex } from "./lib/security.js";

const SB_URL = "https://suqjdctajnitxivczjtg.supabase.co";

function sbHeaders(): HeadersInit {
  const key = Netlify.env.get("SUPABASE_SERVICE_KEY") || "";
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function sbGet(path: string): Promise<any[]> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
      headers: sbHeaders(), signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

async function sbRpc(fn: string, params: Record<string, unknown> = {}): Promise<any> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export default async (req: Request) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const clientIp = getClientIp(req);

  // Strict rate limit for admin: 5 requests per minute per IP
  const rl = await checkRateLimit(clientIp, "admin", 5, 60);
  if (!rl.allowed) return rateLimitResponse(rl.resetIn);

  // Double auth check: email + admin token
  const url = new URL(req.url);
  const email = url.searchParams.get("email") || "";
  const userId = url.searchParams.get("userId") || "";
  const adminToken = req.headers.get("x-admin-token") || url.searchParams.get("adminToken") || "";

  // Layer 1: email must be super admin
  if (!isSuperAdmin(email)) {
    // Log unauthorized attempt
    console.warn(`Unauthorized admin access attempt from IP ${clientIp}, email: ${email}`);
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 403, headers: { "Content-Type": "application/json" }
    });
  }

  // Layer 2: token must match (if userId provided; skip during initial page load before token available)
  if (userId && adminToken) {
    const tokenValid = await verifyAdminToken(userId, adminToken);
    if (!tokenValid) {
      console.warn(`Invalid admin token from IP ${clientIp}, userId: ${userId}`);
      return new Response(JSON.stringify({ error: "Invalid admin token" }), {
        status: 403, headers: { "Content-Type": "application/json" }
      });
    }
  }

  const tab = url.searchParams.get("tab") || "overview";

  // Handle control actions (POST)
  if (req.method === "POST") {
    let body: any = {};
    try { body = await req.json(); } catch {}
    return handleControl(body, email);
  }

  switch (tab) {
    case "overview": return getOverview();
    case "users": return getUsers(url);
    case "analyses": return getAnalyses(url);
    case "revenue": return getRevenue();
    case "funnel": return getFunnel();
    case "shows": return getShows();
    case "events": return getEvents(url);
    default: return new Response(JSON.stringify({ error: "Unknown tab" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }
};

async function getOverview() {
  const [users, analyses, subs, events] = await Promise.all([
    sbGet("users?select=id,plan,created_at,last_seen_at&order=created_at.desc"),
    sbGet("analyses?select=id,created_at&order=created_at.desc&limit=1000"),
    sbGet("subscriptions?select=id,status,plan,amount&eq.status=active"),
    sbGet("events?select=created_at,type&order=created_at.desc&limit=500"),
  ]);

  const now = Date.now();
  const day1  = now - 86400000;
  const day7  = now - 7 * 86400000;
  const day30 = now - 30 * 86400000;

  const totalUsers   = users.length;
  const newToday     = users.filter(u => new Date(u.created_at).getTime() > day1).length;
  const new7d        = users.filter(u => new Date(u.created_at).getTime() > day7).length;
  const new30d       = users.filter(u => new Date(u.created_at).getTime() > day30).length;
  const dau          = users.filter(u => u.last_seen_at && new Date(u.last_seen_at).getTime() > day1).length;
  const wau          = users.filter(u => u.last_seen_at && new Date(u.last_seen_at).getTime() > day7).length;

  const planCounts: Record<string, number> = {};
  for (const u of users) planCounts[u.plan || "free"] = (planCounts[u.plan || "free"] || 0) + 1;

  const totalAnalyses = analyses.length;
  const analyses24h   = analyses.filter(a => new Date(a.created_at).getTime() > day1).length;
  const analyses7d    = analyses.filter(a => new Date(a.created_at).getTime() > day7).length;

  const mrr = subs.reduce((sum: number, s: any) => sum + (Number(s.amount) || 0), 0);

  // DAU trend (last 7 days)
  const dauTrend = Array.from({ length: 7 }, (_, i) => {
    const d = now - (6 - i) * 86400000;
    const from = d - 86400000, to = d;
    return {
      date: new Date(d).toISOString().slice(0, 10),
      count: events.filter((e: any) => {
        const t = new Date(e.created_at).getTime();
        return t > from && t <= to;
      }).length
    };
  });

  return json({ totalUsers, newToday, new7d, new30d, dau, wau,
    planCounts, totalAnalyses, analyses24h, analyses7d, mrr, dauTrend });
}

async function getUsers(url: URL) {
  const page = parseInt(url.searchParams.get("page") || "1");
  const search = url.searchParams.get("q") || "";
  const plan = url.searchParams.get("plan") || "";

  let qs = `users?select=id,email,name,plan,created_at,last_seen_at,is_super_admin,stripe_customer_id&order=created_at.desc&limit=50&offset=${(page-1)*50}`;
  if (search) qs += `&or=(email.ilike.*${search}*,name.ilike.*${search}*)`;
  if (plan) qs += `&eq.plan=${plan}`;

  const users = await sbGet(qs);
  const countRows = await sbGet(`users?select=id${plan ? `&eq.plan=${plan}` : ""}${search ? `&or=(email.ilike.*${search}*,name.ilike.*${search}*)` : ""}`);

  return json({ users, total: countRows.length, page, perPage: 50 });
}

async function getAnalyses(url: URL) {
  const page = parseInt(url.searchParams.get("page") || "1");
  const rows = await sbGet(
    `analyses?select=id,episode_url,show_name,episode_title,user_id,created_at,status,duration_ms&order=created_at.desc&limit=50&offset=${(page-1)*50}`
  );
  const total = await sbGet("analyses?select=id");
  return json({ analyses: rows, total: total.length, page, perPage: 50 });
}

async function getRevenue() {
  const subs = await sbGet("subscriptions?select=id,plan,status,amount,created_at,canceled_at,user_id");
  const active = subs.filter((s: any) => s.status === "active");
  const canceled = subs.filter((s: any) => s.status === "canceled");
  const mrr = active.reduce((sum: number, s: any) => sum + (Number(s.amount) || 0), 0);

  const planRevenue: Record<string, { count: number; mrr: number }> = {};
  for (const s of active) {
    const p = s.plan || "unknown";
    if (!planRevenue[p]) planRevenue[p] = { count: 0, mrr: 0 };
    planRevenue[p].count++;
    planRevenue[p].mrr += Number(s.amount) || 0;
  }

  // Monthly MRR trend (last 6 months)
  const now = Date.now();
  const mrrTrend = Array.from({ length: 6 }, (_, i) => {
    const date = new Date(now);
    date.setMonth(date.getMonth() - (5 - i));
    const label = date.toISOString().slice(0, 7);
    const monthMrr = subs
      .filter((s: any) => s.status === "active" && s.created_at.startsWith(label))
      .reduce((sum: number, s: any) => sum + (Number(s.amount) || 0), 0);
    return { month: label, mrr: monthMrr };
  });

  return json({ mrr, activeCount: active.length, canceledCount: canceled.length, planRevenue, mrrTrend });
}

async function getFunnel() {
  const [users, subs] = await Promise.all([
    sbGet("users?select=id,plan,created_at"),
    sbGet("subscriptions?select=id,user_id,status,created_at")
  ]);

  const total = users.length;
  const trial = users.filter((u: any) => u.plan === "trial").length;
  const free = users.filter((u: any) => u.plan === "free").length;
  const paid = users.filter((u: any) => ["creator", "operator", "studio"].includes(u.plan)).length;
  const activeSubIds = new Set(
    subs.filter((s: any) => s.status === "active").map((s: any) => s.user_id)
  );
  const paying = activeSubIds.size;

  const trialToPaid = total > 0 ? ((paying / total) * 100).toFixed(1) : "0";
  const freeToAny = total > 0 ? (((total - free) / total) * 100).toFixed(1) : "0";

  return json({ total, trial, free, paid, paying, trialToPaid, freeToAny });
}

async function getShows() {
  const analyses = await sbGet("analyses?select=show_name,episode_url&order=created_at.desc&limit=2000");
  const counts: Record<string, number> = {};
  for (const a of analyses) {
    const key = a.show_name || "Unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  const shows = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 50)
    .map(([name, count]) => ({ name, count }));
  return json({ shows });
}

async function getEvents(url: URL) {
  const page = parseInt(url.searchParams.get("page") || "1");
  const type = url.searchParams.get("type") || "";
  let qs = `events?select=id,type,user_id,properties,created_at&order=created_at.desc&limit=50&offset=${(page-1)*50}`;
  if (type) qs += `&eq.type=${type}`;
  const events = await sbGet(qs);
  const total = await sbGet(`events?select=id${type ? `&eq.type=${type}` : ""}`);
  return json({ events, total: total.length, page });
}

async function handleControl(body: any, adminEmail: string) {
  const { action, userId, value } = body;

  if (action === "rebuild-showcases") {
    try {
      const origin = "https://podlens.app";
      const res = await fetch(`${origin}/api/build-showcases`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-email": adminEmail },
        signal: AbortSignal.timeout(30000)
      });
      const data = await res.json().catch(() => ({}));
      return json({ ok: res.ok, status: res.status, data });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  if (!action || !userId) {
    return json({ error: "action and userId required" }, 400);
  }

  if (action === "set-plan") {
    if (!["free", "creator", "operator", "studio"].includes(value)) {
      return json({ error: "Invalid plan" }, 400);
    }
    // Update Supabase
    try {
      const res = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}`, {
        method: "PATCH",
        headers: sbHeaders(),
        body: JSON.stringify({ plan: value, updated_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) return json({ error: "Supabase update failed" }, 500);
    } catch { return json({ error: "DB error" }, 500); }

    // Update Blobs
    try {
      const store = getStore("podlens-users");
      const existing = await store.get(userId, { type: "json" }) as any;
      if (existing) {
        existing.plan = value;
        existing.updatedAt = new Date().toISOString();
        await store.setJSON(userId, existing);
      }
    } catch {}

    return json({ ok: true, message: `Set plan to ${value} for user ${userId}` });
  }

  if (action === "delete-user") {
    try {
      await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}`, {
        method: "DELETE", headers: sbHeaders(), signal: AbortSignal.timeout(8000)
      });
    } catch {}
    try {
      const store = getStore("podlens-users");
      await store.delete(userId);
    } catch {}
    return json({ ok: true, message: `Deleted user ${userId}` });
  }

  return json({ error: "Unknown action" }, 400);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json" }
  });
}

export const config: Config = { path: "/api/admin-data" };
