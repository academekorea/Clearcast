import type { Config } from "@netlify/functions";

export default async () => {
  return new Response(
    JSON.stringify({
      spotifyClientId: Netlify.env.get("SPOTIFY_CLIENT_ID") || "",
      // Stripe price IDs — publishable, safe to expose to frontend
      prices: {
        creator_monthly:  Netlify.env.get("STRIPE_STARTER_MONTHLY_ID")  || "",
        creator_yearly:   Netlify.env.get("STRIPE_STARTER_ANNUAL_ID")   || "",
        operator_monthly: Netlify.env.get("STRIPE_PRO_MONTHLY_ID")      || "",
        operator_yearly:  Netlify.env.get("STRIPE_PRO_ANNUAL_ID")       || "",
        studio_monthly:   Netlify.env.get("STRIPE_OPERATOR_MONTHLY_ID") || "",
        studio_yearly:    Netlify.env.get("STRIPE_OPERATOR_ANNUAL_ID")  || "",
      },
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
