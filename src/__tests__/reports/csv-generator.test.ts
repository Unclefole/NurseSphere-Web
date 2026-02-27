/**
 * Tests for CSV generation utility.
 * Pure function tests — no DB, no network.
 */

import { csvFromArray } from '@/lib/reports/report-generator'

// ─── csvFromArray ─────────────────────────────────────────────────────────────

describe('csvFromArray', () => {
  test('produces valid CSV with headers and data rows', () => {
    const headers = ['name', 'age', 'city']
    const rows = [
      ['Alice', 30, 'New York'],
      ['Bob', 25, 'Los Angeles'],
    ]

    const result = csvFromArray(headers, rows)

    const lines = result.split('\n')
    expect(lines[0]).toBe('name,age,city')
    expect(lines[1]).toBe('Alice,30,New York')
    expect(lines[2]).toBe('Bob,25,Los Angeles')
    expect(lines).toHaveLength(3)
  })

  test('empty dataset returns headers only', () => {
    const headers = ['shift_id', 'date', 'unit', 'nurse_name', 'hours']
    const rows: (string | number | null | undefined)[][] = []

    const result = csvFromArray(headers, rows)

    // Should only have one line (the header)
    expect(result).toBe('shift_id,date,unit,nurse_name,hours')
    expect(result.split('\n')).toHaveLength(1)
  })

  test('escapes commas within values', () => {
    const headers = ['name', 'address']
    const rows = [['Jane Doe', '123 Main St, Apt 4']]

    const result = csvFromArray(headers, rows)

    const lines = result.split('\n')
    // Address contains comma → should be quoted
    expect(lines[1]).toBe('Jane Doe,"123 Main St, Apt 4"')
  })

  test('escapes double-quotes within values', () => {
    const headers = ['name', 'note']
    const rows = [['John', 'He said "hello"']]

    const result = csvFromArray(headers, rows)

    const lines = result.split('\n')
    // Value with double-quotes → should be wrapped in quotes with escaped inner quotes
    expect(lines[1]).toBe('John,"He said ""hello"""')
  })

  test('escapes commas and quotes in headers', () => {
    const headers = ['nurse,name', 'status']
    const rows = [['Alice', 'active']]

    const result = csvFromArray(headers, rows)

    const lines = result.split('\n')
    expect(lines[0]).toBe('"nurse,name",status')
  })

  test('handles null and undefined values as empty strings', () => {
    const headers = ['id', 'name', 'rate']
    const rows = [[1, null, undefined]]

    const result = csvFromArray(headers, rows)

    const lines = result.split('\n')
    expect(lines[1]).toBe('1,,')
  })

  test('handles numeric values correctly', () => {
    const headers = ['hours', 'rate', 'total']
    const rows = [[8, 45.5, 364]]

    const result = csvFromArray(headers, rows)

    const lines = result.split('\n')
    expect(lines[1]).toBe('8,45.5,364')
  })

  test('values with newlines are quoted', () => {
    const headers = ['name', 'notes']
    const rows = [['Alice', 'Line1\nLine2']]

    const result = csvFromArray(headers, rows)
    const lines = result.split('\n')

    // The header + first data cell should appear in line[1]
    // The value with newline should be wrapped in quotes
    expect(lines[1]).toContain('"Line1')
  })

  test('single-column CSV with multiple rows works correctly', () => {
    const headers = ['id']
    const rows = [['a'], ['b'], ['c']]

    const result = csvFromArray(headers, rows)
    const lines = result.split('\n')

    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe('id')
    expect(lines[1]).toBe('a')
    expect(lines[3]).toBe('c')
  })
})
