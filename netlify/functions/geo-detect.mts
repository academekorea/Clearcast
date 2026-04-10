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
    })
  } catch {
    return Response.json({
      country: '',
    })
  }
}
