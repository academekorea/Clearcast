import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getSupabaseAdmin } from "./lib/supabase.js";

// Runs daily at 3am UTC — hard-deletes accounts past their 7-day recovery window

const SB_URL = "https://suqjdctajnitxivczjtg.supabase.co";

function sbHeaders(): HeadersInit {
  const key = Netlify.env.get("SUPABASE_SERVICE_KEY") || "";
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function sbDelete(table: string, userId: string): Promise<void> {
  try {
    await fetch(`${SB_URL}/rest/v1/${table}?user_id=eq.${userId}`, {
      method: "DELETE", headers: sbHeaders(), signal: AbortSignal.timeout(8000)
    });
  } catch { /* non-critical — log and continue */ }
}

export default async () => {
  const now = new Date().toISOString();

  // Find accounts past their deletion date
  let toDelete: any[] = [];
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/users?select=id,email&account_status=eq.pending_deletion&deletion_date=lt.${now}`,
      { headers: sbHeaders(), signal: AbortSignal.timeout(15000) }
    );
    if (res.ok) toDelete = await res.json();
  } catch {
    console.error("[hard-delete-accounts] Failed to query pending accounts");
    return;
  }

  if (!toDelete.length) {
    console.log("[hard-delete-accounts] No accounts to delete");
    return;
  }

  const userStore = getStore("podlens-users");
  const secStore = getStore("podlens-security");
  let deleted = 0;

  for (const account of toDelete) {
    const { id: userId } = account;

    // Delete related data first (order matters for FK constraints)
    const tables = [
      "analyses", "events", "usage", "followed_shows",
      "connected_accounts", "user_devices", "subscriptions",
      "notifications", "downloads", "user_sessions",
    ];
    for (const table of tables) {
      await sbDelete(table, userId);
    }

    // Delete user record
    try {
      await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}`, {
        method: "DELETE", headers: sbHeaders(), signal: AbortSignal.timeout(8000)
      });
    } catch {}

    // Clean up Blobs
    await userStore.delete(userId).catch(() => {});
    await secStore.delete(`recovery-${userId}`).catch(() => {});

    console.log(`[hard-delete-accounts] Hard deleted: ${userId}`);
    deleted++;
  }

  console.log(`[hard-delete-accounts] Done. Deleted ${deleted} of ${toDelete.length} accounts.`);
};

export const config: Config = {
  schedule: "0 3 * * *", // Daily at 3am UTC — no path property
};
