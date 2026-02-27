'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useAuth } from '@/contexts/AuthContext'
import {
  User,
  LogOut,
  Settings,
  LayoutDashboard,
  Shield,
  FileText,
  CreditCard,
  ClipboardList,
  ShieldCheck,
  ChevronDown,
} from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { NotificationBell } from '@/components/notifications/NotificationBell'

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
          <Link href="/" className="flex items-center">
            <Image
              src="/logo.jpg"
              alt="NurseSphere"
              width={140}
              height={50}
              className="h-10 w-auto object-contain"
              priority
            />
          </Link>

          {/* Right side */}
          <div className="flex items-center gap-4">
            {/* Notification bell — only shown when logged in */}
            {user && <NotificationBell />}

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
                  <div className="absolute right-0 mt-2 w-64 rounded-lg border border-ns-dark-600 bg-ns-dark-800 py-1 shadow-xl animate-fade-in">
                    <div className="border-b border-ns-dark-600 px-4 py-2">
                      <p className="text-sm font-medium text-white">
                        {user.profile?.full_name || 'User'}
                      </p>
                      <p className="text-xs text-gray-400">{user.email}</p>
                    </div>

                    {/* Dashboard Link */}
                    <Link
                      href="/dashboard"
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-ns-dark-700 hover:text-white"
                      onClick={() => setShowDropdown(false)}
                    >
                      <LayoutDashboard className="h-4 w-4" />
                      Dashboard
                    </Link>

                    {/* Hospital Admin Nav */}
                    {isHospital && (
                      <>
                        <div className="px-4 pt-2 pb-1">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Management
                          </p>
                        </div>
                        <Link
                          href="/billing"
                          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-ns-dark-700 hover:text-white"
                          onClick={() => setShowDropdown(false)}
                        >
                          <CreditCard className="h-4 w-4" />
                          Billing
                        </Link>
                        <Link
                          href="/contracts"
                          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-ns-dark-700 hover:text-white"
                          onClick={() => setShowDropdown(false)}
                        >
                          <FileText className="h-4 w-4" />
                          Invoices &amp; Contracts
                        </Link>
                        <div className="px-4 pt-2 pb-1">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Compliance
                          </p>
                        </div>
                        <Link
                          href="/dashboard/credentials"
                          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-ns-dark-700 hover:text-white"
                          onClick={() => setShowDropdown(false)}
                        >
                          <Shield className="h-4 w-4" />
                          Credentials
                        </Link>
                        <Link
                          href="/dashboard/audit-log"
                          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-ns-dark-700 hover:text-white"
                          onClick={() => setShowDropdown(false)}
                        >
                          <ClipboardList className="h-4 w-4" />
                          Audit Log
                        </Link>
                        <Link
                          href="/dashboard/security"
                          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-ns-dark-700 hover:text-white"
                          onClick={() => setShowDropdown(false)}
                        >
                          <ShieldCheck className="h-4 w-4" />
                          Security
                        </Link>
                      </>
                    )}

                    <div className="border-t border-ns-dark-600 mt-1">
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

