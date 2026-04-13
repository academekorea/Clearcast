import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

export default async (req: Request) => {
  const sbUrl = Netlify.env.get("SUPABASE_URL");
  const sbKey = Netlify.env.get("SUPABASE_SERVICE_KEY");

  if (!sbUrl || !sbKey) {
    return new Response(JSON.stringify({ error: "No Supabase credentials" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } });

  // Test 1: Simple select to confirm connection
  const { data: selectData, error: selectErr } = await sb
    .from("analyses")
    .select("id, canonical_key, show_name, bias_score")
    .limit(5);

  // Test 2: Try a minimal upsert
  const testRow = {
    job_id: "test-diag-" + Date.now(),
    canonical_key: "test:diag-" + Date.now(),
    url: "https://example.com/test",
    episode_title: "Diagnostic Test",
    show_name: "Test Show",
    bias_score: 0,
    bias_label: "Center",
    analyzed_at: new Date().toISOString(),
    user_id: null,
  };

  const { data: upsertData, error: upsertErr } = await sb
    .from("analyses")
    .upsert(testRow, { onConflict: "canonical_key" })
    .select();

  // Test 3: Read it back
  const { data: readBack, error: readErr } = await sb
    .from("analyses")
    .select("*")
    .eq("canonical_key", testRow.canonical_key)
    .single();

  // Cleanup
  await sb.from("analyses").delete().eq("canonical_key", testRow.canonical_key);

  return new Response(JSON.stringify({
    connection: { ok: !selectErr, existing_rows: selectData?.length ?? 0, error: selectErr?.message },
    upsert: { ok: !upsertErr, data: upsertData, error: upsertErr?.message, code: upsertErr?.code, details: upsertErr?.details },
    readBack: { ok: !readErr, found: !!readBack, error: readErr?.message },
  }, null, 2), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/test-sb-write" };
