import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const SB_URL = "https://suqjdctajnitxivczjtg.supabase.co";
const SUPER_ADMIN_EMAIL = "academekorea@gmail.com";
const MAX_BACKUPS = 4;

function sbHeaders(): HeadersInit {
  const key = Netlify.env.get("SUPABASE_SERVICE_KEY") || "";
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function exportTable(table: string, select = "*", order = "created_at.desc"): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    try {
      const res = await fetch(
        `${SB_URL}/rest/v1/${table}?select=${select}&order=${order}&limit=${limit}&offset=${offset}`,
        { headers: sbHeaders(), signal: AbortSignal.timeout(30000) }
      );
      if (!res.ok) break;
      const batch = await res.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      rows.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
    } catch { break; }
  }
  return rows;
}

async function logBackup(dateKey: string, summary: Record<string, number>, success: boolean, errorMsg?: string) {
  try {
    const key = Netlify.env.get("SUPABASE_SERVICE_KEY") || "";
    await fetch(`${SB_URL}/rest/v1/backup_log`, {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify({
        backup_date: dateKey,
        success,
        row_counts: summary,
        error_message: errorMsg || null,
        created_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* non-critical */ }
}

async function sendAdminEmail(subject: string, body: string) {
  const resendKey = Netlify.env.get("RESEND_API_KEY");
  if (!resendKey) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Podlens Backup <backup@podlens.app>",
        to: [SUPER_ADMIN_EMAIL],
        subject,
        text: body,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* non-critical */ }
}

export default async () => {
  const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const store = getStore("podlens-backups");

  const tables = [
    { name: "users",             select: "id,email,name,plan,created_at,last_seen_at,stripe_customer_id,is_super_admin" },
    { name: "analyses",          select: "id,user_id,show_name,show_slug,episode_title,episode_url,bias_label,bias_left_pct,bias_center_pct,bias_right_pct,host_trust_score,summary,share_id,duration,word_count,created_at,result_json" },
    { name: "subscriptions",     select: "id,user_id,plan,status,amount,stripe_subscription_id,created_at,canceled_at" },
    { name: "events",            select: "id,user_id,event_type,properties,created_at", order: "created_at.desc" },
    { name: "followed_shows",    select: "id,user_id,show_slug,show_name,created_at" },
    { name: "connected_accounts",select: "id,user_id,platform,created_at" },
  ];

  const summary: Record<string, number> = {};
  const backup: Record<string, any[]> = {};

  let errorMsg: string | undefined;

  try {
    for (const t of tables) {
      const rows = await exportTable(t.name, t.select, (t as any).order);
      backup[t.name] = rows;
      summary[t.name] = rows.length;
    }

    const backupPayload = {
      date: dateKey,
      exportedAt: new Date().toISOString(),
      rowCounts: summary,
      data: backup,
    };

    // Store current backup
    await store.setJSON(`backup-${dateKey}`, backupPayload);

    // Prune old backups — keep last MAX_BACKUPS
    const { blobs } = await store.list({ prefix: "backup-" }).catch(() => ({ blobs: [] }));
    const sorted = (blobs || [])
      .map((b: any) => b.key)
      .filter((k: string) => k !== `backup-${dateKey}`)
      .sort()
      .reverse(); // newest first

    for (let i = MAX_BACKUPS - 1; i < sorted.length; i++) {
      await store.delete(sorted[i]).catch(() => {});
    }

    await logBackup(dateKey, summary, true);

    const totalRows = Object.values(summary).reduce((a, b) => a + b, 0);
    await sendAdminEmail(
      `✅ Podlens weekly backup complete — ${dateKey}`,
      `Backup completed successfully.\n\nDate: ${dateKey}\nTotal rows exported: ${totalRows}\n\nBreakdown:\n${Object.entries(summary).map(([t, c]) => `  ${t}: ${c} rows`).join("\n")}\n\nBackup stored in Netlify Blobs (podlens-backups) as backup-${dateKey}.`
    );

    console.log(`[weekly-backup] Success: ${dateKey}`, summary);
  } catch (err: any) {
    errorMsg = String(err?.message || err);
    await logBackup(dateKey, summary, false, errorMsg);
    await sendAdminEmail(
      `❌ Podlens weekly backup FAILED — ${dateKey}`,
      `Backup failed on ${dateKey}.\n\nError: ${errorMsg}\n\nPartial row counts:\n${Object.entries(summary).map(([t, c]) => `  ${t}: ${c} rows`).join("\n")}`
    );
    console.error(`[weekly-backup] Error: ${errorMsg}`);
  }
};

export const config: Config = {
  schedule: "0 2 * * 0", // Every Sunday at 2am UTC
};
