import type { Config } from "@netlify/functions";
import { getSupabaseAdmin } from "./lib/supabase.js";
import { findOrCreateShow } from "./lib/show-matcher.js";

function makeEpisodeKey(input: {
  jobId?: string;
  episodeUrl?: string;
  episodeTitle: string;
  showName: string;
}): string {
  const raw = input.jobId || input.episodeUrl || (input.showName + input.episodeTitle);
  return (raw || "").replace(/[^a-z0-9]/gi, "").slice(0, 40);
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const { userId, action, episodeTitle, showName, episodeUrl, jobId, artworkUrl } = body;
  if (!userId || !action) {
    return new Response(JSON.stringify({ error: "userId and action required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const sb = getSupabaseAdmin();
  if (!sb) {
    return new Response(JSON.stringify({ ok: false, error: "DB unavailable" }), {
      status: 503, headers: { "Content-Type": "application/json" },
    });
  }

  const episodeKey = makeEpisodeKey({
    jobId, episodeUrl,
    episodeTitle: episodeTitle || "",
    showName: showName || "",
  });

  try {
    if (action === "like") {
      let showId: string | null = null;
      if (showName) {
        const match = await findOrCreateShow({
          name: showName,
          artwork_url: artworkUrl || null,
          source_type: "podlens",
        });
        if (match) showId = match.showId;
      }

      const { data: existing } = await sb.from("saved_episodes")
        .select("id, unliked_at")
        .eq("user_id", userId)
        .eq("platform", "podlens")
        .eq("platform_episode_id", episodeKey)
        .maybeSingle();

      if (existing) {
        const { error } = await sb.from("saved_episodes").update({
          unliked_at: null,
          saved_at: new Date().toISOString(),
          saved_source: "podlens",
          artwork_url: artworkUrl || null,
          episode_title: episodeTitle,
          show_name: showName,
          episode_url: episodeUrl || null,
          show_id: showId,
        }).eq("id", existing.id);
        if (error) throw error;
        return new Response(JSON.stringify({ ok: true, action: "restored" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }

      const { error } = await sb.from("saved_episodes").insert({
        user_id: userId,
        show_id: showId,
        platform: "podlens",
        platform_episode_id: episodeKey,
        saved_source: "podlens",
        episode_title: episodeTitle,
        show_name: showName,
        episode_url: episodeUrl || null,
        artwork_url: artworkUrl || null,
        saved_at: new Date().toISOString(),
      });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, action: "liked" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });

    } else if (action === "unlike") {
      const { data: rows } = await sb.from("saved_episodes")
        .select("id, platform, platform_episode_id, episode_url, episode_title, show_name")
        .eq("user_id", userId)
        .is("unliked_at", null);

      let target: any = null;
      if (rows && rows.length > 0) {
        target = rows.find((r: any) => r.platform === "podlens" && r.platform_episode_id === episodeKey);
        if (!target && episodeUrl) {
          target = rows.find((r: any) => r.episode_url === episodeUrl);
        }
        if (!target) {
          target = rows.find((r: any) =>
            r.episode_title === episodeTitle && r.show_name === showName
          );
        }
      }

      if (target) {
        const { error } = await sb.from("saved_episodes")
          .update({ unliked_at: new Date().toISOString() })
          .eq("id", target.id);
        if (error) throw error;
        return new Response(JSON.stringify({ ok: true, action: "unliked", id: target.id }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: true, action: "noop" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[toggle-like-episode]", err?.message || err);
    return new Response(JSON.stringify({ error: err?.message || "Internal" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/toggle-like-episode" };
