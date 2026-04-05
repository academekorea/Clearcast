import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { isSuperAdmin } from "./lib/admin.js";

export default async (req: Request) => {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const provider = url.searchParams.get("provider");
  const action = url.searchParams.get("action");

  // Return public OAuth client IDs (safe — these are publishable)
  if (provider === "google") {
    const googleClientId = Netlify.env.get("GOOGLE_CLIENT_ID") || "";
    return new Response(JSON.stringify({ googleClientId: googleClientId || null }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  if (provider === "kakao") {
    const kakaoJsKey = Netlify.env.get("KAKAO_APP_KEY") || "";
    return new Response(JSON.stringify({ kakaoJsKey: kakaoJsKey || null }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  // Return founding period status + spots remaining (public)
  if (action === "founding") {
    const foundingEndRaw = Netlify.env.get("FOUNDING_COUPON_END_DATE") || "2026-07-05";
    const foundingMax = parseInt(Netlify.env.get("FOUNDING_MAX_SIGNUPS") || "500", 10);
    const foundingActive = new Date() < new Date(foundingEndRaw);
    let spotsLeft = foundingMax;
    let signupCount = 0;
    try {
      const metaStore = getStore("podlens-meta");
      const cached = await metaStore.get("founding-signups-count", { type: "json" }) as any;
      signupCount = cached?.count ?? 0;
      spotsLeft = Math.max(0, foundingMax - signupCount);
    } catch {}
    return new Response(JSON.stringify({
      foundingActive,
      foundingEndsAt: foundingEndRaw,
      spotsLeft,
      signupCount,
      foundingMax,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // Super admin check by email param
  const emailParam = url.searchParams.get("email") || "";
  if (emailParam && isSuperAdmin(emailParam)) {
    return new Response(JSON.stringify({
      plan: "studio", isActive: true, currentPeriodEnd: null,
      isSuperAdmin: true, bypassLimits: true,
      foundingMember: false, pilotMember: false,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  if (!userId) {
    return new Response(JSON.stringify({ error: "userId required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const store = getStore("podlens-users");
    const data = await store.get(`user-plan-${userId}`, { type: "json" }) as any;

    // Also fetch founding/pilot membership info
    let foundingData: any = null;
    try {
      foundingData = await store.get(`founding-${userId}`, { type: "json" });
    } catch {}

    if (!data) {
      return new Response(JSON.stringify({
        plan: "free",
        isActive: false,
        currentPeriodEnd: null,
        foundingMember: foundingData?.foundingMember || false,
        foundingMemberSince: foundingData?.foundingMemberSince || null,
        pilotMember: foundingData?.pilotMember || false,
        pilotExpiresAt: foundingData?.pilotExpiresAt || null,
        signupCount: foundingData?.signupCount || null,
      }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // Expire if period has passed
    let isActive = data.isActive;
    if (data.currentPeriodEnd && new Date(data.currentPeriodEnd).getTime() < Date.now()) {
      isActive = false;
    }

    // Grace period: payment failed but within 3-day window — keep plan active
    const graceUntil = data.paymentGraceUntil || null;
    const inGrace = graceUntil && new Date(graceUntil).getTime() > Date.now();
    const effectiveIsActive = isActive || !!inGrace;

    return new Response(JSON.stringify({
      plan: effectiveIsActive ? data.plan : "free",
      currentPeriodEnd: data.currentPeriodEnd,
      isActive: effectiveIsActive,
      graceMode: !!inGrace,
      graceUntil: inGrace ? graceUntil : null,
      stripeCustomerId: data.stripeCustomerId,
      foundingMember: foundingData?.foundingMember || data.foundingMember || false,
      foundingMemberSince: foundingData?.foundingMemberSince || data.foundingMemberSince || null,
      pilotMember: foundingData?.pilotMember || data.pilotMember || false,
      pilotExpiresAt: foundingData?.pilotExpiresAt || data.pilotExpiresAt || null,
      signupCount: foundingData?.signupCount || data.signupCount || null,
    }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ plan: "free", isActive: false, currentPeriodEnd: null }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/get-plan" };
