import { createClient } from '@supabase/supabase-js'

// Server-side admin client — full access, never expose to browser
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// Public client — safe for limited read-only operations
export const supabasePublic = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)
