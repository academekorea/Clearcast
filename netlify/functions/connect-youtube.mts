import type { Config } from "@netlify/functions";

// Initiates Google/YouTube OAuth — keeps GOOGLE_CLIENT_ID server-side
export default async (req: Request) => {
  const url = new URL(req.url);
  const userId = url.searchParams.get('userId') || '';

  const clientId = Netlify.env.get('GOOGLE_CLIENT_ID');
  if (!clientId) {
    return Response.redirect(
      'https://podlens.app/settings.html?youtube=error&msg=not_configured',
      302
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: 'https://podlens.app/auth/youtube/callback',
    response_type: 'code',
    scope: 'openid email profile https://www.googleapis.com/auth/youtube.readonly',
    state: userId,           // auth-youtube-callback.mts uses state as userId directly
    access_type: 'offline',
    prompt: 'consent',
  });

  return Response.redirect(
    'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString(),
    302
  );
};

export const config: Config = { path: '/api/connect-youtube' };
