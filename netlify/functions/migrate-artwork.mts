import type { Config } from "@netlify/functions";
import { isSuperAdmin } from "./lib/admin.js";
import { getSupabaseAdmin } from "./lib/supabase.js";

// One-time migration: re-fetch high-res artwork for all followed shows
// Uses iTunes Search API which reliably returns 600x600 images
// POST /api/migrate-artwork?email=academekorea@gmail.com

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const email = url.searchParams.get("email") || "";
  if (!isSuperAdmin(email)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sb = getSupabaseAdmin();
  if (!sb) {
    return new Response(JSON.stringify({ error: "No Supabase" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Get all followed shows
  const { data: shows, error } = await sb
    .from("followed_shows")
    .select("id, show_name, artwork, artwork_url");

  if (error || !shows) {
    return new Response(JSON.stringify({ error: error?.message || "No data" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  // Deduplicate by show_name so we only look up each show once
  const nameMap = new Map<string, string>();

  for (const show of shows) {
    const name = show.show_name;
    if (!name) { skipped++; continue; }

    // Check if we already looked up this show
    if (nameMap.has(name)) {
      const cachedUrl = nameMap.get(name)!;
      if (cachedUrl) {
        const { error: upErr } = await sb
          .from("followed_shows")
          .update({ artwork: cachedUrl, artwork_url: cachedUrl })
          .eq("id", show.id);
        if (!upErr) updated++;
        else failed++;
      } else {
        skipped++;
      }
      continue;
    }

    // Fetch from iTunes
    try {
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&media=podcast&limit=1`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) { nameMap.set(name, ""); skipped++; continue; }
      const data = await res.json();
      const artworkUrl = data.results?.[0]?.artworkUrl600 || "";

      nameMap.set(name, artworkUrl);

      if (!artworkUrl) { skipped++; continue; }

      // Update both columns to be safe
      const { error: upErr } = await sb
        .from("followed_shows")
        .update({ artwork: artworkUrl, artwork_url: artworkUrl })
        .eq("id", show.id);

      if (!upErr) updated++;
      else failed++;

      // Rate limit iTunes API
      await new Promise(r => setTimeout(r, 300));
    } catch {
      nameMap.set(name, "");
      failed++;
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    total: shows.length,
    updated,
    skipped,
    failed,
  }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/migrate-artwork" };
