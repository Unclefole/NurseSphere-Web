'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { withRoleGuard } from '@/lib/auth/role-guard'
import Link from 'next/link'

function AdminDashboard() {
  const { user } = useAuth()

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <h1 className="text-2xl font-semibold text-gray-900">
              Admin Dashboard
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              HIPAA compliance and system administration
            </p>
          </div>

          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              
              {/* Audit Logs */}
              <Link href="/admin/audit-logs" 
                    className="block p-6 bg-blue-50 rounded-lg border border-blue-200 hover:bg-blue-100 transition-colors">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-lg font-medium text-blue-900">Audit Logs</h3>
                    <p className="text-sm text-blue-700">View and export HIPAA audit trails</p>
                  </div>
                </div>
              </Link>

              {/* User Management */}
              <Link href="/admin/users" 
                    className="block p-6 bg-green-50 rounded-lg border border-green-200 hover:bg-green-100 transition-colors">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-2.197m3 2.197V9a3 3 0 00-6 0v12" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-lg font-medium text-green-900">User Management</h3>
                    <p className="text-sm text-green-700">Manage user access and permissions</p>
                  </div>
                </div>
              </Link>

              {/* Compliance Reports */}
              <Link href="/admin/compliance" 
                    className="block p-6 bg-purple-50 rounded-lg border border-purple-200 hover:bg-purple-100 transition-colors">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.031 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-lg font-medium text-purple-900">Compliance Reports</h3>
                    <p className="text-sm text-purple-700">Generate HIPAA compliance reports</p>
                  </div>
                </div>
              </Link>

              {/* Security Settings */}
              <Link href="/admin/security" 
                    className="block p-6 bg-red-50 rounded-lg border border-red-200 hover:bg-red-100 transition-colors">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-lg font-medium text-red-900">Security Settings</h3>
                    <p className="text-sm text-red-700">Configure security policies and controls</p>
                  </div>
                </div>
              </Link>

              {/* Data Retention */}
              <Link href="/admin/data-retention" 
                    className="block p-6 bg-yellow-50 rounded-lg border border-yellow-200 hover:bg-yellow-100 transition-colors">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2h4a1 1 0 110 2h-1v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6H3a1 1 0 010-2h4z" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-lg font-medium text-yellow-900">Data Retention</h3>
                    <p className="text-sm text-yellow-700">Manage data retention policies</p>
                  </div>
                </div>
              </Link>

              {/* Incident Response */}
              <Link href="/admin/incidents" 
                    className="block p-6 bg-orange-50 rounded-lg border border-orange-200 hover:bg-orange-100 transition-colors">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <svg className="h-6 w-6 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-lg font-medium text-orange-900">Incident Response</h3>
                    <p className="text-sm text-orange-700">Track and respond to security incidents</p>
                  </div>
                </div>
              </Link>

            </div>
            
            {/* Quick Stats */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <h2 className="text-lg font-medium text-gray-900 mb-4">System Status</h2>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Session Timeout</div>
                  <div className="text-lg font-semibold text-gray-900">15 minutes</div>
                  <div className="text-xs text-green-600">HIPAA Compliant</div>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Encryption Status</div>
                  <div className="text-lg font-semibold text-gray-900">Active</div>
                  <div className="text-xs text-green-600">In Transit & At Rest</div>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Audit Logging</div>
                  <div className="text-lg font-semibold text-gray-900">Enabled</div>
                  <div className="text-xs text-green-600">6 Year Retention</div>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Access Controls</div>
                  <div className="text-lg font-semibold text-gray-900">Active</div>
                  <div className="text-xs text-green-600">Role-Based</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default withRoleGuard(AdminDashboard, ['hospital_admin'])