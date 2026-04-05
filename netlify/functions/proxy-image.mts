import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  const imageUrl = new URL(req.url).searchParams.get("url");
  if (!imageUrl) return new Response("", { status: 400 });

  // Validate URL to prevent SSRF
  let parsed: URL;
  try { parsed = new URL(imageUrl); } catch { return new Response("", { status: 400 }); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return new Response("", { status: 400 });
  }

  try {
    const res = await fetch(imageUrl, {
      headers: { "User-Agent": "PodLens/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    const buffer = await res.arrayBuffer();
    return new Response(buffer, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new Response("", { status: 204 });
  }
};

export const config: Config = { path: "/api/proxy-image" };
