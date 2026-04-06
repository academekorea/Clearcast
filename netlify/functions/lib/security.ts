// Shared security utilities — server-side only, never import from client code

import { getStore } from "@netlify/blobs";

// ── HASHING ───────────────────────────────────────────────────────────────────

export async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashIp(ip: string): Promise<string> {
  return sha256hex("ip:" + ip);
}

// ── OTP ───────────────────────────────────────────────────────────────────────

/** Generate cryptographically secure 6-digit OTP */
export function generateOTP(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1_000_000).padStart(6, "0");
}

/** Hash OTP with JWT_SECRET for safe storage */
export async function hashOTP(otp: string): Promise<string> {
  const secret = Netlify.env.get("JWT_SECRET") || "podlens-otp-salt";
  return sha256hex(otp + ":" + secret);
}

/** Verify entered OTP against stored hash */
export async function verifyOTPHash(
  entered: string,
  storedHash: string
): Promise<boolean> {
  const hash = await hashOTP(entered);
  return hash === storedHash;
}

// ── RATE LIMITING ─────────────────────────────────────────────────────────────

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number; // seconds
}

/**
 * Check and increment rate limit counter for a given key.
 * Uses Netlify Blobs with TTL for automatic expiry.
 */
export async function checkRateLimit(
  identifier: string, // IP hash or userId
  endpoint: string,
  maxRequests: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const key = `rate-${endpoint}-${identifier}`;
  const store = getStore("podlens-security");

  try {
    const existing = (await store.get(key, { type: "json" })) as any;
    const now = Date.now();
    const windowMs = windowSeconds * 1000;

    if (existing) {
      const elapsed = now - existing.windowStart;
      if (elapsed < windowMs) {
        const count = (existing.count || 0) + 1;
        if (count > maxRequests) {
          return {
            allowed: false,
            remaining: 0,
            resetIn: Math.ceil((windowMs - elapsed) / 1000),
          };
        }
        await store.setJSON(
          key,
          { count, windowStart: existing.windowStart },
          { ttl: windowSeconds }
        );
        return { allowed: true, remaining: maxRequests - count, resetIn: 0 };
      }
    }

    // New window
    await store.setJSON(
      key,
      { count: 1, windowStart: now },
      { ttl: windowSeconds }
    );
    return { allowed: true, remaining: maxRequests - 1, resetIn: 0 };
  } catch {
    // On Blobs error, allow the request (fail open, not fail closed)
    return { allowed: true, remaining: maxRequests, resetIn: 0 };
  }
}

export function rateLimitResponse(resetIn: number): Response {
  return new Response(
    JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(resetIn || 60),
      },
    }
  );
}

// ── AUTH LOCKOUT ──────────────────────────────────────────────────────────────

const LOCKOUT_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

interface LockoutRecord {
  attempts: number;
  lockedUntil: number | null;
  lastAttempt: number;
}

export async function checkAuthLockout(ip: string): Promise<boolean> {
  const store = getStore("podlens-security");
  const key = `lockout-${await hashIp(ip)}`;
  try {
    const record = (await store.get(key, { type: "json" })) as LockoutRecord | null;
    if (!record) return false;
    if (record.lockedUntil && record.lockedUntil > Date.now()) return true;
    return false;
  } catch {
    return false;
  }
}

export async function recordAuthFailure(ip: string): Promise<void> {
  const store = getStore("podlens-security");
  const key = `lockout-${await hashIp(ip)}`;
  try {
    const existing = (await store.get(key, { type: "json" })) as LockoutRecord | null;
    const attempts = (existing?.attempts || 0) + 1;
    const lockedUntil =
      attempts >= LOCKOUT_ATTEMPTS
        ? Date.now() + LOCKOUT_MINUTES * 60 * 1000
        : null;
    await store.setJSON(
      key,
      { attempts, lockedUntil, lastAttempt: Date.now() },
      { ttl: LOCKOUT_MINUTES * 60 * 2 } // TTL = 2× lockout window
    );
  } catch {}
}

export async function clearAuthLockout(ip: string): Promise<void> {
  const store = getStore("podlens-security");
  const key = `lockout-${await hashIp(ip)}`;
  try {
    await store.delete(key);
  } catch {}
}

// ── INPUT SANITIZATION ────────────────────────────────────────────────────────

export function sanitizeUrl(url: string): string {
  const trimmed = url.trim().slice(0, 2048);
  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Invalid protocol");
    }
    return parsed.toString();
  } catch {
    throw new Error("Invalid URL");
  }
}

export function sanitizeText(text: string, maxLen = 10_000): string {
  return String(text)
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .slice(0, maxLen);
}

export function sanitizeEmail(email: string): string {
  const e = String(email).toLowerCase().trim().slice(0, 320);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    throw new Error("Invalid email");
  }
  return e;
}

// ── SUSPICIOUS ACTIVITY ───────────────────────────────────────────────────────

export async function checkSuspiciousActivity(
  userId: string,
  email: string,
  recentAnalysisCount: number
): Promise<void> {
  const threshold = parseInt(
    Netlify.env.get("SUSPICIOUS_ANALYSIS_THRESHOLD") || "20",
    10
  );
  if (recentAnalysisCount < threshold) return;

  // Log to Supabase events (fire-and-forget)
  try {
    const sbUrl = Netlify.env.get("SUPABASE_URL");
    const sbKey = Netlify.env.get("SUPABASE_SERVICE_KEY");
    if (sbUrl && sbKey) {
      await fetch(`${sbUrl}/rest/v1/events`, {
        method: "POST",
        headers: {
          apikey: sbKey,
          Authorization: `Bearer ${sbKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          user_id: userId,
          event_type: "suspicious_activity",
          properties: {
            type: "high_analysis_rate",
            count: recentAnalysisCount,
            threshold,
          },
          created_at: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5000),
      });
    }
  } catch {}

  // Alert admin via Resend
  try {
    const resendKey = Netlify.env.get("RESEND_API_KEY");
    const adminEmail = Netlify.env.get("SUPER_ADMIN_EMAIL");
    const fromEmail = Netlify.env.get("FROM_EMAIL") || "hello@podlens.app";
    if (resendKey && adminEmail) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: adminEmail,
          subject: "⚠️ Suspicious activity — PODLENS",
          html: `<p>User <strong>${sanitizeText(email)}</strong> (${userId}) ran <strong>${recentAnalysisCount}</strong> analyses in the last hour (threshold: ${threshold}).</p>`,
        }),
        signal: AbortSignal.timeout(5000),
      });
    }
  } catch {}
}

// ── ADMIN TOKEN ───────────────────────────────────────────────────────────────

/**
 * Generate a short-lived admin token tied to (userId + date).
 * Rotates every 24 hours so old stolen tokens become invalid.
 */
export async function generateAdminToken(userId: string): Promise<string> {
  const secret = Netlify.env.get("JWT_SECRET") || "";
  const adminEmail = Netlify.env.get("SUPER_ADMIN_EMAIL") || "";
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return sha256hex(`admin:${userId}:${adminEmail}:${day}:${secret}`);
}

/** Verify that the admin token is valid for the given userId */
export async function verifyAdminToken(
  userId: string,
  token: string
): Promise<boolean> {
  if (!userId || !token) return false;
  const expected = await generateAdminToken(userId);
  return expected === token;
}

/** Extract client IP from Netlify request headers */
export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-nf-client-connection-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}
