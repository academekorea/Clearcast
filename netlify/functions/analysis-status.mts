import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

export default async (req: Request) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const url = new URL(req.url);
    const jobId = url.searchParams.get("job_id");

    if (!jobId) {
      return new Response(JSON.stringify({ error: "No job_id" }), { status: 400, headers });
    }

    const supabaseUrl = Netlify.env.get("SUPABASE_URL");
    const supabaseKey = Netlify.env.get("SUPABASE_SERVICE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
      .from("analysis_queue")
      .select("id, status, analysis_id, error, show_name, episode_title")
      .eq("id", jobId)
      .single();

    console.log("[status] Job:", jobId, "Status:", data?.status, "Error:", error?.message);

    if (error || !data) {
      return new Response(
        JSON.stringify({ error: "Job not found", jobId }),
        { status: 200, headers }
      );
    }

    return new Response(JSON.stringify(data), { status: 200, headers });

  } catch (err: any) {
    console.error("[status] Error:", err?.message);
    return new Response(
      JSON.stringify({ error: err?.message || "Unknown error" }),
      { status: 200, headers }
    );
  }
};

export const config: Config = { path: "/api/analysis-status" };
