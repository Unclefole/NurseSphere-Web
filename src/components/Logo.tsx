interface LogoProps {
  className?: string
  variant?: 'dark' | 'light'
  height?: number
}

export function Logo({ className = '', variant = 'dark', height = 40 }: LogoProps) {
  const nurseColor = variant === 'dark' ? '#ffffff' : '#0f2d3d'
  const teal = '#2DD4BF'
  const heartStroke = variant === 'dark' ? '#2DD4BF' : '#0d9488'

  return (
    <svg
      width={height * 4}
      height={height}
      viewBox="0 0 200 50"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="NurseSphere"
      className={className}
    >
      {/* Heart outline */}
      <path
        d="M12 21.35L10.55 20.03C5.4 15.36 2 12.28 2 8.5C2 5.42 4.42 3 7.5 3C9.24 3 10.91 3.81 12 5.09C13.09 3.81 14.76 3 16.5 3C19.58 3 22 5.42 22 8.5C22 12.28 18.6 15.36 13.45 20.04L12 21.35Z"
        stroke={heartStroke}
        strokeWidth="1.5"
        fill="none"
      />

      {/* Medical cross inside heart */}
      <rect x="11" y="7" width="2" height="8" rx="1" fill={teal} />
      <rect x="8" y="10" width="8" height="2" rx="1" fill={teal} />

      {/* Wordmark */}
      <text
        x="32"
        y="32"
        fontFamily="Inter, sans-serif"
        fontWeight="700"
        fontSize="24"
        fill={nurseColor}
      >
        Nurse<tspan fill={teal}>Sphere</tspan>
      </text>
    </svg>
  )
}
