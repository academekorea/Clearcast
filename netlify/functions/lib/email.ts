// Email templates and Resend sender for Podlens
// All emails: FROM = "PODLENS Support <hello@podlens.app>"

import { Resend } from 'resend'

let _resend: Resend | null = null

function getResend(): Resend | null {
  const key = Netlify.env.get('RESEND_API_KEY')
  if (!key) return null
  if (!_resend) _resend = new Resend(key)
  return _resend
}

const FROM = 'PODLENS Support <hello@podlens.app>'

// ── Base HTML wrapper ────────────────────────────────────────────────────────
function baseTemplate(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;background:#f4f3ef;margin:0;padding:24px}
.wrap{max-width:520px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e0ddd8}
.top{background:#0f2027;padding:20px 28px;display:flex;align-items:center;gap:10px}
.logo{font-family:Georgia,serif;font-size:22px;font-weight:700;color:#fff;letter-spacing:.05em}
.logo span{font-weight:400}
.content{padding:28px}
.h1{font-size:22px;font-weight:700;color:#0f2027;margin:0 0 14px}
p{font-size:14px;color:#444;line-height:1.65;margin:0 0 14px}
.btn{display:inline-block;background:#0f2027;color:#fff!important;text-decoration:none;padding:12px 24px;border-radius:4px;font-size:14px;font-weight:600;margin:8px 0 18px}
.bias-bar{height:10px;border-radius:5px;overflow:hidden;display:flex;margin:10px 0 4px}
.b-l{background:#E24B4A}.b-c{background:#D1CFC9}.b-r{background:#378ADD}
.pill{display:inline-block;padding:3px 10px;border-radius:3px;font-size:12px;font-weight:600;background:#f0efe9;color:#444;margin:0 0 14px}
.muted{font-size:12px;color:#999;margin-top:6px}
.footer{padding:18px 28px;background:#f4f3ef;font-size:11px;color:#aaa;text-align:center;border-top:1px solid #e0ddd8}
.warning{background:#fff9e6;border:1px solid #f0c040;border-radius:6px;padding:12px 16px;margin:14px 0}
.danger{background:#fff2f2;border:1px solid #fca5a5;border-radius:6px;padding:12px 16px;margin:14px 0}
</style></head><body>
<div class="wrap">
  <div class="top"><div class="logo"><span>POD</span>LENS</div></div>
  <div class="content">${body}</div>
  <div class="footer">
    Podlens · podlens.app · hello@podlens.app<br>
    <a href="https://podlens.app/settings" style="color:#aaa">Manage notifications</a>
  </div>
</div>
</body></html>`
}

// ── Templates ────────────────────────────────────────────────────────────────

export function preAnalysisReadyEmail(opts: {
  episodeTitle: string
  showName: string
  biasLabel: string
  leftPct: number
  centerPct: number
  rightPct: number
  topFinding: string
  analysisUrl: string
}): string {
  const { episodeTitle, showName, biasLabel, leftPct, centerPct, rightPct, topFinding, analysisUrl } = opts
  return baseTemplate(`
    <div class="h1">⚡ New <em>${showName}</em> episode analyzed</div>
    <p>A new episode is ready to listen — and your analysis is already waiting.</p>
    <div style="background:#f8f8f6;border-radius:6px;padding:14px 16px;margin-bottom:14px;border:1px solid #e0ddd8">
      <div style="font-size:13px;font-weight:600;color:#1a1a1a;margin-bottom:4px">${episodeTitle}</div>
      <div class="pill">${biasLabel}</div>
      <div class="bias-bar">
        <div class="b-l" style="width:${leftPct}%"></div>
        <div class="b-c" style="width:${centerPct}%"></div>
        <div class="b-r" style="width:${rightPct}%"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#999">
        <span>🔴 ${leftPct}% left</span><span>${centerPct}% center</span><span>${rightPct}% right 🔵</span>
      </div>
      ${topFinding ? `<div style="margin-top:10px;font-size:12px;color:#555;font-style:italic">"${topFinding}"</div>` : ''}
    </div>
    <a class="btn" href="${analysisUrl}">View full analysis →</a>
    <p class="muted">Pre-analysis is on because you enabled it in Settings. <a href="https://podlens.app/settings#notifications" style="color:#999">Manage</a></p>
  `)
}

export function pilotExpiryEmail(opts: {
  name: string
  daysLeft: number
  creatorPrice: string
  operatorPrice: string
}): string {
  const { name, daysLeft, creatorPrice, operatorPrice } = opts
  const urgency = daysLeft <= 1 ? 'danger' : 'warning'
  const subject =
    daysLeft <= 1
      ? 'Last day of free Podlens access'
      : `Your free Podlens access expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`

  return baseTemplate(`
    <div class="h1">${daysLeft <= 1 ? '⏰ Last day of free access' : `⚠ ${daysLeft} days left of free access`}</div>
    <p>Hi ${name || 'there'},</p>
    <div class="${urgency}">
      <strong>${subject}.</strong> Your early-user pricing is locked in — upgrade now and keep it forever.
    </div>
    <p>As a pilot member you get <strong>33% off for life</strong>. That discount disappears once your free access ends.</p>
    <div style="background:#f8f8f6;border-radius:6px;padding:14px 16px;margin:14px 0;border:1px solid #e0ddd8">
      <div style="font-size:13px;margin-bottom:6px"><strong>Starter Lens</strong> &nbsp;${creatorPrice}/mo <span style="font-size:11px;color:#999">(normally $7/mo)</span></div>
      <div style="font-size:13px"><strong>Pro Lens</strong> &nbsp;${operatorPrice}/mo <span style="font-size:11px;color:#999">(normally $19/mo)</span></div>
    </div>
    <a class="btn" href="https://podlens.app/pricing">Lock in my early pricing →</a>
  `)
}

export function paymentFailedEmail(opts: {
  name: string
  planName: string
  updateUrl: string
  daysUntilDowngrade: number
}): string {
  const { name, planName, updateUrl, daysUntilDowngrade } = opts
  return baseTemplate(`
    <div class="h1">⚠ Payment issue with your Podlens subscription</div>
    <p>Hi ${name || 'there'},</p>
    <div class="danger">
      <strong>Your ${planName} plan payment failed.</strong> You have ${daysUntilDowngrade} day${daysUntilDowngrade !== 1 ? 's' : ''} before your account is downgraded to the free tier.
    </div>
    <p>Update your payment method to keep uninterrupted access to all your analysis history and features.</p>
    <a class="btn" href="${updateUrl}">Update payment method →</a>
    <p class="muted">If you believe this is a mistake, reply to this email and we'll sort it out right away.</p>
  `)
}

export function weeklyDigestEmail(opts: {
  name: string
  analyses: Array<{ showName: string; episodeTitle: string; biasLabel: string; url: string }>
  totalCount: number
}): string {
  const { name, analyses, totalCount } = opts
  const rows = analyses.slice(0, 5).map(a => `
    <div style="padding:10px 0;border-bottom:1px solid #f0efe9">
      <div style="font-size:13px;font-weight:600;color:#1a1a1a">${a.episodeTitle}</div>
      <div style="font-size:11px;color:#888;margin:2px 0">${a.showName}</div>
      <div class="pill" style="margin:4px 0 0">${a.biasLabel}</div>
    </div>
  `).join('')

  return baseTemplate(`
    <div class="h1">📊 Your Podlens week in review</div>
    <p>Hi ${name || 'there'}, here's what you listened to and analyzed this week.</p>
    <div style="font-size:13px;color:#555;margin-bottom:16px">
      You ran <strong>${totalCount} analysis${totalCount !== 1 ? 'es' : ''}</strong> this week.
    </div>
    ${rows}
    <a class="btn" href="https://podlens.app/library" style="margin-top:18px">View your full library →</a>
  `)
}

export function magicLinkEmail(opts: {
  name: string
  magicUrl: string
  expiryMinutes: number
}): string {
  const { name, magicUrl, expiryMinutes } = opts
  return baseTemplate(`
    <div class="h1">Your sign-in link</div>
    <p>Hi ${name || 'there'},</p>
    <p>Click the button below to sign in to Podlens. This link expires in ${expiryMinutes} minutes and can only be used once.</p>
    <a class="btn" href="${magicUrl}">Sign in to Podlens →</a>
    <p class="muted">If you didn't request this, you can safely ignore this email. Someone may have typed your address by mistake.</p>
  `)
}

export function newDeviceAlertEmail(opts: {
  name: string
  deviceInfo: string
  location: string
  time: string
  secureUrl: string
}): string {
  const { name, deviceInfo, location, time, secureUrl } = opts
  return baseTemplate(`
    <div class="h1">New sign-in detected</div>
    <p>Hi ${name || 'there'},</p>
    <div class="warning">
      <strong>Your Podlens account was accessed from a new device.</strong>
    </div>
    <div style="background:#f8f8f6;border-radius:6px;padding:14px 16px;margin:14px 0;border:1px solid #e0ddd8;font-size:13px">
      <div style="margin-bottom:6px"><strong>Device:</strong> ${deviceInfo}</div>
      <div style="margin-bottom:6px"><strong>Location:</strong> ${location}</div>
      <div><strong>Time:</strong> ${time}</div>
    </div>
    <p>If this was you, no action is needed. If you don't recognize this sign-in, secure your account immediately.</p>
    <a class="btn" href="${secureUrl}">Review account security →</a>
  `)
}

export function welcomeEmail(opts: {
  name: string
  email: string
  plan: string
  trialEndsAt?: string
}): { subject: string; html: string } {
  const firstName = opts.name.split(' ')[0] || 'there'
  const trialNote = opts.plan === 'trial' && opts.trialEndsAt
    ? `<p>Your 7-day Operator trial ends on <strong>${new Date(opts.trialEndsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong>. After that, you'll move to the free tier — or <a href="https://podlens.app/pricing" style="color:#0f2027">upgrade to keep your access</a>.</p>`
    : ''
  return {
    subject: `Welcome to Podlens, ${firstName}`,
    html: baseTemplate(`
      <h1 class="h1">You're in, ${firstName} 👋</h1>
      <p>Welcome to Podlens — your podcast bias intelligence layer.</p>
      <p>Here's what you can do right now:</p>
      <ul style="padding-left:18px;font-size:14px;color:#444;line-height:1.8">
        <li>Paste any YouTube, Spotify, or podcast URL to analyze it</li>
        <li>Connect Spotify or YouTube to build your bias fingerprint</li>
        <li>Follow shows to get weekly bias insights</li>
      </ul>
      ${trialNote}
      <a class="btn" href="https://podlens.app">Start analyzing →</a>
      <p class="muted">Questions? Just reply to this email — we read everything.</p>
    `)
  }
}

export function adminLoginAlertEmail(opts: {
  email: string
  ip?: string
  userAgent?: string
  time: string
}): { subject: string; html: string } {
  return {
    subject: 'Admin login detected — Podlens',
    html: baseTemplate(`
      <div class="danger">⚠ Admin login detected</div>
      <h1 class="h1">Super admin access</h1>
      <p>An admin session was started for <strong>${opts.email}</strong>.</p>
      <table style="font-size:13px;color:#444;border-collapse:collapse;width:100%">
        <tr><td style="padding:4px 0;color:#888">Time</td><td style="padding:4px 8px">${opts.time}</td></tr>
        <tr><td style="padding:4px 0;color:#888">IP</td><td style="padding:4px 8px">${opts.ip || 'unknown'}</td></tr>
        <tr><td style="padding:4px 0;color:#888">Browser</td><td style="padding:4px 8px;font-size:12px">${(opts.userAgent || 'unknown').slice(0, 80)}</td></tr>
      </table>
      <p style="margin-top:14px">If this wasn't you, <a href="mailto:hello@podlens.app" style="color:#0f2027">contact us immediately</a>.</p>
    `)
  }
}

export function accountDeletedEmail(opts: {
  name: string
  email: string
}): { subject: string; html: string } {
  const firstName = opts.name?.split(' ')[0] || 'there'
  return {
    subject: 'Your Podlens account has been deleted',
    html: baseTemplate(`
      <h1 class="h1">Account deleted</h1>
      <p>Hi ${firstName},</p>
      <p>Your Podlens account has been permanently deleted as requested. All your data — analysis history, fingerprint, followed shows, and preferences — has been removed.</p>
      <p>If you had an active subscription, it has been canceled and you won't be charged again.</p>
      <p>We're sorry to see you go. If you change your mind, you're always welcome back at <a href="https://podlens.app" style="color:#0f2027">podlens.app</a>.</p>
      <p class="muted">This deletion is permanent and cannot be reversed. If you deleted by mistake, please <a href="mailto:hello@podlens.app">contact us within 24 hours</a> and we'll do our best to help.</p>
    `)
  }
}

export function showAlertEmail(opts: {
  name: string
  showName: string
  episodeTitle: string
  biasLabel: string
  analysisUrl: string
}): { subject: string; html: string } {
  const firstName = opts.name?.split(' ')[0] || 'there'
  return {
    subject: `New episode from ${opts.showName} — analyzed`,
    html: baseTemplate(`
      <h1 class="h1">New episode alert</h1>
      <p>Hi ${firstName}, a new episode of <strong>${opts.showName}</strong> you follow has been analyzed.</p>
      <div style="background:#f4f3ef;border-radius:6px;padding:14px 16px;margin:14px 0">
        <div style="font-size:12px;color:#888;margin-bottom:4px">${opts.showName}</div>
        <div style="font-size:15px;font-weight:600;color:#0f2027;margin-bottom:8px">${opts.episodeTitle}</div>
        <span class="pill">${opts.biasLabel}</span>
      </div>
      <a class="btn" href="${opts.analysisUrl}">See full analysis →</a>
      <p class="muted">You're receiving this because you follow ${opts.showName} on Podlens. <a href="https://podlens.app/settings">Manage alerts</a>.</p>
    `)
  }
}

export function dataExportReadyEmail(opts: {
  name: string
  downloadUrl: string
  expiresAt: string
}): { subject: string; html: string } {
  const firstName = opts.name?.split(' ')[0] || 'there'
  return {
    subject: 'Your Podlens data export is ready',
    html: baseTemplate(`
      <h1 class="h1">Your data export is ready</h1>
      <p>Hi ${firstName},</p>
      <p>Your Podlens data export has been generated and is ready to download. It includes your analysis history, bias fingerprint, followed shows, and account settings.</p>
      <a class="btn" href="${opts.downloadUrl}">Download your data →</a>
      <p class="muted">This link expires on ${new Date(opts.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. Download it before then.</p>
    `)
  }
}

export function pilotExpiredEmail(opts: {
  name: string
  plan?: string
}): { subject: string; html: string } {
  const firstName = opts.name?.split(' ')[0] || 'there'
  return {
    subject: 'Your Podlens pilot access has ended',
    html: baseTemplate(`
      <h1 class="h1">Your pilot access has ended</h1>
      <p>Hi ${firstName},</p>
      <p>Your Podlens pilot membership has ended. Your profile, analysis history, and fingerprint remain intact — you now have free tier access.</p>
      <p>To continue with full access, choose a plan that fits how you listen:</p>
      <a class="btn" href="https://podlens.app/pricing">See plans →</a>
      <p class="muted">Thanks for being an early supporter of Podlens. Your feedback shaped the product.</p>
    `)
  }
}

// ── Send helper ──────────────────────────────────────────────────────────────

export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
}): Promise<boolean> {
  const resend = getResend()
  if (!resend) { console.warn('[email] RESEND_API_KEY not set'); return false }
  try {
    await resend.emails.send({ from: FROM, to: opts.to, subject: opts.subject, html: opts.html })
    return true
  } catch (e: any) {
    console.error('[email] Send failed:', e?.message)
    return false
  }
}
