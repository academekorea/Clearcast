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
    case "analytics": return getAnalytics();
    default: return new Response(JSON.stringify({ error: "Unknown tab" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }
};

async function getOverview() {
  const [users, analyses, subs, events, follows, connections] = await Promise.all([
    sbGet("users?select=id,tier,created_at,last_seen_at,spotify_connected,youtube_connected,smart_queue_enabled&order=created_at.desc"),
    sbGet("analyses?select=id,created_at,user_id&order=created_at.desc&limit=1000"),
    sbGet("subscriptions?select=id,status,plan,amount&status=eq.active"),
    sbGet("events?select=created_at,event_type&order=created_at.desc&limit=500"),
    sbGet("followed_shows?select=id,platform,smart_queue"),
    sbGet("connected_accounts?select=id,provider"),
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
  for (const u of users) planCounts[u.tier || "free"] = (planCounts[u.tier || "free"] || 0) + 1;

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

  // Platform connection stats
  const spotifyConnected = users.filter((u: any) => u.spotify_connected).length;
  const youtubeConnected = users.filter((u: any) => u.youtube_connected).length;
  const smartQueueEnabled = users.filter((u: any) => u.smart_queue_enabled).length;
  const totalFollows = follows.length;
  const spotifyFollows = follows.filter((f: any) => f.platform === "spotify").length;
  const youtubeFollows = follows.filter((f: any) => f.platform === "youtube").length;
  const smartQueueShows = follows.filter((f: any) => f.smart_queue).length;
  const spotifyAccounts = connections.filter((c: any) => c.provider === "spotify").length;
  const youtubeAccounts = connections.filter((c: any) => c.provider === "youtube").length;
  const usersWithAnalyses = new Set(analyses.filter((a: any) => a.user_id).map((a: any) => a.user_id)).size;

  return json({ totalUsers, newToday, new7d, new30d, dau, wau,
    planCounts, totalAnalyses, analyses24h, analyses7d, mrr, dauTrend,
    spotifyConnected, youtubeConnected, smartQueueEnabled,
    totalFollows, spotifyFollows, youtubeFollows, smartQueueShows,
    spotifyAccounts, youtubeAccounts, usersWithAnalyses });
}

async function getUsers(url: URL) {
  const page = parseInt(url.searchParams.get("page") || "1");
  const search = url.searchParams.get("q") || "";
  const plan = url.searchParams.get("plan") || "";

  let qs = `users?select=id,email,name,tier,created_at,last_seen_at,is_super_admin,stripe_customer_id&order=created_at.desc&limit=50&offset=${(page-1)*50}`;
  if (search) qs += `&or=(email.ilike.*${search}*,name.ilike.*${search}*)`;
  if (plan) qs += `&tier=eq.${plan}`;

  const users = await sbGet(qs);
  const countRows = await sbGet(`users?select=id${plan ? `&tier=eq.${plan}` : ""}${search ? `&or=(email.ilike.*${search}*,name.ilike.*${search}*)` : ""}`);

  return json({ users, total: countRows.length, page, perPage: 50 });
}

async function getAnalyses(url: URL) {
  const page = parseInt(url.searchParams.get("page") || "1");
  const rows = await sbGet(
    `analyses?select=id,url,show_name,episode_title,user_id,created_at,bias_label,bias_score&order=created_at.desc&limit=50&offset=${(page-1)*50}`
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
    sbGet("users?select=id,tier,created_at"),
    sbGet("subscriptions?select=id,user_id,status,created_at")
  ]);

  const total = users.length;
  const trial = users.filter((u: any) => u.tier === "trial").length;
  const free = users.filter((u: any) => u.tier === "free").length;
  const paid = users.filter((u: any) => ["creator", "operator", "studio"].includes(u.tier)).length;
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
  let qs = `events?select=id,event_type,user_id,properties,created_at&order=created_at.desc&limit=50&offset=${(page-1)*50}`;
  if (type) qs += `&event_type=eq.${type}`;
  const events = await sbGet(qs);
  const total = await sbGet(`events?select=id${type ? `&event_type=eq.${type}` : ""}`);
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
        body: JSON.stringify({ tier: value, updated_at: new Date().toISOString() }),
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

async function getAnalytics() {
  // Get admin user IDs + their IP hashes for filtering
  const adminUsers = await sbGet(
    "users?select=id&email=eq.academekorea@gmail.com"
  );
  const adminIds = adminUsers.map((u: any) => u.id);
  const adminIpRows = adminIds.length > 0
    ? await sbGet(
        "events?select=ip_hash&ip_hash=not.is.null&user_id=in.(" + adminIds.join(",") + ")&limit=500"
      )
    : [];
  const adminIpHashes = new Set<string>(adminIpRows.map((r: any) => r.ip_hash).filter(Boolean));

  const ALL_EVENTS_30D_RAW = await sbGet(
    "events?select=event_type,user_id,session_id,properties,ip_hash,created_at&order=created_at.desc&limit=10000&created_at=gte." +
    new Date(Date.now() - 30 * 86400000).toISOString()
  );
  // Filter out admin IP hashes AND admin user_ids
  const ALL_EVENTS_30D = ALL_EVENTS_30D_RAW.filter((e: any) => {
    if (e.ip_hash && adminIpHashes.has(e.ip_hash)) return false;
    if (e.user_id && adminIds.includes(e.user_id)) return false;
    return true;
  });
  const USERS_ALL = await sbGet(
    "users?select=id,email,plan,tier,created_at,last_seen_at&email=neq.academekorea@gmail.com"
  );
  const SAVED_EPISODES_ALL = await sbGet(
    "saved_episodes?select=user_id,episode_title,show_name,saved_source,saved_at&order=saved_at.desc&limit=5000"
  );

  const events = ALL_EVENTS_30D as any[];
  const users = USERS_ALL as any[];
  const savedEpisodes = SAVED_EPISODES_ALL as any[];
  const now = Date.now();
  const day14 = now - 14 * 86400000;

  // Q1: Daily activity (last 14 days)
  const dailyActivity: Record<string, any> = {};
  for (let i = 0; i < 14; i++) {
    const d = new Date(now - i * 86400000);
    const day = d.toISOString().slice(0, 10);
    dailyActivity[day] = { day, total_events: 0, unique_sessions: new Set(), unique_users: new Set(), visits: 0, signups: 0, analyses_done: 0 };
  }
  events.forEach(e => {
    if (new Date(e.created_at).getTime() < day14) return;
    const day = e.created_at.slice(0, 10);
    if (!dailyActivity[day]) return;
    const row = dailyActivity[day];
    row.total_events++;
    if (e.session_id) row.unique_sessions.add(e.session_id);
    if (e.user_id) row.unique_users.add(e.user_id);
    if (e.event_type === 'app_loaded') row.visits++;
    if (e.event_type === 'signup_completed') row.signups++;
    if (e.event_type === 'analysis_completed') row.analyses_done++;
  });
  const dailyActivityRows = Object.values(dailyActivity)
    .map((r: any) => ({ day: r.day, total_events: r.total_events, unique_sessions: r.unique_sessions.size, unique_users: r.unique_users.size, visits: r.visits, signups: r.signups, analyses_done: r.analyses_done }))
    .sort((a: any, b: any) => b.day.localeCompare(a.day));

  // Q2: Conversion funnel
  const visitedSessions = new Set<string>();
  const triedAnalysisSessions = new Set<string>();
  const completedAnalysisSessions = new Set<string>();
  const startedSignupSessions = new Set<string>();
  const completedSignupSessions = new Set<string>();
  events.forEach(e => {
    if (!e.session_id) return;
    if (e.event_type === 'app_loaded') visitedSessions.add(e.session_id);
    if (e.event_type === 'analysis_initiated') triedAnalysisSessions.add(e.session_id);
    if (e.event_type === 'analysis_completed') completedAnalysisSessions.add(e.session_id);
    if (e.event_type === 'signup_started') startedSignupSessions.add(e.session_id);
    if (e.event_type === 'signup_completed') completedSignupSessions.add(e.session_id);
  });
  const funnel = {
    visited: visitedSessions.size, tried_analysis: triedAnalysisSessions.size,
    pct_tried: visitedSessions.size ? Math.round(triedAnalysisSessions.size * 1000 / visitedSessions.size) / 10 : 0,
    completed_analysis: completedAnalysisSessions.size,
    pct_completed_of_tried: triedAnalysisSessions.size ? Math.round(completedAnalysisSessions.size * 1000 / triedAnalysisSessions.size) / 10 : 0,
    started_signup: startedSignupSessions.size, completed_signup: completedSignupSessions.size,
    pct_signup_completion: startedSignupSessions.size ? Math.round(completedSignupSessions.size * 1000 / startedSignupSessions.size) / 10 : 0,
  };

  // Q3: Top conversion paths
  const sessionPaths: Record<string, string[]> = {};
  events.filter(e => completedSignupSessions.has(e.session_id)).sort((a, b) => a.created_at.localeCompare(b.created_at)).forEach(e => {
    if (!sessionPaths[e.session_id]) sessionPaths[e.session_id] = [];
    sessionPaths[e.session_id].push(e.event_type);
  });
  const pathCounts: Record<string, number> = {};
  Object.values(sessionPaths).forEach(path => { const key = path.join(' → '); pathCounts[key] = (pathCounts[key] || 0) + 1; });
  const topPaths = Object.entries(pathCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([path, count]) => ({ path, count }));

  // Q4: Time to activation
  const sessionFirstVisit: Record<string, number> = {};
  const sessionFirstActivation: Record<string, number> = {};
  events.forEach(e => {
    const t = new Date(e.created_at).getTime();
    if (e.event_type === 'app_loaded' && e.session_id) { if (!sessionFirstVisit[e.session_id] || t < sessionFirstVisit[e.session_id]) sessionFirstVisit[e.session_id] = t; }
    if (e.event_type === 'analysis_completed' && e.session_id) { if (!sessionFirstActivation[e.session_id] || t < sessionFirstActivation[e.session_id]) sessionFirstActivation[e.session_id] = t; }
  });
  const activationTimes: number[] = [];
  Object.keys(sessionFirstActivation).forEach(sid => { if (sessionFirstVisit[sid]) { const s = (sessionFirstActivation[sid] - sessionFirstVisit[sid]) / 1000; if (s >= 0) activationTimes.push(s); } });
  activationTimes.sort((a, b) => a - b);
  const median = activationTimes.length ? activationTimes[Math.floor(activationTimes.length / 2)] : 0;
  const p90 = activationTimes.length ? activationTimes[Math.floor(activationTimes.length * 0.9)] : 0;
  const timeToActivation = { median_seconds: Math.round(median), p90_seconds: Math.round(p90), sessions_who_activated: activationTimes.length };

  // Q5: Drop-off by stage
  const stages = [
    { step: 1, stage: 'app_loaded', sessions: visitedSessions },
    { step: 2, stage: 'analysis_initiated', sessions: triedAnalysisSessions },
    { step: 3, stage: 'analysis_completed', sessions: completedAnalysisSessions },
    { step: 4, stage: 'signup_started', sessions: startedSignupSessions },
    { step: 5, stage: 'signup_completed', sessions: completedSignupSessions },
  ];
  const dropOff = stages.map((s, i) => {
    const next = stages[i + 1];
    return { step: s.step, stage: s.stage, sessions_reached: s.sessions.size, sessions_progressed: next ? next.sessions.size : 0, pct_progressed: s.sessions.size ? Math.round((next ? next.sessions.size : 0) * 1000 / s.sessions.size) / 10 : null };
  });

  // Q6: Spotify cohort comparison
  const spotifyConnectorIds = new Set<string>();
  events.forEach(e => { if (e.event_type === 'spotify_library_imported' && e.user_id) spotifyConnectorIds.add(e.user_id); });
  const userEngagement: Record<string, { analyses: number; likes: number; show_views: number }> = {};
  events.forEach(e => {
    if (!e.user_id) return;
    if (!userEngagement[e.user_id]) userEngagement[e.user_id] = { analyses: 0, likes: 0, show_views: 0 };
    if (e.event_type === 'analysis_completed') userEngagement[e.user_id].analyses++;
    if (e.event_type === 'episode_liked') userEngagement[e.user_id].likes++;
    if (e.event_type === 'show_profile_viewed') userEngagement[e.user_id].show_views++;
  });
  const cohortStats = (uids: string[]) => {
    if (!uids.length) return { users: 0, avg_analyses: 0, avg_likes: 0, avg_show_views: 0 };
    const sums = uids.reduce((acc: any, uid) => { const e = userEngagement[uid] || { analyses: 0, likes: 0, show_views: 0 }; acc.analyses += e.analyses; acc.likes += e.likes; acc.show_views += e.show_views; return acc; }, { analyses: 0, likes: 0, show_views: 0 });
    return { users: uids.length, avg_analyses: Math.round(sums.analyses * 100 / uids.length) / 100, avg_likes: Math.round(sums.likes * 100 / uids.length) / 100, avg_show_views: Math.round(sums.show_views * 100 / uids.length) / 100 };
  };
  const allUserIds = Object.keys(userEngagement);
  const spotifyCohort = cohortStats(allUserIds.filter(u => spotifyConnectorIds.has(u)));
  const noSpotifyCohort = cohortStats(allUserIds.filter(u => !spotifyConnectorIds.has(u)));

  // Q7: Traffic sources
  const sourceMap: Record<string, { sessions: Set<string>; signups: number }> = {};
  events.forEach(e => {
    if (e.event_type !== 'app_loaded' && e.event_type !== 'signup_completed') return;
    let referrer = 'direct'; let utm_source = 'none'; let utm_campaign = 'none';
    try { const props = typeof e.properties === 'string' ? JSON.parse(e.properties) : (e.properties || {}); if (props.referrer) referrer = String(props.referrer).slice(0, 60); if (props.utm) { if (props.utm.utm_source) utm_source = String(props.utm.utm_source); if (props.utm.utm_campaign) utm_campaign = String(props.utm.utm_campaign); } } catch {}
    const key = `${referrer}|${utm_source}|${utm_campaign}`;
    if (!sourceMap[key]) sourceMap[key] = { sessions: new Set(), signups: 0 };
    if (e.session_id) sourceMap[key].sessions.add(e.session_id);
    if (e.event_type === 'signup_completed') sourceMap[key].signups++;
  });
  const sourceRows = Object.entries(sourceMap).map(([key, val]) => { const [referrer, utm_source, utm_campaign] = key.split('|'); return { source: referrer, utm_source, utm_campaign, sessions: val.sessions.size, signups: val.signups, conversion_pct: val.sessions.size ? Math.round(val.signups * 1000 / val.sessions.size) / 10 : 0 }; }).filter(r => r.sessions > 0).sort((a, b) => b.signups - a.signups || b.sessions - a.sessions).slice(0, 20);

  // Q8: Retention by signup cohort
  const retentionRows: any[] = [];
  const signupsByDay: Record<string, string[]> = {};
  users.forEach((u: any) => { const day = u.created_at.slice(0, 10); if (!signupsByDay[day]) signupsByDay[day] = []; signupsByDay[day].push(u.id); });
  Object.keys(signupsByDay).sort().reverse().slice(0, 30).forEach(day => {
    const cohort = signupsByDay[day]; const cohortStartMs = new Date(day).getTime();
    let returnedD1 = 0, returnedD7 = 0, returnedD30 = 0;
    cohort.forEach(uid => { const userEvents = events.filter(e => e.user_id === uid); const userActivityDays = new Set(userEvents.map(e => e.created_at.slice(0, 10))); const d1 = new Date(cohortStartMs + 86400000).toISOString().slice(0, 10); const d7 = new Date(cohortStartMs + 7 * 86400000).toISOString().slice(0, 10); const d30 = new Date(cohortStartMs + 30 * 86400000).toISOString().slice(0, 10); if (userActivityDays.has(d1)) returnedD1++; if (userActivityDays.has(d7)) returnedD7++; if (userActivityDays.has(d30)) returnedD30++; });
    retentionRows.push({ signup_day: day, signups: cohort.length, d1_pct: Math.round(returnedD1 * 1000 / cohort.length) / 10, d7_pct: Math.round(returnedD7 * 1000 / cohort.length) / 10, d30_pct: Math.round(returnedD30 * 1000 / cohort.length) / 10 });
  });

  // Q9: Most-viewed shows
  const showViews: Record<string, { views: number; users: Set<string>; sessions: Set<string> }> = {};
  events.forEach(e => {
    if (e.event_type !== 'show_profile_viewed') return;
    let slug = ''; try { const props = typeof e.properties === 'string' ? JSON.parse(e.properties) : (e.properties || {}); slug = props.slug || ''; } catch {}
    if (!slug) return;
    if (!showViews[slug]) showViews[slug] = { views: 0, users: new Set(), sessions: new Set() };
    showViews[slug].views++; if (e.user_id) showViews[slug].users.add(e.user_id); if (e.session_id) showViews[slug].sessions.add(e.session_id);
  });
  const topShows = Object.entries(showViews).map(([slug, v]) => ({ slug, views: v.views, unique_users: v.users.size, unique_sessions: v.sessions.size })).sort((a, b) => b.views - a.views).slice(0, 25);

  // Q10: Hour-of-day activity
  const hourBuckets: Record<number, { visits: number; signups: number; analyses: number }> = {};
  for (let h = 0; h < 24; h++) hourBuckets[h] = { visits: 0, signups: 0, analyses: 0 };
  events.forEach(e => { if (new Date(e.created_at).getTime() < day14) return; const h = new Date(e.created_at).getUTCHours(); if (e.event_type === 'app_loaded') hourBuckets[h].visits++; if (e.event_type === 'signup_completed') hourBuckets[h].signups++; if (e.event_type === 'analysis_completed') hourBuckets[h].analyses++; });
  const hourRows = Object.entries(hourBuckets).map(([h, v]) => ({ hour_utc: parseInt(h), ...v }));

  // Q11: Frequency
  const userWeeklyAnalyses: Record<string, Record<string, number>> = {};
  events.forEach(e => { if (e.event_type !== 'analysis_completed' || !e.user_id) return; const ws = new Date(e.created_at); ws.setUTCDate(ws.getUTCDate() - ws.getUTCDay()); const wk = ws.toISOString().slice(0, 10); if (!userWeeklyAnalyses[e.user_id]) userWeeklyAnalyses[e.user_id] = {}; userWeeklyAnalyses[e.user_id][wk] = (userWeeklyAnalyses[e.user_id][wk] || 0) + 1; });
  const weeklyStats: Record<string, { users: Set<string>; counts: number[] }> = {};
  Object.entries(userWeeklyAnalyses).forEach(([uid, weeks]) => { Object.entries(weeks).forEach(([week, count]) => { if (!weeklyStats[week]) weeklyStats[week] = { users: new Set(), counts: [] }; weeklyStats[week].users.add(uid); weeklyStats[week].counts.push(count); }); });
  const frequencyRows = Object.entries(weeklyStats).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8).map(([week, v]) => { const sorted = [...v.counts].sort((a, b) => a - b); const avg = v.counts.reduce((a, b) => a + b, 0) / v.counts.length; return { week, active_users: v.users.size, avg_analyses: Math.round(avg * 100) / 100, median_analyses: sorted[Math.floor(sorted.length / 2)], power_users_5plus: v.counts.filter(c => c >= 5).length, one_time_only: v.counts.filter(c => c === 1).length }; });

  // Q12: Free → paid conversion
  const planBreakdown = users.reduce((acc: any, u: any) => { const plan = u.plan || 'free'; acc[plan] = (acc[plan] || 0) + 1; return acc; }, {});
  const totalReal = users.length;
  const paidCount = users.filter((u: any) => ['creator', 'operator', 'studio'].includes(u.plan)).length;
  const conversion = { total_signups: totalReal, converted_to_paid: paidCount, conversion_pct: totalReal ? Math.round(paidCount * 1000 / totalReal) / 10 : 0, on_starter_lens: planBreakdown.creator || 0, on_pro_lens: planBreakdown.operator || 0, on_operator_lens: planBreakdown.studio || 0, on_free: planBreakdown.free || 0 };
  const activatedUserIds = new Set<string>();
  events.forEach(e => { if (e.event_type === 'analysis_completed' && e.user_id) activatedUserIds.add(e.user_id); });
  const activatedUsers = users.filter((u: any) => activatedUserIds.has(u.id));
  const activatedToPaid = activatedUsers.filter((u: any) => ['creator', 'operator', 'studio'].includes(u.plan)).length;
  const activationConversion = { activated_users: activatedUsers.length, paid_users: activatedToPaid, activated_to_paid_pct: activatedUsers.length ? Math.round(activatedToPaid * 1000 / activatedUsers.length) / 10 : 0 };

  // Q13: Second-analysis rate
  const userAnalysisCounts: Record<string, number> = {};
  const userFirstSecond: Record<string, { first?: number; second?: number }> = {};
  events.filter(e => e.event_type === 'analysis_completed' && e.user_id).sort((a, b) => a.created_at.localeCompare(b.created_at)).forEach(e => {
    const t = new Date(e.created_at).getTime(); if (!userFirstSecond[e.user_id]) userFirstSecond[e.user_id] = {};
    userAnalysisCounts[e.user_id] = (userAnalysisCounts[e.user_id] || 0) + 1;
    if (!userFirstSecond[e.user_id].first) userFirstSecond[e.user_id].first = t; else if (!userFirstSecond[e.user_id].second) userFirstSecond[e.user_id].second = t;
  });
  const usersWithFirst = Object.keys(userAnalysisCounts).length;
  const usersWithSecond = Object.values(userAnalysisCounts).filter(c => c >= 2).length;
  const hoursBetween: number[] = [];
  Object.values(userFirstSecond).forEach(fs => { if (fs.first && fs.second) hoursBetween.push((fs.second - fs.first) / 3600000); });
  hoursBetween.sort((a, b) => a - b);
  const medianHoursBetween = hoursBetween.length ? Math.round(hoursBetween[Math.floor(hoursBetween.length / 2)] * 10) / 10 : 0;
  const secondAnalysisRate = { users_with_first: usersWithFirst, users_with_second: usersWithSecond, second_analysis_rate_pct: usersWithFirst ? Math.round(usersWithSecond * 1000 / usersWithFirst) / 10 : 0, median_hours_between: medianHoursBetween };

  // Q14: Library depth
  const savesByUser: Record<string, { spotify: number; podlens: number; total: number }> = {};
  savedEpisodes.forEach((s: any) => { if (!s.user_id) return; if (!savesByUser[s.user_id]) savesByUser[s.user_id] = { spotify: 0, podlens: 0, total: 0 }; if (s.saved_source === 'spotify') savesByUser[s.user_id].spotify++; else savesByUser[s.user_id].podlens++; savesByUser[s.user_id].total++; });
  const spotifyConnectedSaves: number[] = []; const nonSpotifySaves: number[] = [];
  Object.keys(savesByUser).forEach(uid => { if (spotifyConnectorIds.has(uid)) spotifyConnectedSaves.push(savesByUser[uid].total); else nonSpotifySaves.push(savesByUser[uid].total); });
  const avgArr = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) * 100 / arr.length) / 100 : 0;
  const libraryDepth = { total_saves: savedEpisodes.length, saves_from_spotify: savedEpisodes.filter((s: any) => s.saved_source === 'spotify').length, saves_from_podlens: savedEpisodes.filter((s: any) => s.saved_source === 'podlens').length, users_with_saves: Object.keys(savesByUser).length, spotify_cohort_users: spotifyConnectedSaves.length, spotify_cohort_avg_saves: avgArr(spotifyConnectedSaves), non_spotify_cohort_users: nonSpotifySaves.length, non_spotify_cohort_avg_saves: avgArr(nonSpotifySaves) };

  // Q15: Most-saved episodes
  const episodeSaveCounts: Record<string, { episode_title: string; show_name: string; saves: number; users: Set<string> }> = {};
  savedEpisodes.forEach((s: any) => { if (!s.episode_title) return; const key = (s.show_name || '') + '||' + s.episode_title; if (!episodeSaveCounts[key]) episodeSaveCounts[key] = { episode_title: s.episode_title, show_name: s.show_name || '', saves: 0, users: new Set() }; episodeSaveCounts[key].saves++; if (s.user_id) episodeSaveCounts[key].users.add(s.user_id); });
  const topSavedEpisodes = Object.values(episodeSaveCounts).map(v => ({ episode_title: v.episode_title, show_name: v.show_name, saves: v.saves, unique_users: v.users.size })).sort((a, b) => b.saves - a.saves).slice(0, 25);

  // Health check
  const last5MinEvents = events.filter(e => new Date(e.created_at).getTime() > now - 5 * 60 * 1000);
  const healthCheck = { events_last_5_min: last5MinEvents.length, unique_sessions_last_5_min: new Set(last5MinEvents.map(e => e.session_id)).size, event_types_seen: Array.from(new Set(last5MinEvents.map(e => e.event_type))) };

  // Bar-chart-ready data
  const funnelBars = [
    { label: 'Visited', value: funnel.visited, pct: 100 },
    { label: 'Tried analysis', value: funnel.tried_analysis, pct: funnel.visited ? Math.round(funnel.tried_analysis * 100 / funnel.visited) : 0 },
    { label: 'Completed analysis', value: funnel.completed_analysis, pct: funnel.visited ? Math.round(funnel.completed_analysis * 100 / funnel.visited) : 0 },
    { label: 'Started signup', value: funnel.started_signup, pct: funnel.visited ? Math.round(funnel.started_signup * 100 / funnel.visited) : 0 },
    { label: 'Completed signup', value: funnel.completed_signup, pct: funnel.visited ? Math.round(funnel.completed_signup * 100 / funnel.visited) : 0 },
  ];
  const maxHourVisits = Math.max(1, ...hourRows.map((h: any) => h.visits));
  const hourBarsData = hourRows.map((h: any) => ({ hour: (h.hour_utc < 10 ? '0' : '') + h.hour_utc + ':00', visits: h.visits, pct: Math.round(h.visits * 100 / maxHourVisits) }));
  const dailyMax = Math.max(1, ...dailyActivityRows.map((d: any) => d.total_events));
  const dailyBars = dailyActivityRows.map((d: any) => ({ day: d.day.slice(5), total_events: d.total_events, visits: d.visits, signups: d.signups, pct: Math.round(d.total_events * 100 / dailyMax) })).reverse();

  return json({
    daily_activity: dailyActivityRows, funnel, funnel_bars: funnelBars, daily_bars: dailyBars, hour_bars: hourBarsData,
    top_paths: topPaths, time_to_activation: timeToActivation,
    drop_off: dropOff, spotify_cohort: spotifyCohort, no_spotify_cohort: noSpotifyCohort,
    traffic_sources: sourceRows, retention: retentionRows, top_shows: topShows,
    hour_of_day: hourRows, frequency: frequencyRows, conversion, activation_conversion: activationConversion,
    second_analysis_rate: secondAnalysisRate, library_depth: libraryDepth,
    top_saved_episodes: topSavedEpisodes, health_check: healthCheck,
  });
}

export const config: Config = { path: "/api/admin-data" };
