import { describe, expect, it } from 'vitest';
import {
  RUNTIME_CONTRACT_MATRIX,
  RUNTIME_CONTRACT_SCENARIOS,
  listRuntimeContractMatrix,
  runtimeContractBlockingGaps,
  runtimeContractProgress,
  type RuntimeContractCandidateId,
} from '../contract.js';

const candidates: RuntimeContractCandidateId[] = ['claude-agent-sdk', 'pi', 'opencode'];

describe('runtime contract matrix', () => {
  it('keeps scenario ids unique', () => {
    const ids = RUNTIME_CONTRACT_SCENARIOS.map((scenario) => scenario.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers every scenario for every candidate', () => {
    const scenarios = RUNTIME_CONTRACT_SCENARIOS.map((scenario) => scenario.id).sort();

    for (const candidate of candidates) {
      expect(listRuntimeContractMatrix(candidate).map((entry) => entry.scenario).sort())
        .toEqual(scenarios);
    }
    expect(RUNTIME_CONTRACT_MATRIX).toHaveLength(candidates.length * scenarios.length);
  });

  it('reports candidate progress from pass, partial, and fail statuses', () => {
    expect(runtimeContractProgress('claude-agent-sdk')).toMatchObject({
      pass: 10,
      partial: 0,
      fail: 0,
      requiredBlockingGaps: 0,
      scorePercent: 100,
    });
    expect(runtimeContractProgress('pi')).toMatchObject({
      pass: 10,
      partial: 0,
      fail: 0,
      requiredBlockingGaps: 0,
      scorePercent: 100,
    });
    expect(runtimeContractProgress('opencode')).toMatchObject({
      pass: 6,
      partial: 0,
      fail: 4,
      requiredBlockingGaps: 4,
      scorePercent: 60,
    });
  });

  it('returns production-blocking gaps only for required partial or failed scenarios', () => {
    expect(runtimeContractBlockingGaps('pi')).toEqual([]);
    expect(runtimeContractBlockingGaps('opencode').map((entry) => entry.scenario).sort())
      .toEqual([
        'custom_tool_execution',
        'external_mcp_proxy',
        'gateway_active_run_control',
        'tool_policy_denial',
      ]);
    expect(runtimeContractBlockingGaps('claude-agent-sdk')).toEqual([]);
  });
});
