import type { Config } from "@netlify/functions";
import Stripe from "stripe";

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
    const { priceId, userEmail, userId, planName } = await req.json();

    if (!priceId || !userEmail || !userId) {
      return new Response(JSON.stringify({ error: "priceId, userEmail, and userId are required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer_email: userEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 7,
        metadata: { userId, planName: planName || "" },
      },
      success_url: "https://podlens.app/account?upgraded=true&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://podlens.app/pricing?cancelled=true",
      metadata: { userId, planName: planName || "" },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Checkout creation failed" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/create-checkout" };
