import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import Stripe from "stripe";

// Maps plan+billing keys → Netlify env var names holding the Stripe price IDs.
// After creating products in Stripe, set these in Netlify → Site config → Env vars.
// Maps plan+billing → env var name → fallback price ID
const PRICE_MAP: Record<string, string> = {
  creator_monthly:  Netlify.env.get("STRIPE_STARTER_MONTHLY_ID")  || "price_1TIpsgRrzq6bX9wpo0rps1RP",
  creator_annual:   Netlify.env.get("STRIPE_STARTER_ANNUAL_ID")   || "price_1TIptTRrzq6bX9wpUGs4qpIf",
  operator_monthly: Netlify.env.get("STRIPE_PRO_MONTHLY_ID")      || "price_1TIpuCRrzq6bX9wpJkfWm1Kg",
  operator_annual:  Netlify.env.get("STRIPE_PRO_ANNUAL_ID")       || "price_1TIpzpRrzq6bX9wpor5U7uJS",
  studio_monthly:   Netlify.env.get("STRIPE_OPERATOR_MONTHLY_ID") || "price_1TIq6eRrzq6bX9wppzyt3rps",
  studio_annual:    Netlify.env.get("STRIPE_OPERATOR_ANNUAL_ID")  || "price_1TIq7BRrzq6bX9wp7X9wytJc",
};

// Human-readable plan names for metadata
const PLAN_DISPLAY: Record<string, string> = {
  creator:  "Starter Lens",
  operator: "Pro Lens",
  studio:   "Operator Lens",
};

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
    const body = await req.json();
    const { userEmail, userId } = body;
    let { priceId, planName, billing } = body;

    // Resolve priceId from env var if not provided directly
    if (!priceId && planName && billing) {
      priceId = PRICE_MAP[`${planName}_${billing}`] || "";
    }

    if (!priceId || !userEmail || !userId) {
      return new Response(JSON.stringify({
        error: "priceId (or planName+billing), userEmail, and userId are required"
      }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const displayName = PLAN_DISPLAY[planName] || planName || "";

    // ── Founding period coupon ─────────────────────────────────────────────────
    const FOUNDING_END = new Date(
      "2099-12-31" || "2026-07-05"
    );
    const FOUNDING_MAX = parseInt("500" || "500", 10);
    const isFoundingPeriod = new Date() < FOUNDING_END;

    let spotsLeft = FOUNDING_MAX;
    let timesRedeemed = 0;

    if (isFoundingPeriod) {
      try {
        const coupon = await stripe.coupons.retrieve("FOUNDING");
        timesRedeemed = coupon.times_redeemed || 0;
        spotsLeft = FOUNDING_MAX - timesRedeemed;
      } catch {
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

    // ── PILOT2026 coupon — 100% off 3 months, separate from founding spots ─────
    const pilotCode = body.couponCode?.toUpperCase();
    const isPilot = pilotCode === "PILOT2026";
    if (isPilot) {
      discounts.length = 0; // PILOT2026 replaces FOUNDING
      discounts.push({ coupon: "PILOT2026" });
    }

    const sessionParams: Parameters<typeof stripe.checkout.sessions.create>[0] = {
      payment_method_types: ["card"],
      mode: "subscription",
      customer_email: userEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: {
          userId,
          planName: planName || "",
          displayName,
          foundingApplied: (!isPilot && applyFounding) ? "true" : "false",
          isPilot: isPilot ? "true" : "false",
        },
      },
      success_url: "https://podlens.app/account?upgraded=true&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://podlens.app/pricing?cancelled=true",
      metadata: { userId, planName: planName || "", displayName },
    };

    // Stripe does not allow both allow_promotion_codes and discounts simultaneously
    if (discounts.length > 0) {
      (sessionParams as any).discounts = discounts;
      // allow_promotion_codes must NOT be set when discounts is used
    } else {
      (sessionParams as any).allow_promotion_codes = true;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return new Response(JSON.stringify({
      url: session.url,
      foundingApplied: applyFounding && !isPilot,
      isPilot,
      spotsLeft: isPilot ? null : spotsLeft,
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("[create-checkout]", e?.message || e);
    return new Response(JSON.stringify({ error: "Unable to create checkout session" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/create-checkout" };
