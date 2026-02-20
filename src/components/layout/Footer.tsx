'use client'

import Link from 'next/link'
import { Apple } from 'lucide-react'

export function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="border-t border-ns-dark-700 bg-ns-dark-900">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <p className="text-sm text-gray-400">
            © Copyright NurseSphere.io
          </p>
          
          <div className="flex items-center gap-6">
            <Link
              href="/privacy"
              className="text-sm text-gray-400 transition-colors hover:text-white"
            >
              Privacy Policy
            </Link>
            <Link
              href="/terms"
              className="text-sm text-gray-400 transition-colors hover:text-white"
            >
              Terms of Service
            </Link>
          </div>
        </div>
      </div>

      {/* Floating Download Button */}
      <div className="fixed bottom-6 right-6 z-50">
        <a
          href="#download"
          className="flex items-center gap-2 rounded-lg bg-ns-teal px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-all hover:bg-ns-teal-600 hover:shadow-xl"
        >
          <Apple className="h-4 w-4" />
          Download Nurse App
        </a>
      </div>
    </footer>
  )
}

