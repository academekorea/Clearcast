import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

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
    if (avatar_custom_url && avatar_custom_url.length > 500000) {
      return new Response(JSON.stringify({ error: "Avatar image too large" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

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
