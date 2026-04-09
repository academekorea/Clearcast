import type { Config } from "@netlify/functions";

export default async () => {
  return new Response(
    JSON.stringify({
      spotifyClientId: Netlify.env.get("SPOTIFY_CLIENT_ID") || "",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    }
  );
};

export const config: Config = {
  path: "/api/public-config",
};
