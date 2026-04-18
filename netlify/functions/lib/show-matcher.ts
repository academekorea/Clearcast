import { getSupabaseAdmin } from "./supabase.js";

// ── Types ──────────────────────────────────────────────────────────────
export interface ShowInput {
  spotify_id?: string | null;
  youtube_channel_id?: string | null;
  itunes_id?: string | null;
  feed_url?: string | null;
  name?: string | null;
  slug?: string | null;
  publisher?: string | null;
  description?: string | null;
  artwork_url?: string | null;
  host_name?: string | null;
  category?: string | null;
  source_type?: string | null; // 'spotify' | 'youtube' | 'rss' | 'apple' | 'manual'
}

export interface ShowMatchResult {
  showId: string;
  wasCreated: boolean;
}

// ── Slug normalization ────────────────────────────────────────────────
export function normalizeSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")    // strip accents
    .replace(/[^a-z0-9\s-]/g, "")        // strip non-alphanumeric except hyphens/spaces
    .trim()
    .replace(/\s+/g, "-")                // spaces → hyphens
    .replace(/-+/g, "-")                 // collapse consecutive hyphens
    .slice(0, 100);                      // cap length for URL safety
}

// ── Main function ────────────────────────────────────────────────────
export async function findOrCreateShow(
  input: ShowInput
): Promise<ShowMatchResult | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.error("[show-matcher] Supabase admin client unavailable");
    return null;
  }

  try {
    // Step 1: Try to find an existing show by platform IDs or slug/name
    const existing = await findShow(input);

    if (existing) {
      // Merge any new platform IDs into the existing row
      await mergePlatformIds(existing.showId, input);
      return { showId: existing.showId, wasCreated: false };
    }

    // Step 2: Not found — create a new row
    const name = input.name || input.slug || "Unknown Show";
    const baseSlug = input.slug || normalizeSlug(name);
    const slug = await ensureUniqueSlug(baseSlug);

    const { data, error } = await supabase
      .from("shows")
      .insert({
        slug,
        name,
        feed_url: input.feed_url || null,
        spotify_id: input.spotify_id || null,
        youtube_channel_id: input.youtube_channel_id || null,
        itunes_id: input.itunes_id || null,
        publisher: input.publisher || null,
        description: input.description || null,
        artwork_url: input.artwork_url || null,
        host_name: input.host_name || null,
        category: input.category || null,
        source_type: input.source_type || null,
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error("[show-matcher] Insert failed:", error?.message);
      return null;
    }

    return { showId: data.id as string, wasCreated: true };
  } catch (err) {
    console.error("[show-matcher] Unexpected error:", err);
    return null;
  }
}

// ── Find-only variant (no creation) ──────────────────────────────────
export async function findShow(
  input: ShowInput
): Promise<{ showId: string } | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const lookups: Array<{ column: string; value: string }> = [];

  if (input.spotify_id)        lookups.push({ column: "spotify_id",         value: input.spotify_id });
  if (input.youtube_channel_id) lookups.push({ column: "youtube_channel_id", value: input.youtube_channel_id });
  if (input.itunes_id)         lookups.push({ column: "itunes_id",          value: input.itunes_id });
  if (input.feed_url)          lookups.push({ column: "feed_url",           value: input.feed_url });
  if (input.slug)              lookups.push({ column: "slug",               value: input.slug });

  // Try platform-ID lookups first (most reliable)
  for (const { column, value } of lookups) {
    try {
      const { data } = await supabase
        .from("shows")
        .select("id")
        .eq(column, value)
        .maybeSingle();
      if (data?.id) return { showId: data.id as string };
    } catch (err) {
      console.warn(`[show-matcher] Lookup by ${column} failed:`, err);
    }
  }

  // Fallback: fuzzy name lookup
  if (input.name) {
    try {
      const { data } = await supabase
        .from("shows")
        .select("id,name")
        .ilike("name", input.name.trim())
        .limit(1)
        .maybeSingle();
      if (data?.id) return { showId: data.id as string };
    } catch (err) {
      console.warn("[show-matcher] Name lookup failed:", err);
    }

    // Try slug-normalized match as last resort
    try {
      const candidateSlug = normalizeSlug(input.name);
      const { data } = await supabase
        .from("shows")
        .select("id")
        .eq("slug", candidateSlug)
        .maybeSingle();
      if (data?.id) return { showId: data.id as string };
    } catch (err) {
      console.warn("[show-matcher] Slug-normalized lookup failed:", err);
    }
  }

  return null;
}

// ── Merge new platform IDs into an existing show row ────────────────
async function mergePlatformIds(
  showId: string,
  input: ShowInput
): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  // Fetch current row to determine which fields to fill in
  try {
    const { data: current } = await supabase
      .from("shows")
      .select("spotify_id,youtube_channel_id,itunes_id,feed_url,artwork_url,publisher,description,host_name,category")
      .eq("id", showId)
      .maybeSingle();

    if (!current) return;

    const updates: Record<string, any> = {};

    // Only fill in fields that are currently null and input has a value
    if (!current.spotify_id && input.spotify_id) updates.spotify_id = input.spotify_id;
    if (!current.youtube_channel_id && input.youtube_channel_id) updates.youtube_channel_id = input.youtube_channel_id;
    if (!current.itunes_id && input.itunes_id) updates.itunes_id = input.itunes_id;
    if (!current.feed_url && input.feed_url) updates.feed_url = input.feed_url;
    if (!current.artwork_url && input.artwork_url) updates.artwork_url = input.artwork_url;
    if (!current.publisher && input.publisher) updates.publisher = input.publisher;
    if (!current.description && input.description) updates.description = input.description;
    if (!current.host_name && input.host_name) updates.host_name = input.host_name;
    if (!current.category && input.category) updates.category = input.category;

    if (Object.keys(updates).length === 0) return;

    updates.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from("shows")
      .update(updates)
      .eq("id", showId);

    if (error) console.warn("[show-matcher] Merge failed:", error.message);
  } catch (err) {
    console.warn("[show-matcher] Merge exception:", err);
  }
}

// ── Ensure slug is unique by appending a counter if collision ───────
async function ensureUniqueSlug(baseSlug: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return baseSlug;

  let slug = baseSlug;
  let counter = 2;
  const maxTries = 20;

  for (let i = 0; i < maxTries; i++) {
    try {
      const { data } = await supabase
        .from("shows")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();

      if (!data) return slug; // slug is free

      // Collision — append counter
      slug = `${baseSlug}-${counter}`;
      counter++;
    } catch {
      return slug; // fallback: use whatever we have
    }
  }

  // Worst case: append timestamp to guarantee uniqueness
  return `${baseSlug}-${Date.now()}`;
}
