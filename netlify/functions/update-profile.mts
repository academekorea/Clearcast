import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getSupabaseAdmin } from "./lib/supabase.js";

export default async (req: Request) => {
  if (req.method !== "PATCH" && req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { userId, name, bio, avatar_custom_url } = await req.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    if (name !== undefined && (typeof name !== "string" || name.length > 100)) {
      return new Response(JSON.stringify({ error: "Name must be a string under 100 characters" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    if (bio !== undefined && (typeof bio !== "string" || bio.length > 160)) {
      return new Response(JSON.stringify({ error: "Bio must be under 160 characters" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    if (avatar_custom_url !== undefined && typeof avatar_custom_url !== "string") {
      return new Response(JSON.stringify({ error: "avatar_custom_url must be a string" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    if (avatar_custom_url && !avatar_custom_url.startsWith("data:image/")) {
      return new Response(JSON.stringify({ error: "avatar_custom_url must be a data:image/ URL" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    if (avatar_custom_url && Buffer.byteLength(avatar_custom_url, "utf8") > 500 * 1024) {
      return new Response(JSON.stringify({ error: "Avatar image too large" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    // Persist to Netlify Blobs (existing behavior — kept so consumers that
    // read from /api/get-user-profile blobs path still work).
    const store = getStore("podlens-users");
    const key = `user-profile-${userId}`;
    let existing: any = {};
    try { existing = (await store.get(key, { type: "json" })) ?? {}; } catch {}

    const updated = {
      ...existing,
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(bio !== undefined ? { bio: bio.trim() } : {}),
      ...(avatar_custom_url !== undefined ? { avatar_custom_url } : {}),
      updatedAt: new Date().toISOString(),
    };

    await store.setJSON(key, updated);

    // ALSO persist to Supabase users table so the name survives across
    // devices, browsers, and cache clears. The blobs store is a per-instance
    // cache; Supabase is the source of truth.
    const sb = getSupabaseAdmin();
    if (sb) {
      const sbUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (name !== undefined) sbUpdate.name = name.trim();
      if (bio !== undefined) sbUpdate.bio = bio.trim();
      if (avatar_custom_url !== undefined) sbUpdate.avatar_custom_url = avatar_custom_url;
      const { error } = await sb.from("users").update(sbUpdate).eq("id", userId);
      if (error) {
        console.error("[update-profile] Supabase update failed:", error.message);
        // Don't fail the whole request — blob write succeeded, user sees their
        // name update locally. Surface a warning so frontend can re-try.
        return new Response(JSON.stringify({ ok: true, profile: updated, warning: "Supabase sync failed — name may not persist across devices" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, profile: updated }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Server error" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/update-profile" };
