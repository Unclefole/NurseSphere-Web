import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Enterprise landing colors (Stitch design)
        'nurse-dark': '#0a191f',
        'nurse-navy': '#0f272e',
        'nurse-teal': '#14b8a6',
        'nurse-border': 'rgba(20, 184, 166, 0.2)',
        // NurseSphere brand colors from the design
        'ns-dark': {
          950: '#0a0e14',
          900: '#0d1117',
          800: '#141a22',
          700: '#1c242e',
          600: '#252f3b',
        },
        'ns-teal': {
          DEFAULT: '#0d9488',
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
        },
        'ns-cyan': {
          DEFAULT: '#06b6d4',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        display: ['var(--font-space-grotesk)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-playfair)', 'Georgia', 'serif'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'ns-gradient': 'linear-gradient(135deg, #0d9488 0%, #06b6d4 100%)',
      },
    },
  },
  plugins: [],
}

export default config

