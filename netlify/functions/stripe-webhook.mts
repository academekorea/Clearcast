import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import Stripe from "stripe";
import { getSupabaseAdmin, sbUpsert, sbUpdate, trackEvent } from "./lib/supabase.js";
import { sendEmail, paymentFailedEmail } from "./lib/email.js";

// Internal plan keys → human display names for emails/metadata
const PLAN_DISPLAY: Record<string, string> = {
  creator:  "Starter Lens",
  operator: "Pro Lens",
  studio:   "Operator Lens",
  free:     "Free",
};

function planDisplayName(key: string): string {
  return PLAN_DISPLAY[key] || (key.charAt(0).toUpperCase() + key.slice(1));
}

function planFromPriceId(priceId: string): string {
  // Build map from env vars at call time (no cold-start cache issues)
  const map: Record<string, string> = {};
  const starters = [Netlify.env.get("STRIPE_STARTER_MONTHLY_ID"), Netlify.env.get("STRIPE_STARTER_ANNUAL_ID")];
  const pros     = [Netlify.env.get("STRIPE_PRO_MONTHLY_ID"),     Netlify.env.get("STRIPE_PRO_ANNUAL_ID")];
  const ops      = [Netlify.env.get("STRIPE_OPERATOR_MONTHLY_ID"),Netlify.env.get("STRIPE_OPERATOR_ANNUAL_ID")];
  starters.forEach(id => { if (id) map[id] = "creator"; });
  pros    .forEach(id => { if (id) map[id] = "operator"; });
  ops     .forEach(id => { if (id) map[id] = "studio"; });
  return map[priceId] || "creator"; // default to starter if unknown
}

export default async (req: Request) => {
  const stripeSecretKey = Netlify.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Netlify.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeSecretKey) return new Response("Stripe not configured", { status: 500 });

  const stripe = new Stripe(stripeSecretKey);
  const sig = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  // Signature verification is mandatory — never process unsigned webhooks
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set — rejecting webhook");
    return new Response("Webhook secret not configured", { status: 500 });
  }
  if (!sig) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (e: any) {
    return new Response(`Webhook signature failed: ${e.message}`, { status: 400 });
  }

  const store = getStore("podlens-users");
  const sb = getSupabaseAdmin();

  try {
    switch (event.type) {
      // ── Checkout completed ─────────────────────────────────────────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const planName = session.metadata?.planName || "creator";
        const foundingApplied = session.metadata?.foundingApplied === "true";
        if (!userId) break;

        const subscription = session.subscription
          ? await stripe.subscriptions.retrieve(session.subscription as string)
          : null;
        const periodEnd = subscription?.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null;
        const customerId = session.customer as string;
        const subId = session.subscription as string;

        // Blobs (legacy)
        await store.setJSON(`user-plan-${userId}`, {
          plan: planName, stripeCustomerId: customerId,
          subscriptionId: subId, currentPeriodEnd: periodEnd,
          isActive: true, updatedAt: Date.now(),
        });

        // Supabase subscriptions table
        sbUpsert('subscriptions', {
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subId,
          plan: planName,
          billing_period: subscription?.items?.data?.[0]?.price?.recurring?.interval || 'month',
          status: 'active',
          current_period_start: subscription?.current_period_start
            ? new Date(subscription.current_period_start * 1000).toISOString() : null,
          current_period_end: periodEnd,
          founding_discount: foundingApplied,
          updated_at: new Date().toISOString(),
        }).catch(() => {});

        // Supabase users table
        sbUpdate('users', { id: userId }, {
          tier: planName,
          stripe_customer_id: customerId,
          stripe_subscription_id: subId,
          payment_grace_until: null,
          last_seen_at: new Date().toISOString(),
        }).catch(() => {});

        trackEvent(userId, 'upgrade_clicked', {
          plan: planName, founding_applied: foundingApplied,
          source: 'stripe_webhook',
        });
        break;
      }

      // ── Subscription updated ───────────────────────────────────────────────
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        if (!userId) break;

        const planName = sub.metadata?.planName || "creator";
        const isActive = sub.status === "active" || sub.status === "trialing";
        const periodEnd = new Date(sub.current_period_end * 1000).toISOString();

        const existing = await store.get(`user-plan-${userId}`, { type: "json" }).catch(() => null) as any;
        await store.setJSON(`user-plan-${userId}`, {
          ...(existing || {}),
          plan: isActive ? planName : "free",
          subscriptionId: sub.id,
          currentPeriodEnd: periodEnd,
          isActive, updatedAt: Date.now(),
        });

        sbUpsert('subscriptions', {
          user_id: userId,
          stripe_subscription_id: sub.id,
          plan: isActive ? planName : 'free',
          status: sub.status,
          current_period_end: periodEnd,
          updated_at: new Date().toISOString(),
        }).catch(() => {});

        sbUpdate('users', { id: userId }, {
          tier: isActive ? planName : 'free',
          stripe_subscription_id: sub.id,
        }).catch(() => {});
        break;
      }

      // ── Subscription deleted ───────────────────────────────────────────────
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        if (!userId) break;

        const existing = await store.get(`user-plan-${userId}`, { type: "json" }).catch(() => null) as any;
        await store.setJSON(`user-plan-${userId}`, {
          ...(existing || {}), plan: "free", isActive: false,
          subscriptionId: sub.id, updatedAt: Date.now(),
        });

        sbUpdate('subscriptions', { stripe_subscription_id: sub.id }, {
          plan: 'free', status: 'canceled', updated_at: new Date().toISOString(),
        }).catch(() => {});

        sbUpdate('users', { id: userId }, { tier: 'free' }).catch(() => {});
        trackEvent(userId, 'subscription_canceled', { sub_id: sub.id });
        break;
      }

      // ── Payment failed ─────────────────────────────────────────────────────
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        if (!customerId) break;

        // Find user by Stripe customer ID
        let userId: string | null = null;
        let userEmail: string | null = null;
        let userName: string | null = null;
        let planName = 'creator';

        if (sb) {
          const { data } = await sb
            .from('users')
            .select('id,email,name,tier')
            .eq('stripe_customer_id', customerId)
            .single();
          if (data) {
            userId = data.id;
            userEmail = data.email;
            userName = data.name;
            planName = data.tier || 'creator';
          }
        }

        // Set 3-day grace period in Supabase + Blobs
        const gracePeriodEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
        if (userId) {
          sbUpdate('users', { id: userId }, { payment_grace_until: gracePeriodEnd }).catch(() => {});
          // Also write to Blobs so get-plan.mts can read it
          const existing = await store.get(`user-plan-${userId}`, { type: "json" }).catch(() => null) as any;
          store.setJSON(`user-plan-${userId}`, {
            ...(existing || {}), paymentGraceUntil: gracePeriodEnd, updatedAt: Date.now(),
          }).catch(() => {});
        }

        // Send payment failed email
        if (userEmail) {
          const stripeCustomer = await stripe.customers.retrieve(customerId).catch(() => null) as any;
          const portalUrl = stripeCustomer
            ? `https://billing.stripe.com/p/login/${customerId}`
            : 'https://podlens.app/account';

          sendEmail({
            to: userEmail,
            subject: `Payment issue with your Podlens subscription`,
            html: paymentFailedEmail({
              name: userName || '',
              planName: planDisplayName(planName),
              updateUrl: portalUrl,
              daysUntilDowngrade: 3,
            }),
          }).catch(() => {});
        }

        trackEvent(userId, 'payment_failed', { customer_id: customerId, plan: planName });

        console.log(`Payment failed for customer ${customerId} (user: ${userId})`);
        break;
      }

      // ── Payment succeeded (clear grace period) ─────────────────────────────
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        if (!customerId) break;

        // Clear in Supabase
        if (sb) {
          await sb.from('users')
            .update({ payment_grace_until: null })
            .eq('stripe_customer_id', customerId)
            .catch(() => {});

          // Find userId to clear Blobs too
          const { data: userData } = await sb.from('users')
            .select('id').eq('stripe_customer_id', customerId).single().catch(() => ({ data: null }));
          if (userData?.id) {
            const existing = await store.get(`user-plan-${userData.id}`, { type: "json" }).catch(() => null) as any;
            if (existing) {
              store.setJSON(`user-plan-${userData.id}`, {
                ...existing, paymentGraceUntil: null, updatedAt: Date.now(),
              }).catch(() => {});
            }
          }
        }
        break;
      }
    }
  } catch (e: any) {
    console.error("Webhook handler error:", e?.message);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/stripe-webhook" };
