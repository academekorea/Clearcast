import type { Config } from "@netlify/functions";

export default async () => {
  return new Response(
    JSON.stringify({
      spotifyClientId: Netlify.env.get("SPOTIFY_CLIENT_ID") || "",
      // Stripe price IDs — publishable, safe to expose to frontend
      prices: {
        creator_monthly:  Netlify.env.get("STRIPE_STARTER_MONTHLY_ID")  || "price_1TIpsgRrzq6bX9wpo0rps1RP",
        creator_annual:   Netlify.env.get("STRIPE_STARTER_ANNUAL_ID")   || "price_1TIptTRrzq6bX9wpUGs4qpIf",
        operator_monthly: Netlify.env.get("STRIPE_PRO_MONTHLY_ID")      || "price_1TIpuCRrzq6bX9wpJkfWm1Kg",
        operator_annual:  Netlify.env.get("STRIPE_PRO_ANNUAL_ID")       || "price_1TIpzpRrzq6bX9wpor5U7uJS",
        studio_monthly:   Netlify.env.get("STRIPE_OPERATOR_MONTHLY_ID") || "price_1TIq6eRrzq6bX9wppzyt3rps",
        studio_annual:    Netlify.env.get("STRIPE_OPERATOR_ANNUAL_ID")  || "price_1TIq7BRrzq6bX9wp7X9wytJc",
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
