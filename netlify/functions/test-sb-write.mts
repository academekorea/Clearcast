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

  // Test 2: Try a plain INSERT (no upsert/conflict)
  const ts = Date.now();
  const testRow = {
    job_id: "test-diag-" + ts,
    canonical_key: "test:diag-" + ts,
    url: "https://example.com/test",
    episode_title: "Diagnostic Test",
    show_name: "Test Show",
    bias_score: 0,
    bias_label: "Center",
    analyzed_at: new Date().toISOString(),
    user_id: null,
  };

  const { data: insertData, error: insertErr } = await sb
    .from("analyses")
    .insert(testRow)
    .select();

  // Test 3: Check unique constraints
  const { data: constraintData } = await sb.rpc("get_table_constraints", { table_name_param: "analyses" }).select();

  // Test 4: Read back
  const { data: readBack, error: readErr } = await sb
    .from("analyses")
    .select("id, canonical_key, show_name, bias_score")
    .eq("canonical_key", testRow.canonical_key)
    .maybeSingle();

  // Cleanup
  if (readBack) {
    await sb.from("analyses").delete().eq("canonical_key", testRow.canonical_key);
  }

  return new Response(JSON.stringify({
    connection: { ok: !selectErr, existing_rows: selectData?.length ?? 0, error: selectErr?.message },
    insert: { ok: !insertErr, data: insertData, error: insertErr?.message, code: insertErr?.code, details: insertErr?.details },
    readBack: { ok: !readErr, found: !!readBack, data: readBack, error: readErr?.message },
    constraints: constraintData,
  }, null, 2), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/test-sb-write" };
