/**
 * runAgents — CLI-style job entrypoint for the NurseSphere agent stack.
 *
 * Supports:
 *   node -e "require('./src/jobs/runAgents').runAgents()" -- --agent ComplianceGuardian --mode nightly
 *   node -e "require('./src/jobs/runAgents').runAgents()" -- --agent CredentialIntelligence --credentialId <id>
 *   node -e "require('./src/jobs/runAgents').runAgents()" -- --agent WorkforceOptimization --mode daily
 *
 * In Vercel / serverless context, import the named sweep functions directly:
 *   import { runNightlyComplianceSweep } from '@/agents/ComplianceGuardian'
 *   import { runDailyWorkforceOptimization } from '@/agents/WorkforceOptimization'
 *
 * Env vars required:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * PHI rules: never log nurse names, emails, or clinical details.
 * Security: never log SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, CRON_SECRET, or any token.
 */

import { AgentRunner } from '../agents/core/AgentRunner'
import { ComplianceGuardian, runNightlyComplianceSweep } from '../agents/ComplianceGuardian'
import { CredentialIntelligence } from '../agents/CredentialIntelligence'
import { WorkforceOptimization, runDailyWorkforceOptimization } from '../agents/WorkforceOptimization'
import type { AgentName, AgentMode } from '../agents/core/types'

// ── Parse CLI args ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2)
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
      args[key] = value
    }
  }
  return args
}

// ── Main runner ────────────────────────────────────────────────────────────────

export async function runAgents(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv)
  const agentName = args['agent'] as AgentName | undefined
  const mode = (args['mode'] ?? 'on_demand') as AgentMode
  const nurseId = args['nurseId']
  const facilityId = args['facilityId']
  const credentialId = args['credentialId']

  // ── Sweep modes (run for all nurses / all facilities) ──────────────────────

  if (agentName === 'ComplianceGuardian' && mode === 'nightly') {
    console.log('[runAgents] Running nightly ComplianceGuardian sweep...')
    const result = await runNightlyComplianceSweep()
    console.log('[runAgents] ComplianceGuardian nightly sweep complete:', JSON.stringify(result))
    return
  }

  if (agentName === 'WorkforceOptimization' && mode === 'daily') {
    console.log('[runAgents] Running daily WorkforceOptimization sweep...')
    const result = await runDailyWorkforceOptimization()
    console.log('[runAgents] WorkforceOptimization daily sweep complete:', JSON.stringify(result))
    return
  }

  // ── Single-entity runs ─────────────────────────────────────────────────────

  if (!agentName) {
    console.error('[runAgents] --agent is required. Valid values: ComplianceGuardian | CredentialIntelligence | WorkforceOptimization')
    process.exit(1)
  }

  const runner = new AgentRunner()
  runner.register(new ComplianceGuardian())
  runner.register(new CredentialIntelligence())
  runner.register(new WorkforceOptimization())

  const output = await runner.run({
    agentName,
    mode,
    nurseId,
    facilityId,
    credentialId,
  })

  if (output.success) {
    console.log('[runAgents] Agent run complete:', JSON.stringify({
      agent: output.agentName,
      runId: output.runId,
      success: output.success,
      result: output.result,
    }))
  } else {
    console.error('[runAgents] Agent run failed:', JSON.stringify({
      agent: output.agentName,
      runId: output.runId,
      error: output.error,
    }))
    process.exit(1)
  }
}

// ── Run directly if called as a script ────────────────────────────────────────
if (require.main === module) {
  runAgents().catch((err) => {
    // Safe: only log message, never log stack with potential env var leaks
    console.error('[runAgents] Fatal error:', (err as Error).message)
    process.exit(1)
  })
}
