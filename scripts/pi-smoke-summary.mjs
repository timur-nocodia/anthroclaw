#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

export function extractLastJsonObject(text) {
  const lines = text.trim().split('\n').reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Keep looking: pnpm logs can contain braces in non-result lines.
    }
  }
  return undefined;
}

export function renderPiSmokeSummary(result, options = {}) {
  const exitCode = typeof options.exitCode === 'number' ? options.exitCode : undefined;
  if (!result) {
    return [
      '# Pi smoke result',
      '',
      '| Field | Value |',
      '| --- | --- |',
      `| status | ${escapeCell('failed')} |`,
      `| exitCode | ${escapeCell(exitCode ?? 'unknown')} |`,
      '',
      'No structured JSON result was found in the smoke log.',
      '',
    ].join('\n');
  }

  const probes = result.probes && typeof result.probes === 'object' ? result.probes : {};
  return [
    '# Pi smoke result',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| status | ${escapeCell(result.status ?? 'unknown')} |`,
    `| runtime | ${escapeCell(result.runtime ?? 'unknown')} |`,
    `| durationMs | ${escapeCell(result.durationMs ?? 'unknown')} |`,
    `| exitCode | ${escapeCell(exitCode ?? 'unknown')} |`,
    '',
    '| Probe | Status | Exit code | Error |',
    '| --- | --- | --- | --- |',
    renderProbeRow('auth', probes.auth),
    renderProbeRow('workspace', probes.workspace),
    renderProbeRow('gateway', probes.gateway),
    '',
  ].join('\n');
}

function renderProbeRow(name, probe) {
  const current = probe && typeof probe === 'object' ? probe : {};
  return [
    `| ${escapeCell(name)}`,
    escapeCell(current.status ?? 'unknown'),
    escapeCell(current.code ?? 'unknown'),
    `${escapeCell(current.error ?? '')} |`,
  ].join(' | ');
}

function escapeCell(value) {
  return String(value)
    .replaceAll('|', '\\|')
    .replaceAll('\n', '<br>');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--log':
        out.logPath = requireValue(argv, ++i, arg);
        break;
      case '--summary':
        out.summaryPath = requireValue(argv, ++i, arg);
        break;
      case '--json':
        out.jsonPath = requireValue(argv, ++i, arg);
        break;
      case '--exit-code':
        out.exitCode = Number(requireValue(argv, ++i, arg));
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!out.logPath || !out.summaryPath || !out.jsonPath) {
    throw new Error('Usage: node scripts/pi-smoke-summary.mjs --log <path> --summary <path> --json <path> [--exit-code <code>]');
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = readFileSync(args.logPath, 'utf8');
  const result = extractLastJsonObject(log);
  writeFileSync(args.summaryPath, renderPiSmokeSummary(result, { exitCode: args.exitCode }), 'utf8');
  writeFileSync(args.jsonPath, `${JSON.stringify(result ?? { status: 'failed', error: 'No structured JSON result found.' }, null, 2)}\n`, 'utf8');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
