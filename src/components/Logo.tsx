interface LogoProps {
  className?: string
  /** 'dark' = dark bg (Nurse text white). 'light' = light bg (Nurse text navy). */
  variant?: 'dark' | 'light'
  height?: number
}

export function Logo({ className = '', variant = 'dark', height = 40 }: LogoProps) {
  const nurseColor = variant === 'dark' ? '#ffffff' : '#0f2d3d'
  const teal = '#14b8a6'
  const navy = '#0f2d3d'

  return (
    <svg
      viewBox="0 0 255 68"
      height={height}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="NurseSphere"
      className={className}
    >
      {/* Left heart lobe arc */}
      <path
        d="M36,61 C36,61 5,47 5,26 C5,12 16,6 27,9 C32,11 35,15 36,20"
        fill="none" stroke={teal} strokeWidth="5"
        strokeLinecap="round" strokeLinejoin="round"
      />

      {/* Globe circle (right lobe of heart) */}
      <circle cx="50" cy="25" r="21" fill="none" stroke={teal} strokeWidth="5" />

      {/* Globe latitude line */}
      <ellipse cx="50" cy="25" rx="21" ry="8" fill="none" stroke={teal} strokeWidth="2.5" opacity="0.65" />

      {/* Globe meridian line */}
      <ellipse cx="50" cy="25" rx="10" ry="21" fill="none" stroke={teal} strokeWidth="2.5" opacity="0.65" />

      {/* Bottom connecting arc to heart point */}
      <path
        d="M29,46 C32,55 35,60 36,61"
        fill="none" stroke={teal} strokeWidth="5" strokeLinecap="round"
      />

      {/* Center teardrop shape in navy */}
      <path
        d="M36,12 C26,12 19,19 19,28 C19,43 33,55 36,61 C39,55 53,43 53,28 C53,19 46,12 36,12 Z"
        fill={navy}
      />

      {/* White medical cross */}
      <rect x="33" y="22" width="6" height="2.8" rx="1.4" fill="white" />
      <rect x="34.6" y="19.5" width="2.8" height="8" rx="1.4" fill="white" />

      {/* Wordmark */}
      <text x="82" y="43" fontFamily="Inter, system-ui, sans-serif" fontWeight="700" fontSize="26" letterSpacing="-0.3">
        <tspan fill={nurseColor}>Nurse</tspan><tspan fill={teal}>Sphere</tspan>
      </text>
    </svg>
  )
}
