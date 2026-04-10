import type { Config, Context } from '@netlify/functions'

export const config: Config = {
  path: '/api/geo-detect'
}

export default async (
  req: Request,
  context: Context
) => {
  try {
    const country =
      context.geo?.country?.code?.toLowerCase() || ''

    return Response.json({
      country,
      // isKorean: Phase 2 — Korean market deferred until English product is complete
      isKorean: false,
    })
  } catch {
    return Response.json({
      country: '',
      isKorean: false,
    })
  }
}
