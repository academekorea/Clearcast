import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
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

    // ── Founding period coupon ─────────────────────────────────────────────────
    const FOUNDING_END = new Date(
      Netlify.env.get("FOUNDING_COUPON_END_DATE") || "2026-07-05"
    );
    const FOUNDING_MAX = parseInt(Netlify.env.get("FOUNDING_MAX_SIGNUPS") || "500", 10);
    const isFoundingPeriod = new Date() < FOUNDING_END;

    let spotsLeft = FOUNDING_MAX;
    let timesRedeemed = 0;

    // Get live redemption count from Stripe
    if (isFoundingPeriod) {
      try {
        const coupon = await stripe.coupons.retrieve("FOUNDING");
        timesRedeemed = coupon.times_redeemed || 0;
        spotsLeft = FOUNDING_MAX - timesRedeemed;
      } catch {
        // Coupon may not exist yet — cache from Blobs
        try {
          const metaStore = getStore("podlens-meta");
          const cached = await metaStore.get("founding-signups-count", { type: "json" }) as any;
          timesRedeemed = cached?.count ?? 0;
          spotsLeft = FOUNDING_MAX - timesRedeemed;
        } catch {}
      }
    }

    const applyFounding = isFoundingPeriod && spotsLeft > 0;

    const discounts: { coupon: string }[] = [];
    if (applyFounding) discounts.push({ coupon: "FOUNDING" });

    const sessionParams: Parameters<typeof stripe.checkout.sessions.create>[0] = {
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
      metadata: { userId, planName: planName || "", foundingApplied: applyFounding ? "true" : "false" },
      allow_promotion_codes: !applyFounding,
    };

    if (discounts.length > 0) {
      (sessionParams as any).discounts = discounts;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return new Response(JSON.stringify({
      url: session.url,
      foundingApplied: applyFounding,
      spotsLeft,
    }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Checkout creation failed" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/create-checkout" };
