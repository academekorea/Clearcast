import type { Config } from "@netlify/functions";
import { getSupabaseAdmin } from "./lib/supabase.js";
import { sendEmail, pilotExpiryEmail } from "./lib/email.js";

// Runs daily — sends pilot expiry emails at 30, 7, and 1 day before expiry

// Phase 2: KRW pricing deferred — international USD only
// Founding prices shown (33% off normal)
const TIER_PRICES: Record<string, { creator: string; operator: string }> = {
  USD: { creator: '$4.69/mo (Starter Lens)', operator: '$12.73/mo (Pro Lens)' },
};

export default async (req: Request) => {
  const sb = getSupabaseAdmin();
  if (!sb) return new Response('Supabase not configured', { status: 500 });

  const now = new Date();
  const in31 = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000).toISOString();
  let sent = 0;

  try {
    const { data: pilots } = await sb
      .from('users')
      .select('id,email,name,language,pilot_expires_at')
      .eq('pilot_member', true)
      .lte('pilot_expires_at', in31)
      .gte('pilot_expires_at', now.toISOString());

    if (!pilots) return new Response(JSON.stringify({ sent: 0 }), { status: 200 });

    for (const user of pilots) {
      if (!user.email || !user.pilot_expires_at) continue;

      const expiresAt = new Date(user.pilot_expires_at);
      const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / 86400000);

      // Only send on 30, 7, 1 day marks
      if (daysLeft !== 30 && daysLeft !== 7 && daysLeft !== 1) continue;

      const prices = TIER_PRICES.USD;
      const ok = await sendEmail({
        to: user.email,
        subject: daysLeft <= 1
          ? '⏰ Last day of free Podlens access — lock in your discount'
          : `${daysLeft} days left of free Podlens access`,
        html: pilotExpiryEmail({
          name: user.name || '',
          daysLeft,
          creatorPrice: prices.creator,
          operatorPrice: prices.operator,
        }),
      });
      if (ok) sent++;
    }
  } catch (e: any) {
    console.error('[check-pilot-expiry]', e?.message);
    return new Response(JSON.stringify({ error: e?.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ sent, ts: new Date().toISOString() }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};

export const config: Config = {
  schedule: '0 1 * * *', // Daily 1am UTC
};
