import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request) => {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");

  if (!userId) {
    return new Response(JSON.stringify({ error: "userId required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const store = getStore("podlens-users");
    const data = await store.get(`user-plan-${userId}`, { type: "json" }) as any;

    if (!data) {
      return new Response(JSON.stringify({ plan: "free", isActive: false, currentPeriodEnd: null }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // Expire if period has passed
    let isActive = data.isActive;
    if (data.currentPeriodEnd && new Date(data.currentPeriodEnd).getTime() < Date.now()) {
      isActive = false;
    }

    return new Response(JSON.stringify({
      plan: isActive ? data.plan : "free",
      currentPeriodEnd: data.currentPeriodEnd,
      isActive,
      stripeCustomerId: data.stripeCustomerId,
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
