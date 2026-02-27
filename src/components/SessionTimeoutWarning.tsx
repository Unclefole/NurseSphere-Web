'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useEffect, useState } from 'react'

export default function SessionTimeoutWarning() {
  const { showTimeoutWarning, extendSession, signOut, timeoutCountdown } = useAuth()
  
  if (!showTimeoutWarning) return null

  const minutes = Math.floor(timeoutCountdown / 60)
  const seconds = timeoutCountdown % 60

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-mx-4">
        <div className="flex items-center justify-center mb-4">
          <div className="bg-yellow-100 rounded-full p-2">
            <svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.728-.833-2.498 0L4.316 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
        </div>
        
        <h3 className="text-lg font-semibold text-gray-900 text-center mb-2">
          Session Timeout Warning
        </h3>
        
        <p className="text-sm text-gray-600 text-center mb-4">
          Your session will expire due to inactivity in:
        </p>
        
        <div className="text-center mb-6">
          <div className="text-2xl font-bold text-red-600">
            {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            HIPAA security requirement: 15-minute inactivity timeout
          </div>
        </div>
        
        <div className="flex space-x-3">
          <button
            onClick={extendSession}
            className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 font-medium"
          >
            Continue Session
          </button>
          <button
            onClick={signOut}
            className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 font-medium"
          >
            Sign Out
          </button>
        </div>
        
        <p className="text-xs text-gray-500 text-center mt-3">
          This automatic logout protects sensitive health information when systems are left unattended.
        </p>
      </div>
    </div>
  )
}