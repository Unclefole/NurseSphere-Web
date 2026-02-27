import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from 'pdf-lib'
import * as crypto from 'crypto'

export interface ContractPDFData {
  id: string
  title: string
  content: string
  status: string
  terms?: Record<string, unknown> | null
  created_at: string
  expires_at?: string | null
  nurse?: { full_name?: string | null; email?: string } | null
  facility?: { name?: string | null; contact_email?: string | null } | null
  nurse_signed_at?: string | null
  admin_signed_at?: string | null
  shift?: { title?: string; start_time?: string } | null
}

const TEAL = rgb(0.082, 0.706, 0.651)    // #14b8a6
const NAVY = rgb(0.059, 0.153, 0.122)    // ~#0f2720
const DARK = rgb(0.1, 0.1, 0.1)
const GRAY = rgb(0.45, 0.45, 0.45)
const LIGHT_GRAY = rgb(0.9, 0.9, 0.9)
const WHITE = rgb(1, 1, 1)
const RED = rgb(0.8, 0.1, 0.1)
const GREEN = rgb(0.1, 0.6, 0.2)

function wrapText(text: string, maxWidth: number, font: PDFFont, fontSize: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word
    const width = font.widthOfTextAtSize(testLine, fontSize)
    if (width <= maxWidth) {
      currentLine = testLine
    } else {
      if (currentLine) lines.push(currentLine)
      currentLine = word
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines
}

function drawHRule(page: PDFPage, y: number, margin: number, width: number, color = LIGHT_GRAY) {
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 0.5,
    color,
  })
}

export async function generateContractPDF(contract: ContractPDFData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  pdfDoc.setTitle(contract.title)
  pdfDoc.setAuthor('NurseSphere, LLC')
  pdfDoc.setSubject('Clinical Staffing Contract')
  pdfDoc.setCreationDate(new Date())

  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const oblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

  const pageWidth = 612   // US Letter
  const pageHeight = 792
  const margin = 56
  const contentWidth = pageWidth - margin * 2

  let page = pdfDoc.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin

  // ── HEADER BAR ──
  page.drawRectangle({
    x: 0, y: pageHeight - 72,
    width: pageWidth, height: 72,
    color: rgb(0.039, 0.098, 0.118), // nurse-dark
  })

  // Logo text
  page.drawText('Nurse', {
    x: margin, y: pageHeight - 44,
    size: 22, font: bold, color: WHITE,
  })
  page.drawText('Sphere', {
    x: margin + bold.widthOfTextAtSize('Nurse', 22), y: pageHeight - 44,
    size: 22, font: bold, color: TEAL,
  })

  // Document label
  page.drawText('CLINICAL STAFFING CONTRACT', {
    x: pageWidth - margin - bold.widthOfTextAtSize('CLINICAL STAFFING CONTRACT', 9),
    y: pageHeight - 36,
    size: 9, font: bold, color: TEAL,
  })
  page.drawText('nursesphere.io', {
    x: pageWidth - margin - regular.widthOfTextAtSize('nursesphere.io', 8),
    y: pageHeight - 50,
    size: 8, font: regular, color: rgb(0.6, 0.6, 0.6),
  })

  y = pageHeight - 72 - 24

  // ── CONTRACT TITLE ──
  page.drawText(contract.title, {
    x: margin, y,
    size: 16, font: bold, color: DARK,
  })
  y -= 20

  // ── STATUS BADGE ──
  const statusColor = contract.status === 'executed' ? GREEN
    : contract.status === 'voided' ? RED
    : contract.status === 'pending_signature' ? rgb(0.8, 0.5, 0.0)
    : GRAY

  const statusLabel = contract.status.replace(/_/g, ' ').toUpperCase()
  const badgeWidth = bold.widthOfTextAtSize(statusLabel, 8) + 16
  page.drawRectangle({ x: margin, y: y - 4, width: badgeWidth, height: 16, color: statusColor, opacity: 0.15 })
  page.drawText(statusLabel, { x: margin + 8, y: y + 2, size: 8, font: bold, color: statusColor })
  y -= 28

  drawHRule(page, y, margin, pageWidth)
  y -= 16

  // ── PARTIES ──
  page.drawText('PARTIES', { x: margin, y, size: 9, font: bold, color: TEAL })
  y -= 14

  const col2 = margin + contentWidth / 2

  page.drawText('FACILITY (Covered Entity)', { x: margin, y, size: 8, font: bold, color: GRAY })
  page.drawText('NURSE (Independent Contractor)', { x: col2, y, size: 8, font: bold, color: GRAY })
  y -= 12

  const facilityName = contract.facility?.name || '[Facility Name]'
  const facilityEmail = contract.facility?.contact_email || ''
  const nurseName = contract.nurse?.full_name || '[Nurse Name]'
  const nurseEmail = contract.nurse?.email || ''

  page.drawText(facilityName, { x: margin, y, size: 9, font: bold, color: DARK })
  page.drawText(nurseName, { x: col2, y, size: 9, font: bold, color: DARK })
  y -= 12

  page.drawText(facilityEmail, { x: margin, y, size: 8, font: regular, color: GRAY })
  page.drawText(nurseEmail, { x: col2, y, size: 8, font: regular, color: GRAY })
  y -= 8

  if (contract.shift) {
    const shiftDate = contract.shift.start_time
      ? new Date(contract.shift.start_time).toLocaleDateString('en-US', { dateStyle: 'medium' })
      : ''
    page.drawText(`Shift: ${contract.shift.title || ''} — ${shiftDate}`, {
      x: margin, y, size: 8, font: oblique, color: GRAY,
    })
    y -= 8
  }

  y -= 8
  drawHRule(page, y, margin, pageWidth)
  y -= 16

  // ── CONTRACT DATES ──
  const createdStr = new Date(contract.created_at).toLocaleDateString('en-US', { dateStyle: 'long' })
  const expiresStr = contract.expires_at
    ? new Date(contract.expires_at).toLocaleDateString('en-US', { dateStyle: 'long' })
    : 'N/A'

  page.drawText(`Effective Date: ${createdStr}`, { x: margin, y, size: 8, font: regular, color: GRAY })
  page.drawText(`Expires: ${expiresStr}`, { x: col2, y, size: 8, font: regular, color: GRAY })
  y -= 20

  // ── CONTRACT BODY ──
  page.drawText('CONTRACT TERMS', { x: margin, y, size: 9, font: bold, color: TEAL })
  y -= 14

  const bodyFontSize = 9
  const lineHeight = 13
  const paragraphs = contract.content.split('\n')

  for (const para of paragraphs) {
    if (!para.trim()) { y -= 6; continue }

    const lines = wrapText(para.trim(), contentWidth, regular, bodyFontSize)
    for (const line of lines) {
      if (y < margin + 120) {
        // Add new page
        page = pdfDoc.addPage([pageWidth, pageHeight])
        // Continuation header
        page.drawRectangle({ x: 0, y: pageHeight - 28, width: pageWidth, height: 28, color: rgb(0.039, 0.098, 0.118) })
        page.drawText('NurseSphere', { x: margin, y: pageHeight - 18, size: 9, font: bold, color: TEAL })
        page.drawText(`${contract.title} (continued)`, {
          x: margin + 90, y: pageHeight - 18, size: 9, font: regular, color: WHITE,
        })
        y = pageHeight - 50
      }
      page.drawText(line, { x: margin, y, size: bodyFontSize, font: regular, color: DARK })
      y -= lineHeight
    }
    y -= 4
  }

  // Additional terms from JSON
  if (contract.terms && typeof contract.terms === 'object') {
    y -= 8
    page.drawText('ADDITIONAL TERMS', { x: margin, y, size: 9, font: bold, color: TEAL })
    y -= 14
    for (const [key, value] of Object.entries(contract.terms)) {
      if (y < margin + 120) {
        page = pdfDoc.addPage([pageWidth, pageHeight])
        y = pageHeight - 50
      }
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
      const valueStr = String(value)
      const termLine = `${label}: ${valueStr}`
      const lines = wrapText(termLine, contentWidth, regular, bodyFontSize)
      for (const line of lines) {
        page.drawText(line, { x: margin, y, size: bodyFontSize, font: regular, color: DARK })
        y -= lineHeight
      }
    }
  }

  // ── SIGNATURE BLOCK ──
  if (y < margin + 160) {
    page = pdfDoc.addPage([pageWidth, pageHeight])
    y = pageHeight - 50
  }

  y -= 16
  drawHRule(page, y, margin, pageWidth)
  y -= 16

  page.drawText('SIGNATURES', { x: margin, y, size: 9, font: bold, color: TEAL })
  y -= 14

  // Facility signature
  const sigLineWidth = contentWidth / 2 - 16

  page.drawText('FACILITY REPRESENTATIVE', { x: margin, y, size: 8, font: bold, color: GRAY })
  page.drawText('NURSE', { x: col2, y, size: 8, font: bold, color: GRAY })
  y -= 18

  if (contract.admin_signed_at) {
    page.drawText('✓ SIGNED', { x: margin, y, size: 10, font: bold, color: GREEN })
    const adminDate = new Date(contract.admin_signed_at).toLocaleDateString('en-US', { dateStyle: 'medium' })
    page.drawText(`Date: ${adminDate}`, { x: margin, y: y - 14, size: 8, font: regular, color: GRAY })
  } else {
    page.drawLine({ start: { x: margin, y }, end: { x: margin + sigLineWidth, y }, thickness: 0.5, color: DARK })
    page.drawText('Authorized Representative', { x: margin, y: y - 12, size: 7, font: regular, color: GRAY })
  }

  if (contract.nurse_signed_at) {
    page.drawText('✓ SIGNED', { x: col2, y, size: 10, font: bold, color: GREEN })
    const nurseDate = new Date(contract.nurse_signed_at).toLocaleDateString('en-US', { dateStyle: 'medium' })
    page.drawText(`Date: ${nurseDate}`, { x: col2, y: y - 14, size: 8, font: regular, color: GRAY })
  } else {
    page.drawLine({ start: { x: col2, y }, end: { x: col2 + sigLineWidth, y }, thickness: 0.5, color: DARK })
    page.drawText('Registered Nurse', { x: col2, y: y - 12, size: 7, font: regular, color: GRAY })
  }

  y -= 36

  // ── INTEGRITY FOOTER (last page) ──
  const hash = crypto
    .createHash('sha256')
    .update(`${contract.id}|${contract.title}|${contract.content}|${contract.created_at}`)
    .digest('hex')

  drawHRule(page, margin + 36, margin, pageWidth, LIGHT_GRAY)
  page.drawText(`Document ID: ${contract.id}`, {
    x: margin, y: margin + 24, size: 7, font: regular, color: GRAY,
  })
  page.drawText(`SHA-256: ${hash.substring(0, 32)}...`, {
    x: margin, y: margin + 14, size: 7, font: regular, color: GRAY,
  })
  page.drawText(`Generated: ${new Date().toISOString()} | NurseSphere, LLC | HIPAA Compliant`, {
    x: margin, y: margin + 4, size: 7, font: regular, color: GRAY,
  })
  page.drawText(`nursesphere.io`, {
    x: pageWidth - margin - regular.widthOfTextAtSize('nursesphere.io', 7),
    y: margin + 4, size: 7, font: regular, color: TEAL,
  })

  // Page numbers
  const pages = pdfDoc.getPages()
  pages.forEach((p, i) => {
    p.drawText(`Page ${i + 1} of ${pages.length}`, {
      x: pageWidth / 2 - 20, y: margin - 8,
      size: 7, font: regular, color: GRAY,
    })
  })

  return pdfDoc.save()
}
