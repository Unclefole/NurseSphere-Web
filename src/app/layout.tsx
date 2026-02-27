import type { Metadata } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import { AuthProvider } from '@/contexts/AuthContext'
import SessionTimeoutWarning from '@/components/SessionTimeoutWarning'
import { ErrorBoundary } from '@/components/error-boundary'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'NurseSphere | Healthcare Staffing Platform',
  description: 'The unified platform for healthcare staffing and shift management',
  keywords: ['healthcare', 'staffing', 'nursing', 'hospital', 'shift management'],
  authors: [{ name: 'NurseSphere' }],
  openGraph: {
    title: 'NurseSphere',
    description: 'The unified platform for healthcare staffing and shift management',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="font-sans antialiased bg-ns-dark-950 text-white">
        <ErrorBoundary>
          <AuthProvider>
            {children}
            <SessionTimeoutWarning />
          </AuthProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}

