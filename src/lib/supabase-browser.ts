import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

// Browser-specific Supabase client for Next.js App Router
export function createBrowserSupabaseClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

