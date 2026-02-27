/**
 * Credential Expiration Auto-Recovery — Renewal Flow Logic
 * SERVER ONLY — never import from client components.
 * All operations are audit-logged. PHI never logged.
 */

import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { writeAuditLog } from '@/lib/audit'

export type RenewalStatus =
  | 'pending'
  | 'in_progress'
  | 'submitted'
  | 'under_review'
  | 'verified'
  | 'expired_without_renewal'

export interface RenewalStep {
  step: string
  label: string
  completed_at: string | null
}

export interface RenewalTask {
  id: string
  nurse_id: string
  credential_id: string
  facility_id: string | null
  status: RenewalStatus
  steps: RenewalStep[]
  new_document_url: string | null
  submitted_at: string | null
  verified_at: string | null
  verified_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

const DEFAULT_STEPS: RenewalStep[] = [
  { step: 'upload_document', label: 'Upload renewed credential document', completed_at: null },
  { step: 'admin_review', label: 'Admin review and verification', completed_at: null },
  { step: 'credential_updated', label: 'Credential marked active', completed_at: null },
]

// ─────────────────────────────────────────────────────────────────────────────
// createRenewalTask
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new renewal task for an expiring/expired credential.
 * Idempotent: will not create a duplicate if an open task already exists.
 */
export async function createRenewalTask(
  nurseId: string,
  credentialId: string,
  facilityId?: string
): Promise<RenewalTask | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseAdminClient() as any

  // Check for existing open task
  const { data: existingRaw } = await supabase
    .from('renewal_tasks')
    .select('id, status')
    .eq('nurse_id', nurseId)
    .eq('credential_id', credentialId)
    .in('status', ['pending', 'in_progress', 'submitted', 'under_review'])
    .limit(1)
    .maybeSingle()

  const existing = existingRaw as { id: string; status: string } | null
  if (existing) {
    // Return the existing task to avoid duplicates
    const { data: taskRaw } = await supabase
      .from('renewal_tasks')
      .select('id, nurse_id, credential_id, facility_id, status, steps, new_document_url, submitted_at, verified_at, verified_by, notes, created_at, updated_at')
      .eq('id', existing.id)
      .single()
    return taskRaw as RenewalTask | null
  }

  const { data: taskRaw, error } = await supabase
    .from('renewal_tasks')
    .insert({
      nurse_id: nurseId,
      credential_id: credentialId,
      facility_id: facilityId ?? null,
      status: 'pending',
      steps: DEFAULT_STEPS,
    })
    .select()
    .single()

  if (error) {
    console.warn('[RenewalFlow] createRenewalTask insert failed:', error.message)
    return null
  }

  const task = taskRaw as RenewalTask

  await writeAuditLog({
    actor_id: nurseId,
    action: 'renewal_task_created',
    target_type: 'renewal_tasks',
    target_id: task.id,
    metadata: { credential_id: credentialId, facility_id: facilityId ?? null },
  })

  return task
}

// ─────────────────────────────────────────────────────────────────────────────
// submitRenewalDocument
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nurse submits a new credential document URL.
 * Marks upload step complete and transitions status to 'submitted'.
 */
export async function submitRenewalDocument(
  taskId: string,
  nurseId: string,
  documentUrl: string
): Promise<RenewalTask | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseAdminClient() as any

  // Verify ownership
  const { data: taskRaw, error: fetchError } = await supabase
    .from('renewal_tasks')
    .select('id, nurse_id, credential_id, facility_id, status, steps, new_document_url, submitted_at, verified_at, verified_by, notes, created_at, updated_at')
    .eq('id', taskId)
    .eq('nurse_id', nurseId)
    .single()

  if (fetchError || !taskRaw) {
    console.warn('[RenewalFlow] submitRenewalDocument: task not found or not owned by nurse')
    return null
  }

  const task = taskRaw as RenewalTask

  // Mark upload_document step as complete
  const now = new Date().toISOString()
  const updatedSteps = task.steps.map((s) =>
    s.step === 'upload_document' ? { ...s, completed_at: now } : s
  )

  const { data: updatedRaw, error: updateError } = await supabase
    .from('renewal_tasks')
    .update({
      new_document_url: documentUrl,
      status: 'submitted',
      submitted_at: now,
      steps: updatedSteps,
      updated_at: now,
    })
    .eq('id', taskId)
    .select()
    .single()

  if (updateError) {
    console.error('[RenewalFlow] submitRenewalDocument update failed:', updateError.message)
    return null
  }

  await writeAuditLog({
    actor_id: nurseId,
    action: 'renewal_document_submitted',
    target_type: 'renewal_tasks',
    target_id: taskId,
    metadata: { credential_id: task.credential_id },
  })

  return updatedRaw as RenewalTask
}

// ─────────────────────────────────────────────────────────────────────────────
// verifyRenewal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Admin verifies a submitted renewal.
 * Updates task to 'verified' and activates the underlying credential.
 * Also resolves any related compliance_alert.
 */
export async function verifyRenewal(
  taskId: string,
  adminId: string
): Promise<{ task: RenewalTask | null; credentialUpdated: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseAdminClient() as any
  const now = new Date().toISOString()

  // Fetch the task
  const { data: taskRaw, error: fetchError } = await supabase
    .from('renewal_tasks')
    .select('id, nurse_id, credential_id, facility_id, status, steps, new_document_url, submitted_at, verified_at, verified_by, notes, created_at, updated_at')
    .eq('id', taskId)
    .single()

  if (fetchError || !taskRaw) {
    console.warn('[RenewalFlow] verifyRenewal: task not found')
    return { task: null, credentialUpdated: false }
  }

  const task = taskRaw as RenewalTask

  // Mark all steps complete
  const updatedSteps = task.steps.map((s) => ({
    ...s,
    completed_at: s.completed_at ?? now,
  }))

  // Update task
  const { data: updatedTaskRaw, error: taskUpdateError } = await supabase
    .from('renewal_tasks')
    .update({
      status: 'verified',
      verified_at: now,
      verified_by: adminId,
      steps: updatedSteps,
      updated_at: now,
    })
    .eq('id', taskId)
    .select()
    .single()

  if (taskUpdateError) {
    console.error('[RenewalFlow] verifyRenewal task update failed:', taskUpdateError.message)
    return { task: null, credentialUpdated: false }
  }

  // Activate the credential
  const { error: credError } = await supabase
    .from('credentials')
    .update({
      status: 'active',
      verified_at: now,
      verified_by: adminId,
      updated_at: now,
    })
    .eq('id', task.credential_id)

  const credentialUpdated = !credError

  if (credError) {
    console.warn('[RenewalFlow] verifyRenewal credential update failed:', credError.message)
  }

  // Attempt to resolve related compliance alerts
  await supabase
    .from('compliance_alerts')
    .update({ status: 'resolved', updated_at: now })
    .eq('credential_id', task.credential_id)
    .in('status', ['open', 'acknowledged'])

  await writeAuditLog({
    actor_id: adminId,
    action: 'renewal_verified',
    target_type: 'renewal_tasks',
    target_id: taskId,
    metadata: {
      credential_id: task.credential_id,
      nurse_id: task.nurse_id,
      credential_activated: credentialUpdated,
    },
  })

  return { task: updatedTaskRaw as RenewalTask, credentialUpdated }
}
