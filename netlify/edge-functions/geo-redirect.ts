import type { Config, Context } from
  '@netlify/edge-functions'

export default async (
  req: Request,
  context: Context
): Promise<Response> => {
  try {
    const url = new URL(req.url)
    const path = url.pathname

    // --- STEP 1: SKIP NON-PAGE REQUESTS ---
    // Never run geo logic on assets or API calls
    if (
      path.startsWith('/api/') ||
      path.startsWith('/.netlify/') ||
      path.startsWith('/kr') ||
      path.startsWith('/images/') ||
      path.startsWith('/icons/') ||
      path.startsWith('/fonts/') ||
      path === '/robots.txt' ||
      path === '/sitemap.xml' ||
      path === '/manifest.json' ||
      path === '/sw.js' ||
      path === '/favicon.ico' ||
      /\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|
         woff|woff2|ttf|otf|eot|map|json|xml|txt|
         mp3|mp4|pdf|zip)$/i.test(path)
    ) {
      return context.next()
    }

    // --- STEP 2: READ SAVED REGION PREFERENCE ---
    // If user has explicitly chosen a region
    // respect it and never override
    let savedRegion = ''
    try {
      const cookieHeader =
        req.headers.get('cookie') ?? ''
      for (const part of cookieHeader.split(';')) {
        const trimmed = part.trim()
        if (trimmed.startsWith('podlens-region=')) {
          savedRegion = trimmed.slice(15).trim()
          break
        }
      }
    } catch {
      // Cookie unavailable — continue
    }

    // User explicitly chose international
    // Never redirect them
    if (savedRegion === 'international') {
      return context.next()
    }

    // User explicitly chose Korean
    // Always redirect to /kr
    if (savedRegion === 'ko-KR') {
      const dest = `${url.origin}/kr${path}${
        url.search
      }`
      return new Response(null, {
        status: 302,
        headers: { Location: dest }
      })
    }

    // --- STEP 3: GEO DETECTION ---
    // Netlify provides country code via context.geo
    // This is populated at the CDN edge
    let countryCode = ''
    try {
      // context.geo is Netlify's built-in
      // geo-IP detection — very reliable
      // but must be accessed safely
      const geo = context.geo
      if (geo && typeof geo === 'object') {
        const country = (geo as Record<string, unknown>).country
        if (country && typeof country === 'object') {
          const code = (country as Record<string, unknown>).code
          if (typeof code === 'string') {
            countryCode = code.toLowerCase()
          }
        }
      }
    } catch {
      // Geo unavailable on this request
      // (happens in local dev, some edge cases)
      // Continue without redirecting
    }

    // --- STEP 4: REDIRECT KOREAN USERS ---
    if (countryCode === 'kr') {
      const dest = `${url.origin}/kr${path}${
        url.search
      }`

      // Set cookie so we remember this preference
      // and don't redirect again on every page
      const headers = new Headers()
      headers.set('Location', dest)
      headers.set(
        'Set-Cookie',
        'podlens-region=ko-KR; Path=/; ' +
        'Max-Age=2592000; SameSite=Lax; Secure'
      )

      return new Response(null, {
        status: 302,
        headers
      })
    }

    // --- STEP 5: ALL OTHER USERS ---
    // Serve normally — no redirect
    return context.next()

  } catch (err) {
    // ABSOLUTE SAFETY NET
    // If anything above throws for any reason
    // log it and serve the page normally
    // Users must NEVER see a crash page
    console.error(
      '[geo-redirect] Unhandled error:',
      err instanceof Error ? err.message : err
    )
    return context.next()
  }
}

export const config: Config = {
  // Run on all page routes
  path: '/*',
  // Never run on these paths
  excludedPath: [
    '/api/*',
    '/.netlify/*',
    '/kr/*',
    '/robots.txt',
    '/sitemap.xml',
    '/sitemap-kr.xml',
    '/manifest.json',
    '/sw.js',
    '/favicon.ico',
    '/og-image.png',
    '/og-kr.png'
  ],
  // CRITICAL: if function errors for any reason
  // continue serving the page — never show crash
  onError: 'continue'
}
