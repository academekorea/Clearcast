import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const DEFAULTS = {
  digestEmail: true,
  episodeAlerts: true,
  smartQueueEnabled: false,
  analysisDepth: "standard",
  audioBriefings: true,
  liveSubtitles: false,
  voiceAssistant: false,
};

export default async (req: Request) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return new Response(JSON.stringify({ error: "userId required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const store = getStore("podlens-users");
    const key = `user-settings-${userId}`;
    let settings: any = {};
    try { settings = (await store.get(key, { type: "json" })) ?? {}; } catch {}

    return new Response(JSON.stringify({ ...DEFAULTS, ...settings }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Server error" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/get-settings" };
