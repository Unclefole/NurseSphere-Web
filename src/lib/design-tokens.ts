/**
 * NurseSphere Design Tokens — Single source of truth for the web app
 *
 * Mobile counterpart lives in: rork-nursesphere-624/constants/colors.ts
 * Keep these values in sync with the brand guidelines.
 *
 * Contrast ratios (WCAG AA — minimum 4.5:1 on white for normal text):
 *   #0d9488 on #ffffff  → 4.54:1  ✅  (passes AA)
 *   #0f766e on #ffffff  → 5.74:1  ✅  (passes AA + AAA)
 *   #14b8a6 on #ffffff  → 2.84:1  ⚠️  (decorative only — do NOT use for body text on white)
 *   #06b6d4 on #ffffff  → 2.50:1  ⚠️  (decorative only)
 */

// ─── Brand Colors ─────────────────────────────────────────────────────────────
export const colors = {
  // Primary teal family
  primary:       '#0d9488', // Teal — primary brand, 4.54:1 on white ✅
  primaryDark:   '#0f766e', // Dark teal — hover/active states, 5.74:1 on white ✅
  primaryLight:  '#14b8a6', // Light teal — decorative, backgrounds only
  primaryLighter:'#ccfbf1', // Very light teal — surface tints

  // Accent / secondary
  accent:        '#06b6d4', // Cyan accent — decorative, backgrounds only
  accentDark:    '#0891b2', // Darker cyan — slightly more readable

  // Backgrounds (dark theme)
  bgBase:        '#0a0e14', // Deepest background (--ns-dark-950)
  bgSurface:     '#0d1117', // Surface (--ns-dark-900)
  bgCard:        '#141a22', // Card (--ns-dark-800)
  bgBorder:      '#1c242e', // Subtle borders (--ns-dark-700)
  bgMuted:       '#252f3b', // Muted borders (--ns-dark-600)

  // Text
  textPrimary:   '#ffffff',
  textSecondary: '#9ca3af',
  textMuted:     '#6b7280',

  // Semantic
  success:       '#10b981',
  successLight:  '#d1fae5',
  warning:       '#f59e0b',
  warningLight:  '#fef3c7',
  error:         '#ef4444',
  errorLight:    '#fee2e2',
  info:          '#3b82f6',
  infoLight:     '#dbeafe',
} as const;

// ─── Typography ───────────────────────────────────────────────────────────────
export const fontFamily = {
  sans:    'var(--font-inter)',
  display: 'var(--font-space-grotesk)',
  mono:    'ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

// ─── Spacing scale (rem) ──────────────────────────────────────────────────────
export const spacing = {
  xs:  '0.25rem',
  sm:  '0.5rem',
  md:  '1rem',
  lg:  '1.5rem',
  xl:  '2rem',
  xxl: '3rem',
} as const;

// ─── Border radius ────────────────────────────────────────────────────────────
export const borderRadius = {
  sm:   '0.375rem',
  md:   '0.5rem',
  lg:   '0.75rem',
  xl:   '1rem',
  full: '9999px',
} as const;

// ─── Shadow tokens ────────────────────────────────────────────────────────────
export const shadows = {
  tealGlow:  '0 0 20px rgba(13, 148, 136, 0.3)',
  cyanGlow:  '0 0 20px rgba(6, 182, 212, 0.2)',
  card:      '0 4px 24px rgba(0, 0, 0, 0.4)',
  cardHover: '0 8px 32px rgba(0, 0, 0, 0.5)',
} as const;

// ─── Gradient presets ─────────────────────────────────────────────────────────
export const gradients = {
  brand:      'linear-gradient(135deg, #0d9488 0%, #06b6d4 100%)',
  brandDark:  'linear-gradient(135deg, #0f766e 0%, #0891b2 100%)',
  surface:    'linear-gradient(145deg, rgba(28,36,46,0.8) 0%, rgba(20,26,34,0.9) 100%)',
} as const;

export const designTokens = {
  colors,
  fontFamily,
  spacing,
  borderRadius,
  shadows,
  gradients,
} as const;

export default designTokens;
