import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const ALLOWED_KEYS = new Set([
  "digestEmail", "episodeAlerts", "smartQueueEnabled",
  "analysisDepth", "audioBriefings", "liveSubtitles", "voiceAssistant",
]);

export default async (req: Request) => {
  if (req.method !== "POST" && req.method !== "PATCH") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();
    const { userId, ...updates } = body;
    if (!userId) {
      return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    // Only allow known settings keys
    const safeUpdates: Record<string, any> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (ALLOWED_KEYS.has(k)) safeUpdates[k] = v;
    }

    const store = getStore("podlens-users");
    const key = `user-settings-${userId}`;
    let existing: any = {};
    try { existing = (await store.get(key, { type: "json" })) ?? {}; } catch {}

    const merged = { ...existing, ...safeUpdates, updatedAt: new Date().toISOString() };
    await store.setJSON(key, merged);

    return new Response(JSON.stringify({ ok: true, settings: merged }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: "Unable to save settings" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/update-settings" };
