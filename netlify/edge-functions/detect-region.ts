import type { Context } from "@netlify/edge-functions";

export default async (request: Request, context: Context) => {
  const response = await context.next();
  const country = context.geo?.country?.code || "INTL";
  const acceptLang = request.headers.get("accept-language") || "en";

  let region = "INTL", lang = "en", currency = "USD", store = "us";

  if (country === "KR" || acceptLang.toLowerCase().startsWith("ko")) {
    region = "KR"; lang = "ko"; currency = "KRW"; store = "kr";
  } else if (country === "GB" || country === "IE") {
    region = "GB"; lang = "en"; currency = "GBP"; store = "gb";
  } else if (["DE","AT","CH","FR","BE","NL","IT","ES",
              "PT","SE","NO","DK","FI"].includes(country)) {
    region = "EU"; lang = "en"; currency = "EUR"; store = "us";
  } else if (country === "AU" || country === "NZ") {
    region = "AU"; lang = "en"; currency = "AUD"; store = "au";
  } else if (country === "CA") {
    region = "CA"; lang = "en"; currency = "CAD"; store = "ca";
  }

  const newResponse = new Response(response.body, response);
  newResponse.headers.append(
    "Set-Cookie",
    `pl_region=${region}; pl_lang=${lang}; pl_currency=${currency}; ` +
    `pl_store=${store}; Path=/; SameSite=Lax; Max-Age=86400`
  );
  return newResponse;
};

export const config = { path: "/*" };
