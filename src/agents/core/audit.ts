/**
 * Agent Audit — thin wrapper around the shared writeAuditLog utility.
 * Standardizes audit entries for all agent runs.
 *
 * PHI rules:
 *   - Never log nurse names, emails, DOB, SSN
 *   - actor_id is always AGENT_ACTOR_UUID (a system UUID)
 *   - metadata contains only UUIDs and run metadata
 */

import { writeAuditLog } from '@/lib/audit'
import type { AgentName, AgentOutput } from './types'

/** System UUID for agent-triggered actions — distinct from SYSTEM_UUID used by compliance sweep */
export const AGENT_ACTOR_UUID = '00000000-0000-0000-0000-000000000003'

export async function writeAgentAuditLog(
  agentName: AgentName,
  output: AgentOutput,
  facilityId?: string | null,
): Promise<void> {
  await writeAuditLog({
    actor_id: AGENT_ACTOR_UUID,
    facility_id: facilityId ?? null,
    action: `agent.${agentName.toLowerCase()}.run`,
    target_id: output.runId,
    target_type: 'agent_run',
    metadata: {
      run_id: output.runId,
      agent: agentName,
      success: output.success,
      started_at: output.startedAt,
      completed_at: output.completedAt,
      // Only log error message — never log stack traces with tokens/secrets
      error: output.error ?? null,
    },
  })
}
