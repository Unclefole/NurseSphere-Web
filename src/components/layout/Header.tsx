'use client'

import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { User, LogOut, Settings } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

export function Header() {
  const { user, signOut, isHospital } = useAuth()
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <header className="sticky top-0 z-50 w-full border-b border-ns-dark-700 bg-ns-dark-900/95 backdrop-blur supports-[backdrop-filter]:bg-ns-dark-900/80">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <span className="font-display text-xl font-bold text-white">
              NurseSphere<span className="text-ns-teal">.io</span>
            </span>
          </Link>

          {/* Right side */}
          <div className="flex items-center gap-4">
            {user ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="flex items-center gap-2 rounded-full border border-ns-dark-600 bg-ns-dark-800 px-3 py-1.5 text-sm text-white transition-colors hover:border-ns-teal/50"
                >
                  <User className="h-4 w-4 text-ns-teal" />
                  <span className="hidden sm:inline">
                    {user.profile?.full_name || user.email}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-ns-teal/20 px-2 py-0.5 text-xs text-ns-teal">
                    {isHospital ? 'Hospital' : 'Nurse'}
                  </span>
                </button>

                {showDropdown && (
                  <div className="absolute right-0 mt-2 w-56 rounded-lg border border-ns-dark-600 bg-ns-dark-800 py-1 shadow-xl animate-fade-in">
                    <div className="border-b border-ns-dark-600 px-4 py-2">
                      <p className="text-sm font-medium text-white">
                        {user.profile?.full_name || 'User'}
                      </p>
                      <p className="text-xs text-gray-400">{user.email}</p>
                    </div>
                    <Link
                      href="/settings"
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-ns-dark-700 hover:text-white"
                      onClick={() => setShowDropdown(false)}
                    >
                      <Settings className="h-4 w-4" />
                      Settings
                    </Link>
                    <button
                      onClick={() => {
                        signOut()
                        setShowDropdown(false)
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-ns-dark-700 hover:text-white"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href="/auth/signin"
                className="flex items-center gap-2 rounded-full border border-ns-dark-600 bg-ns-dark-800 px-4 py-2 text-sm text-white transition-colors hover:border-ns-teal/50"
              >
                <User className="h-4 w-4" />
                Sign up
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

