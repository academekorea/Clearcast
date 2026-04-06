import type { Config, Context } from '@netlify/edge-functions'

export default async (
  req: Request,
  context: Context
) => {
  try {
    const url = new URL(req.url)
    const path = url.pathname

    // Skip immediately — assets and API
    if (
      path.startsWith('/api/') ||
      path.startsWith('/.netlify/') ||
      path.startsWith('/kr') ||
      path.match(/\.(png|jpg|jpeg|gif|svg|ico|css|js|woff|woff2|ttf|map|json|xml|txt|webp|mp3|mp4|pdf|html)$/i)
    ) {
      return context.next()
    }

    // Safe cookie read
    let cookieRegion = ''
    try {
      const cookies = req.headers.get('cookie') || ''
      cookieRegion = cookies
        .split(';')
        .find(c => c.trim().startsWith('podlens-region='))
        ?.split('=')?.[1]
        ?.trim() || ''
    } catch { /* ignore */ }

    // User chose international — never redirect
    if (cookieRegion === 'international') {
      return context.next()
    }

    // User is Korean — redirect to /kr
    if (cookieRegion === 'ko-KR') {
      return Response.redirect(
        new URL('/kr' + path + url.search, url.origin).href,
        302
      )
    }

    // Detect country from geo — safely
    let country = ''
    try {
      country = context?.geo?.country?.code?.toLowerCase() || ''
    } catch { /* geo unavailable */ }

    if (country === 'kr') {
      return Response.redirect(
        new URL('/kr' + path + url.search, url.origin).href,
        302
      )
    }

    return context.next()

  } catch {
    // NEVER crash — always serve the page
    return context.next()
  }
}

export const config: Config = {
  path: '/*',
  excludedPath: [
    '/api/*',
    '/.netlify/*',
    '/kr/*',
  ],
  onError: 'continue',
}
