import type { Config, Context } from "@netlify/edge-functions";

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // Skip if already on /kr path, or API/asset paths
  if (
    path.startsWith("/kr") ||
    path.startsWith("/api/") ||
    path.startsWith("/.netlify/") ||
    path.includes(".")
  ) {
    return context.next();
  }

  // Read user's saved preference cookie
  const cookies = req.headers.get("cookie") || "";
  const cookieMap: Record<string, string> = {};
  cookies.split(";").forEach((c) => {
    const [k, v] = c.trim().split("=");
    if (k) cookieMap[k.trim()] = (v || "").trim();
  });

  const savedRegion = cookieMap["podlens-region"];

  // User explicitly chose international → never redirect
  if (savedRegion === "international") {
    return context.next();
  }

  // User previously identified as Korean → redirect to /kr
  if (savedRegion === "ko-KR") {
    return Response.redirect(url.origin + "/kr" + path + url.search, 302);
  }

  // First visit: check Netlify geo
  const country = context.geo?.country?.code?.toLowerCase();
  if (country === "kr") {
    const response = Response.redirect(
      url.origin + "/kr" + path + url.search,
      302
    );
    // Set cookie so subsequent requests don't need geo lookup
    response.headers.set(
      "Set-Cookie",
      "podlens-region=ko-KR; Path=/; Max-Age=2592000; SameSite=Lax"
    );
    return response;
  }

  return context.next();
};

export const config: Config = { path: "/*" };
