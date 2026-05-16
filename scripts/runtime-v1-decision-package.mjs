#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { extractLastJsonObject } from './pi-smoke-summary.mjs';

const READY = 'READY';
const BLOCKED = 'BLOCKED';

export function evaluateRuntimeV1Decision(result, options = {}) {
  const productionCanary = options.productionCanary ?? 'pending';
  const prStack = options.prStack ?? 'pending';
  const browserUx = options.browserUx ?? 'not-required';
  const scenarios = Array.isArray(result?.scenarios) ? result.scenarios : [];
  const gates = [
    structuredJsonGate(result),
    fullCanaryModeGate(result),
    aggregateResultGate(result),
    scenarioGroupGate('real-auth-smoke', 'Real-auth smoke scenarios', scenarios, (scenario) => scenario.kind === 'smoke'),
    scenarioGroupGate('scripted-canaries', 'Scripted canaries', scenarios, (scenario) => scenario.kind === 'scripted_canary'),
    scenarioGate('rollback-exercised', 'Rollback exercised', scenarios, 'pi.rollback-mixed-runtime'),
    operationalGate('production-canary-window', 'Production canary window', productionCanary, 'passed'),
    operationalGate('pr-stack-merged', 'PR stack merged', prStack, 'merged'),
    optionalGate('browser-ux-evidence', 'Browser UX evidence', browserUx),
  ];
  const blockingFailures = gates.filter((gate) => gate.blocking && gate.status !== 'passed');
  return {
    decision: blockingFailures.length === 0 ? READY : BLOCKED,
    blockingFailures: blockingFailures.map((gate) => gate.id),
    gates,
  };
}

export function renderRuntimeV1DecisionPackage(result, options = {}) {
  const evaluation = evaluateRuntimeV1Decision(result, options);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const scenarios = Array.isArray(result?.scenarios) ? result.scenarios : [];
  const nextActions = nextActionsFor(evaluation, scenarios);
  return sanitizeOutput([
    '# Runtime v1 Pi decision package',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| generatedAt | ${escapeCell(generatedAt)} |`,
    `| decision | ${escapeCell(evaluation.decision)} |`,
    `| canaryStatus | ${escapeCell(result?.status ?? 'missing')} |`,
    `| runtime | ${escapeCell(result?.runtime ?? 'missing')} |`,
    `| mode | ${escapeCell(result?.mode ?? 'missing')} |`,
    `| durationMs | ${escapeCell(result?.durationMs ?? 'unknown')} |`,
    '',
    '## Gates',
    '',
    '| Gate | Status | Blocking | Detail |',
    '| --- | --- | --- | --- |',
    ...evaluation.gates.map(renderGateRow),
    '',
    '## Scenario Matrix',
    '',
    '| Scenario | Kind | Status | Command | Error |',
    '| --- | --- | --- | --- | --- |',
    ...scenarioRows(scenarios),
    '',
    '## Next Actions',
    '',
    ...nextActions.map((action) => `- ${action}`),
    '',
  ].join('\n'));
}

export function buildRuntimeV1DecisionJson(result, options = {}) {
  const evaluation = evaluateRuntimeV1Decision(result, options);
  return sanitizeJson({
    decision: evaluation.decision,
    blockingFailures: evaluation.blockingFailures,
    canary: result ?? { status: 'failed', error: 'No structured JSON result found.' },
    gates: evaluation.gates,
  });
}

function structuredJsonGate(result) {
  return {
    id: 'structured-canary-json',
    label: 'Structured canary JSON',
    status: result && typeof result === 'object' ? 'passed' : 'failed',
    blocking: true,
    detail: result && typeof result === 'object'
      ? 'Runtime v1 canary result was parsed.'
      : 'No structured runtime v1 canary JSON was found.',
  };
}

function aggregateResultGate(result) {
  return {
    id: 'aggregate-result-passed',
    label: 'Aggregate canary result',
    status: result?.status === 'passed' ? 'passed' : 'failed',
    blocking: true,
    detail: `Expected top-level status passed; observed ${String(result?.status ?? 'missing')}.`,
  };
}

function fullCanaryModeGate(result) {
  return {
    id: 'full-canary-mode',
    label: 'Full canary mode',
    status: result?.mode === 'full' ? 'passed' : 'failed',
    blocking: true,
    detail: `Expected mode full; observed ${String(result?.mode ?? 'missing')}.`,
  };
}

function scenarioGroupGate(id, label, scenarios, predicate) {
  const selected = scenarios.filter(predicate);
  if (selected.length === 0) {
    return {
      id,
      label,
      status: 'failed',
      blocking: true,
      detail: 'No matching scenarios were present in the canary result.',
    };
  }
  const bad = selected.filter((scenario) => scenario.status !== 'passed');
  return {
    id,
    label,
    status: bad.length === 0 ? 'passed' : 'failed',
    blocking: true,
    detail: bad.length === 0
      ? `${selected.length} scenario(s) passed.`
      : `${bad.length}/${selected.length} scenario(s) are not passed: ${bad.map((scenario) => scenario.id).join(', ')}.`,
  };
}

function scenarioGate(id, label, scenarios, scenarioId) {
  const scenario = scenarios.find((entry) => entry.id === scenarioId);
  return {
    id,
    label,
    status: scenario?.status === 'passed' ? 'passed' : 'failed',
    blocking: true,
    detail: scenario
      ? `${scenarioId} is ${scenario.status}.`
      : `${scenarioId} was not present in the canary result.`,
  };
}

function operationalGate(id, label, observed, required) {
  return {
    id,
    label,
    status: observed === required ? 'passed' : 'pending',
    blocking: true,
    detail: `Expected ${required}; observed ${observed}.`,
  };
}

function optionalGate(id, label, observed) {
  const passed = observed === 'passed' || observed === 'waived' || observed === 'not-required';
  return {
    id,
    label,
    status: passed ? 'passed' : 'pending',
    blocking: false,
    detail: `Observed ${observed}. This gate is informational unless the rollout owner makes browser UX evidence mandatory.`,
  };
}

function nextActionsFor(evaluation, scenarios) {
  const actions = [];
  const byId = new Map(evaluation.gates.map((gate) => [gate.id, gate]));
  if (byId.get('real-auth-smoke')?.status !== 'passed') {
    actions.push('Run `pnpm smoke:pi-v1-canary -- --json --model anthropic/claude-sonnet-4-6 --timeout-ms 120000` in the real-auth environment and regenerate this package.');
  }
  if (byId.get('scripted-canaries')?.status !== 'passed') {
    actions.push('Fix or explicitly waive non-passing scripted canaries with an owner and linked risk.');
  }
  if (byId.get('production-canary-window')?.status !== 'passed') {
    actions.push('Complete the first real Pi canary window for one low-risk AnthroClaw agent.');
  }
  if (byId.get('pr-stack-merged')?.status !== 'passed') {
    actions.push('Merge the runtime migration PR stack and rerun the canary map from the target branch.');
  }
  const failedScenarios = scenarios.filter((scenario) => scenario.status === 'failed' || scenario.status === 'incomplete');
  if (failedScenarios.length > 0) {
    actions.push(`Resolve incomplete or failed scenarios: ${failedScenarios.map((scenario) => scenario.id).join(', ')}.`);
  }
  if (actions.length === 0) {
    actions.push('Record the decision package link in `research/runtime-v1-migration-status.md` before flipping the default runtime.');
  }
  return actions;
}

function renderGateRow(gate) {
  return `| ${escapeCell(gate.label)} | ${escapeCell(gate.status)} | ${gate.blocking ? 'yes' : 'no'} | ${escapeCell(gate.detail)} |`;
}

function scenarioRows(scenarios) {
  if (scenarios.length === 0) return ['| none | missing | failed |  | No scenarios were present. |'];
  return scenarios.map((scenario) => [
    `| ${escapeCell(scenario.id ?? 'unknown')}`,
    escapeCell(scenario.kind ?? 'unknown'),
    escapeCell(scenario.status ?? 'unknown'),
    escapeCell(scenario.command ?? ''),
    `${escapeCell(scenario.error ?? '')} |`,
  ].join(' | '));
}

function sanitizeJson(value) {
  if (typeof value === 'string') return sanitizeOutput(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeJson(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeJson(entry)]));
  }
  return value;
}

function sanitizeOutput(text) {
  return String(text)
    .replaceAll(/sk-ant-api[0-9A-Za-z_-]+/g, '[REDACTED_ANTHROPIC_KEY]')
    .replaceAll(/("?(?:apiKey|api_key|token|secret)"?\s*[:=]\s*")([^"]+)(")/g, '$1[REDACTED_SECRET]$3')
    .replaceAll(/("?(?:authPath|auth_path|modelsPath|models_path)"?\s*[:=]\s*")([^"]+)(")/g, '$1[REDACTED_PATH]$3');
}

function escapeCell(value) {
  return sanitizeOutput(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', '<br>');
}

export function parseRuntimeV1DecisionArgs(argv) {
  const out = {
    productionCanary: 'pending',
    prStack: 'pending',
    browserUx: 'not-required',
    failOnBlocked: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--':
        break;
      case '--input':
        out.inputPath = requireValue(argv, ++i, arg);
        break;
      case '--summary':
        out.summaryPath = requireValue(argv, ++i, arg);
        break;
      case '--json':
        out.jsonPath = requireValue(argv, ++i, arg);
        break;
      case '--production-canary':
        out.productionCanary = requireOneOf(argv, ++i, arg, ['pending', 'passed']);
        break;
      case '--pr-stack':
        out.prStack = requireOneOf(argv, ++i, arg, ['pending', 'merged']);
        break;
      case '--browser-ux':
        out.browserUx = requireOneOf(argv, ++i, arg, ['not-required', 'pending', 'passed', 'waived']);
        break;
      case '--fail-on-blocked':
        out.failOnBlocked = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!out.inputPath || !out.summaryPath || !out.jsonPath) {
    throw new Error('Usage: node scripts/runtime-v1-decision-package.mjs --input <pi-v1-canary.log|json> --summary <path> --json <path> [--production-canary pending|passed] [--pr-stack pending|merged] [--browser-ux not-required|pending|passed|waived] [--fail-on-blocked]');
  }
  return out;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function requireOneOf(argv, index, flag, allowed) {
  const value = requireValue(argv, index, flag);
  if (!allowed.includes(value)) {
    throw new Error(`${flag} must be one of: ${allowed.join(', ')}.`);
  }
  return value;
}

function main() {
  const args = parseRuntimeV1DecisionArgs(process.argv.slice(2));
  const input = readFileSync(args.inputPath, 'utf8');
  const result = extractLastJsonObject(input);
  const options = {
    productionCanary: args.productionCanary,
    prStack: args.prStack,
    browserUx: args.browserUx,
  };
  const markdown = renderRuntimeV1DecisionPackage(result, options);
  const json = buildRuntimeV1DecisionJson(result, options);
  writeFileSync(args.summaryPath, markdown, 'utf8');
  writeFileSync(args.jsonPath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  if (args.failOnBlocked && json.decision !== READY) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
