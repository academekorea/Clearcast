import type { Config } from "@netlify/functions";
import Stripe from "stripe";
import { getStore } from "@netlify/blobs";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const stripeSecretKey = Netlify.env.get("STRIPE_SECRET_KEY");
  if (!stripeSecretKey) {
    return new Response(JSON.stringify({ error: "Stripe not configured" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(stripeSecretKey);

  try {
    const { userId } = await req.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const store = getStore("podlens-users");
    const planData = await store.get(`user-plan-${userId}`, { type: "json" }) as any;

    if (!planData?.stripeCustomerId) {
      return new Response(JSON.stringify({ error: "No billing account found. Upgrade first to manage billing." }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: planData.stripeCustomerId,
      return_url: "https://podlens.app/account",
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[billing-portal]", e?.message || e);
    return new Response(JSON.stringify({ error: "Unable to access billing portal" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/billing-portal" };
