// Shared backup logic — used by weekly-backup (scheduled) and run-backup (HTTP)

const SB_URL = "https://suqjdctajnitxivczjtg.supabase.co";
const SUPER_ADMIN_EMAIL = "academekorea@gmail.com";
const MAX_BACKUPS = 4;
const BACKUP_BUCKET = "podlens-backups";

const TABLES = [
  { name: "users",              select: "*" },
  { name: "analyses",           select: "*" },
  { name: "subscriptions",      select: "*" },
  { name: "events",             select: "id,user_id,event_type,properties,created_at", order: "created_at.desc" },
  { name: "followed_shows",     select: "*" },
  { name: "connected_accounts", select: "*" },
  { name: "analysis_queue",     select: "*" },
  { name: "shows",              select: "*" },
  { name: "usage",              select: "*" },
  { name: "notifications",      select: "*" },
] as const;

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

async function ensureBucket(): Promise<void> {
  const key = Netlify.env.get("SUPABASE_SERVICE_KEY") || "";
  await fetch(`${SB_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: BACKUP_BUCKET, name: BACKUP_BUCKET, public: false }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
}

async function uploadToStorage(fileName: string, data: string): Promise<boolean> {
  const key = Netlify.env.get("SUPABASE_SERVICE_KEY") || "";
  const res = await fetch(`${SB_URL}/storage/v1/object/${BACKUP_BUCKET}/${fileName}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "x-upsert": "true",
    },
    body: data,
    signal: AbortSignal.timeout(60000),
  });
  return res.ok;
}

async function listStorageFiles(): Promise<string[]> {
  const key = Netlify.env.get("SUPABASE_SERVICE_KEY") || "";
  const res = await fetch(`${SB_URL}/storage/v1/object/list/${BACKUP_BUCKET}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "backup-", limit: 100, sortBy: { column: "name", order: "desc" } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const files = await res.json();
  return (files || []).map((f: any) => f.name).filter((n: string) => n.startsWith("backup-"));
}

async function deleteFromStorage(fileName: string): Promise<void> {
  const key = Netlify.env.get("SUPABASE_SERVICE_KEY") || "";
  await fetch(`${SB_URL}/storage/v1/object/${BACKUP_BUCKET}`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [fileName] }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
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

export interface BackupResult {
  ok: boolean;
  date: string;
  summary: Record<string, number>;
  totalRows: number;
  error?: string;
}

export async function runBackup(): Promise<BackupResult> {
  const dateKey = new Date().toISOString().slice(0, 10);
  const summary: Record<string, number> = {};
  const backup: Record<string, any[]> = {};

  try {
    await ensureBucket();

    for (const t of TABLES) {
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

    const fileName = `backup-${dateKey}.json`;
    const uploaded = await uploadToStorage(fileName, JSON.stringify(backupPayload));
    if (!uploaded) throw new Error("Failed to upload backup to Supabase Storage");

    // Prune old backups — keep last MAX_BACKUPS
    const files = await listStorageFiles();
    const otherFiles = files.filter((f) => f !== fileName).sort().reverse();
    for (let i = MAX_BACKUPS - 1; i < otherFiles.length; i++) {
      await deleteFromStorage(otherFiles[i]);
    }

    const totalRows = Object.values(summary).reduce((a, b) => a + b, 0);
    await sendAdminEmail(
      `✅ Podlens backup complete — ${dateKey}`,
      `Backup completed successfully.\n\nDate: ${dateKey}\nTotal rows exported: ${totalRows}\n\nBreakdown:\n${Object.entries(summary).map(([t, c]) => `  ${t}: ${c} rows`).join("\n")}\n\nBackup stored in Supabase Storage (${BACKUP_BUCKET}) as ${fileName}.`
    );

    console.log(`[backup] Success: ${dateKey}`, summary);
    return { ok: true, date: dateKey, summary, totalRows };
  } catch (err: any) {
    const errorMsg = String(err?.message || err);
    await sendAdminEmail(
      `❌ Podlens backup FAILED — ${dateKey}`,
      `Backup failed on ${dateKey}.\n\nError: ${errorMsg}\n\nPartial row counts:\n${Object.entries(summary).map(([t, c]) => `  ${t}: ${c} rows`).join("\n")}`
    );
    console.error(`[backup] Error: ${errorMsg}`);
    return { ok: false, date: dateKey, summary, totalRows: 0, error: errorMsg };
  }
}
