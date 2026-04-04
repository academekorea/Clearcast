import type { Config } from "@netlify/functions";
import Stripe from "stripe";
import { getStore } from "@netlify/blobs";

export default async (req: Request) => {
  const stripeSecretKey = Netlify.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Netlify.env.get("STRIPE_WEBHOOK_SECRET");

  if (!stripeSecretKey) {
    return new Response("Stripe not configured", { status: 500 });
  }

  const stripe = new Stripe(stripeSecretKey);
  const sig = req.headers.get("stripe-signature");

  // Must read raw body before any parsing for signature verification
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } else {
      // Dev fallback — parse without signature verification
      event = JSON.parse(rawBody) as Stripe.Event;
    }
  } catch (e: any) {
    return new Response(`Webhook signature verification failed: ${e.message}`, { status: 400 });
  }

  const store = getStore("podlens-users");

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const planName = session.metadata?.planName || "creator";
        if (!userId) break;

        // Fetch the subscription to get period end
        const subscription = session.subscription
          ? await stripe.subscriptions.retrieve(session.subscription as string)
          : null;

        await store.setJSON(`user-plan-${userId}`, {
          plan: planName,
          stripeCustomerId: session.customer as string,
          subscriptionId: session.subscription as string,
          currentPeriodEnd: subscription?.current_period_end
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : null,
          isActive: true,
          updatedAt: Date.now(),
        });
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        if (!userId) break;

        const planName = sub.metadata?.planName || "creator";
        const isActive = sub.status === "active" || sub.status === "trialing";
        const existing = await store.get(`user-plan-${userId}`, { type: "json" }).catch(() => null) as any;

        await store.setJSON(`user-plan-${userId}`, {
          ...(existing || {}),
          plan: isActive ? planName : "free",
          subscriptionId: sub.id,
          currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
          isActive,
          updatedAt: Date.now(),
        });
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        if (!userId) break;

        const existing = await store.get(`user-plan-${userId}`, { type: "json" }).catch(() => null) as any;
        await store.setJSON(`user-plan-${userId}`, {
          ...(existing || {}),
          plan: "free",
          isActive: false,
          subscriptionId: sub.id,
          updatedAt: Date.now(),
        });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        if (!customerId) break;
        // Could notify user — for now just log
        console.log(`Payment failed for customer ${customerId}`);
        break;
      }
    }
  } catch (e: any) {
    // Log but still return 200 — Stripe will retry on non-2xx responses
    console.error("Webhook handler error:", e?.message);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/stripe-webhook" };
