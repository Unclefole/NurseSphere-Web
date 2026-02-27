/**
 * Tests for email template generators.
 * Pure function tests — no network, no DB.
 */

import {
  credentialExpiringEmail,
  welcomeNurseEmail,
  invoiceCreatedEmail,
  shiftFillAlertEmail,
  welcomeAdminEmail,
} from '@/lib/notifications/email'

// ─── credentialExpiringEmail ──────────────────────────────────────────────────

describe('credentialExpiringEmail', () => {
  test('contains credential type in subject and body', () => {
    const result = credentialExpiringEmail('Alice Smith', 'RN License', 14)

    expect(result.subject).toContain('RN License')
    expect(result.html).toContain('RN License')
    expect(result.text).toContain('RN License')
  })

  test('contains days until expiry in body', () => {
    const result = credentialExpiringEmail('Bob Jones', 'CPR Certification', 7)

    expect(result.subject).toContain('7')
    expect(result.html).toContain('7')
    expect(result.text).toContain('7')
  })

  test('contains nurse name in body', () => {
    const result = credentialExpiringEmail('Carol Williams', 'ACLS Certificate', 30)

    expect(result.html).toContain('Carol Williams')
    expect(result.text).toContain('Carol Williams')
  })

  test('subject contains URGENT prefix for 3 days or less', () => {
    const urgentResult = credentialExpiringEmail('Dave', 'BLS Certification', 3)
    expect(urgentResult.subject).toMatch(/URGENT/i)

    const notUrgentResult = credentialExpiringEmail('Dave', 'BLS Certification', 4)
    expect(notUrgentResult.subject).not.toMatch(/URGENT/i)
  })

  test('1 day → singular "day" (not "days")', () => {
    const result = credentialExpiringEmail('Eve', 'TB Test', 1)

    // Subject should use singular — "day" not followed by "s"
    expect(result.subject).toMatch(/1 day(?!s)/i)
  })

  test('returns EmailContent shape with subject, html, text', () => {
    const result = credentialExpiringEmail('Frank', 'Flu Shot', 60)

    expect(typeof result.subject).toBe('string')
    expect(typeof result.html).toBe('string')
    expect(typeof result.text).toBe('string')
    expect(result.subject.length).toBeGreaterThan(0)
    expect(result.html.length).toBeGreaterThan(0)
    expect(result.text.length).toBeGreaterThan(0)
  })
})

// ─── welcomeNurseEmail ────────────────────────────────────────────────────────

describe('welcomeNurseEmail', () => {
  test('contains nurse name in body', () => {
    const result = welcomeNurseEmail('Grace Hopper')

    expect(result.html).toContain('Grace Hopper')
    expect(result.text).toContain('Grace Hopper')
  })

  test('subject mentions NurseSphere or welcome', () => {
    const result = welcomeNurseEmail('Henry Ford')

    expect(result.subject.toLowerCase()).toMatch(/welcome|nursesphere/i)
  })

  test('contains onboarding link', () => {
    const result = welcomeNurseEmail('Irene Adler')

    expect(result.html).toContain('onboarding')
    expect(result.text).toContain('onboarding')
  })

  test('returns valid EmailContent shape', () => {
    const result = welcomeNurseEmail('Jane Doe')

    expect(typeof result.subject).toBe('string')
    expect(typeof result.html).toBe('string')
    expect(typeof result.text).toBe('string')
    expect(result.html).toContain('<!DOCTYPE html>')
  })
})

// ─── invoiceCreatedEmail ──────────────────────────────────────────────────────

describe('invoiceCreatedEmail', () => {
  test('contains formatted amount in body', () => {
    const result = invoiceCreatedEmail('Admin User', 1250.00, '2026-02-24')

    // $1,250.00 formatted
    expect(result.html).toContain('$1,250.00')
    expect(result.text).toContain('$1,250.00')
  })

  test('subject contains formatted amount', () => {
    const result = invoiceCreatedEmail('Admin User', 500.00, '2026-02-24')

    expect(result.subject).toContain('$500.00')
  })

  test('contains shift date in subject and body', () => {
    const result = invoiceCreatedEmail('Admin User', 800, '2026-03-01')

    expect(result.subject).toContain('2026-03-01')
    expect(result.html).toContain('2026-03-01')
    expect(result.text).toContain('2026-03-01')
  })

  test('contains admin name in greeting', () => {
    const result = invoiceCreatedEmail('Sarah Connor', 300, '2026-02-24')

    expect(result.html).toContain('Sarah Connor')
    expect(result.text).toContain('Sarah Connor')
  })

  test('contains invoice link', () => {
    const result = invoiceCreatedEmail('John', 100, '2026-01-01')

    expect(result.html).toContain('invoices')
    expect(result.text).toContain('invoices')
  })

  test('handles decimal amounts correctly', () => {
    const result = invoiceCreatedEmail('Admin', 1234.56, '2026-02-24')

    expect(result.subject).toContain('$1,234.56')
  })
})

// ─── shiftFillAlertEmail ──────────────────────────────────────────────────────

describe('shiftFillAlertEmail', () => {
  test('contains fill probability percentage', () => {
    const result = shiftFillAlertEmail('Admin', 'Sunrise Hospital', '2026-03-15', 0.42)

    // 42% fill probability
    expect(result.subject).toContain('42%')
    expect(result.html).toContain('42%')
  })

  test('contains facility name', () => {
    const result = shiftFillAlertEmail('Admin', 'Ocean View Medical', '2026-03-15', 0.65)

    expect(result.subject).toContain('Ocean View Medical')
    expect(result.html).toContain('Ocean View Medical')
  })
})

// ─── welcomeAdminEmail ────────────────────────────────────────────────────────

describe('welcomeAdminEmail', () => {
  test('contains facility name in subject and body', () => {
    const result = welcomeAdminEmail('Dr. Admin', 'Sunrise Hospital')

    expect(result.subject).toContain('Sunrise Hospital')
    expect(result.html).toContain('Sunrise Hospital')
    expect(result.text).toContain('Sunrise Hospital')
  })

  test('contains admin name in greeting', () => {
    const result = welcomeAdminEmail('Dr. Admin', 'Sunrise Hospital')

    expect(result.html).toContain('Dr. Admin')
  })
})
