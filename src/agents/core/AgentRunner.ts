/**
 * AgentRunner — Orchestrates deterministic agent execution.
 *
 * Responsibilities:
 *   - Route inputs to the correct agent
 *   - Inject runId and timing metadata
 *   - Capture errors without crashing the host process
 *   - Write audit log for every run (success or failure)
 *
 * Usage:
 *   const runner = new AgentRunner()
 *   runner.register(new ComplianceGuardian())
 *   runner.register(new WorkforceOptimization())
 *   const output = await runner.run({ agentName: 'ComplianceGuardian', mode: 'nightly', nurseId })
 */

import { randomUUID } from 'crypto'
import type { AgentInput, AgentOutput, AgentInterface, AgentName } from './types'
import { writeAgentAuditLog } from './audit'

export class AgentRunner {
  private agents: Map<AgentName, AgentInterface> = new Map()

  /**
   * Register an agent implementation.
   * Call before run(). Each agent name can only be registered once.
   */
  register(agent: AgentInterface): void {
    this.agents.set(agent.name, agent)
  }

  /**
   * Run a single agent by name.
   * Always returns an AgentOutput — never throws.
   */
  async run(input: AgentInput): Promise<AgentOutput> {
    const runId = randomUUID()
    const startedAt = new Date().toISOString()

    const agent = this.agents.get(input.agentName)

    if (!agent) {
      const output: AgentOutput = {
        agentName: input.agentName,
        runId,
        success: false,
        startedAt,
        completedAt: new Date().toISOString(),
        result: null,
        error: `Agent not registered: ${input.agentName}`,
      }
      await writeAgentAuditLog(input.agentName, output, input.facilityId as string | null)
      return output
    }

    try {
      // Inject runId so the agent can reference it in its own DB writes
      const enrichedInput: AgentInput = { ...input, runId }
      const output = await agent.run(enrichedInput)

      await writeAgentAuditLog(
        input.agentName,
        output,
        input.facilityId as string | null ?? null,
      )

      return output
    } catch (err) {
      const output: AgentOutput = {
        agentName: input.agentName,
        runId,
        success: false,
        startedAt,
        completedAt: new Date().toISOString(),
        result: null,
        // Safe: only log message, never stack with potential env var leaks
        error: err instanceof Error ? err.message : 'Unknown error in agent run',
      }

      await writeAgentAuditLog(
        input.agentName,
        output,
        input.facilityId as string | null ?? null,
      )

      return output
    }
  }

  /**
   * Run multiple agents sequentially.
   * Collects all outputs — a single agent failure does not stop the rest.
   */
  async runAll(inputs: AgentInput[]): Promise<AgentOutput[]> {
    const results: AgentOutput[] = []
    for (const input of inputs) {
      results.push(await this.run(input))
    }
    return results
  }
}
