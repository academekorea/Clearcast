import type { Config, Context } from
  '@netlify/edge-functions'

export default async (
  req: Request,
  context: Context
): Promise<Response> => {
  try {
    const url = new URL(req.url)
    const path = url.pathname

    // Skip non-HTML requests immediately
    if (
      path.startsWith('/api/') ||
      path.startsWith('/.netlify/') ||
      path.startsWith('/kr') ||
      /\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|woff|woff2|ttf|map|json|xml|txt|mp3|mp4|pdf|zip|html)$/i.test(path)
    ) {
      return context.next()
    }

    // Read saved region preference from cookie
    let savedRegion = ''
    try {
      const cookies =
        req.headers.get('cookie') ?? ''
      for (const part of cookies.split(';')) {
        const t = part.trim()
        if (t.startsWith('podlens-region=')) {
          savedRegion = t.slice(15).trim()
          break
        }
      }
    } catch { /* ignore */ }

    // User explicitly chose international
    // Serve page without Korean signals
    if (savedRegion === 'international') {
      const res = await context.next()
      return removeKoreanSignals(res)
    }

    // User explicitly chose Korean
    // Redirect to /kr
    if (savedRegion === 'ko-KR') {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${url.origin}/kr${path}${url.search}`
        }
      })
    }

    // Detect country from Netlify geo
    let country = ''
    try {
      const geo = context.geo
      if (geo && typeof geo === 'object') {
        const c = (
          geo as Record<string, unknown>
        ).country
        if (c && typeof c === 'object') {
          const code = (
            c as Record<string, unknown>
          ).code
          if (typeof code === 'string') {
            country = code.toLowerCase()
          }
        }
      }
    } catch { /* geo unavailable */ }

    // Korean user → redirect to /kr
    if (country === 'kr') {
      const headers = new Headers()
      headers.set('Location',
        `${url.origin}/kr${path}${url.search}`)
      headers.set('Set-Cookie',
        'podlens-region=ko-KR; Path=/; ' +
        'Max-Age=2592000; SameSite=Lax; Secure')
      return new Response(null,
        { status: 302, headers })
    }

    // Non-Korean user → serve page
    // but strip Korean SEO signals from HTML
    const res = await context.next()
    return removeKoreanSignals(res)

  } catch (err) {
    console.error('[geo-redirect]', err)
    return context.next()
  }
}

// Remove Korean hreflang + nav switcher
// from HTML responses served to non-Korean users
async function removeKoreanSignals(
  res: Response
): Promise<Response> {
  try {
    // Only process HTML responses
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('text/html')) {
      return res
    }

    let html = await res.text()

    // Remove Korean hreflang tags
    html = html.replace(
      /<link[^>]*hreflang="ko"[^>]*>/gi,
      ''
    )
    html = html.replace(
      /<link[^>]*hreflang="ko-KR"[^>]*>/gi,
      ''
    )

    // Remove the /kr alternate link tag
    html = html.replace(
      /<link[^>]*href="https:\/\/podlens\.app\/kr[^"]*"[^>]*>/gi,
      ''
    )

    // Hide the Korean language switcher in nav
    html = html.replace(
      /<[^>]*id="lang-switch-wrap"[^>]*>[\s\S]*?<\/[^>]+>/gi,
      '<div id="lang-switch-wrap"></div>'
    )

    // Inline style fallback
    html = html.replace(
      /(<[^>]*(?:id="lang-switch-wrap"|class="[^"]*lang-switch[^"]*")[^>]*)(>)/gi,
      '$1 style="display:none!important"$2'
    )

    return new Response(html, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers
    })

  } catch {
    // If HTML processing fails just return original
    return res
  }
}

export const config: Config = {
  path: '/*',
  excludedPath: [
    '/api/*',
    '/.netlify/*',
    '/kr/*'
  ],
  onError: 'continue'
}
