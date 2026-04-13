import type { Config } from "@netlify/functions";
import { getSupabaseAdmin } from "./lib/supabase.js";

const VALID_INTERESTS = new Set([
  "news", "technology", "business", "society", "comedy",
  "sports", "health", "true-crime", "science", "history",
  "education", "politics"
]);

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const json = (data: object, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  try {
    const { userId, interests } = await req.json();

    if (!userId) return json({ error: "userId required" }, 400);
    if (!Array.isArray(interests)) return json({ error: "interests must be an array" }, 400);

    // Sanitize: lowercase, validate against known topics, max 3
    const clean = interests
      .map((s: any) => String(s).toLowerCase().trim())
      .filter((s) => VALID_INTERESTS.has(s))
      .slice(0, 3);

    const sb = getSupabaseAdmin();
    if (!sb) return json({ error: "DB unavailable" }, 503);

    // Write to Supabase users table — this is what for-you.mts reads
    const { error } = await sb
      .from("users")
      .update({
        interests: clean,
        interests_updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (error) {
      console.error("[save-interests] Supabase error:", error);
      return json({ error: "Failed to save interests" }, 500);
    }

    return json({ ok: true, interests: clean });
  } catch (e: any) {
    return json({ error: e?.message || "Server error" }, 500);
  }
};

export const config: Config = { path: "/api/save-interests" };
