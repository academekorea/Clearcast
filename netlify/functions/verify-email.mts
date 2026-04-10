import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";

  if (!token) {
    return Response.redirect("/?verify_error=missing_token", 302);
  }

  const store = getStore("podlens-auth");
  const userStore = getStore("podlens-users");

  let tokenData: any;
  try { tokenData = await store.get(`verify-${token}`, { type: "json" }); } catch {}

  if (!tokenData) {
    return Response.redirect("/?verify_error=invalid", 302);
  }
  if (tokenData.used) {
    return Response.redirect("/?verify_error=used", 302);
  }
  if (new Date(tokenData.expiresAt).getTime() < Date.now()) {
    return Response.redirect("/?verify_error=expired", 302);
  }

  // Mark token as used
  await store.setJSON(`verify-${token}`, { ...tokenData, used: true, verifiedAt: new Date().toISOString() });

  // Mark user as verified in Blobs (if userId stored with token)
  if (tokenData.userId) {
    try {
      const userData = await userStore.get(`user-${tokenData.userId}`, { type: "json" }) as any;
      if (userData) {
        await userStore.setJSON(`user-${tokenData.userId}`, { ...userData, emailVerified: true, emailVerifiedAt: new Date().toISOString() });
      }
    } catch {}
  }

  // Redirect to app with success flag so JS can update local user object
  return Response.redirect(`/?verify_success=1&email=${encodeURIComponent(tokenData.email)}`, 302);
};

export const config: Config = { path: "/api/verify-email" };
