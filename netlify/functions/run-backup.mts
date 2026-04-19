import type { Config } from "@netlify/functions";
import { isSuperAdmin } from "./lib/admin.js";
import { runBackup } from "./lib/backup.js";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Auth: super admin only
  const url = new URL(req.url);
  const email = url.searchParams.get("email")
    || req.headers.get("x-admin-email") || "";

  if (!isSuperAdmin(email)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await runBackup();

  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/run-backup",
};
