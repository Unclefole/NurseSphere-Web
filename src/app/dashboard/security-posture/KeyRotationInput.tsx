'use client'

/**
 * KeyRotationInput — Client Component
 *
 * Manual key rotation date tracker.
 * Stored in browser localStorage only (not server-persisted).
 * Disclaimer displayed inline.
 */

import { useState, useEffect } from 'react'

export function KeyRotationInput() {
  const [value, setValue] = useState('')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const stored = localStorage.getItem('nursesphere_last_key_rotation') ?? ''
    setValue(stored)
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setValue(e.target.value)
    localStorage.setItem('nursesphere_last_key_rotation', e.target.value)
  }

  if (!mounted) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-yellow-700 italic">Loading...</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <label htmlFor="key-rotation" className="text-sm font-medium text-yellow-800 whitespace-nowrap">
        Last rotation date:
      </label>
      <input
        id="key-rotation"
        type="date"
        value={value}
        onChange={handleChange}
        className="border border-yellow-300 rounded px-2 py-1 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
      />
      <span className="text-xs text-yellow-600">(saved in browser localStorage)</span>
    </div>
  )
}
