// Super admin detection — runs server-side only, never expose to client
// SUPER_ADMIN_EMAIL env var: academekorea@gmail.com

export function getSuperAdminEmail(): string {
  return (Netlify.env.get('SUPER_ADMIN_EMAIL') || 'academekorea@gmail.com').toLowerCase().trim()
}

export function isSuperAdmin(email: string | null | undefined): boolean {
  if (!email) return false
  return email.toLowerCase().trim() === getSuperAdminEmail()
}

// Apply super admin overrides to any user data object (mutates in place)
export function applySuperAdminOverrides(userData: Record<string, unknown>, email: string): void {
  if (!isSuperAdmin(email)) return
  userData.plan = 'studio'
  userData.is_super_admin = true
  userData.bypass_limits = true
  userData.isSuperAdmin = true  // client-side key
}

// Super admin Supabase fields to upsert
export function superAdminSupabaseFields() {
  return {
    tier: 'studio',
    is_super_admin: true,
    bypass_limits: true,
  }
}
