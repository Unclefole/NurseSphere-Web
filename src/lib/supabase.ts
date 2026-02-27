import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

function getRequiredEnvVar(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
      `Set it in .env.local before running the app.`
    )
  }
  return value
}

// Client-side Supabase client
// Uses the same project as the mobile app - NO separate database
export const supabase: SupabaseClient = createClient(
  getRequiredEnvVar('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl),
  getRequiredEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY', supabaseAnonKey),
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  }
)

// For server components (if needed)
export function createServerClient(): SupabaseClient {
  return createClient(
    getRequiredEnvVar('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl),
    getRequiredEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY', supabaseAnonKey),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
