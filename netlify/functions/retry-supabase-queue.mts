import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getSupabaseAdmin } from "./lib/supabase.js";

// Retries failed Supabase writes queued in Blobs
// Runs every hour — processes up to 100 queued items per run

export default async (req: Request) => {
  const store = getStore("supabase-queue");
  const sb = getSupabaseAdmin();

  if (!sb) {
    return new Response(JSON.stringify({ error: "Supabase not configured" }), { status: 500 });
  }

  let processed = 0;
  let failed = 0;
  let errors: string[] = [];

  try {
    const { blobs } = await store.list();
    const items = (blobs || []).slice(0, 100); // max 100 per run

    for (const blob of items) {
      try {
        const item = await store.get(blob.key, { type: "json" }) as any;
        if (!item?.table || !item?.data) {
          await store.delete(blob.key);
          continue;
        }

        // Retry the write
        const { error } = await sb.from(item.table).upsert(item.data);
        if (error) {
          failed++;
          errors.push(`${item.table}: ${error.message}`);
        } else {
          // Success — remove from queue
          await store.delete(blob.key);
          processed++;
        }
      } catch (e: any) {
        failed++;
        errors.push(e?.message || "unknown");
      }
    }
  } catch (e: any) {
    console.error("[retry-supabase-queue]", e?.message || e);
    return new Response(JSON.stringify({ error: "Queue processing error" }), { status: 500 });
  }

  return new Response(JSON.stringify({
    processed, failed,
    errors: errors.slice(0, 10),
    ts: new Date().toISOString(),
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config: Config = {
  schedule: "0 * * * *", // every hour
};
